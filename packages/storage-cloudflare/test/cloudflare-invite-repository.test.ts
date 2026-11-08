import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { CloudflareInviteRepository, CloudflareWorkspaceRepository } from '../src/index.ts'

const inviteRepository = new CloudflareInviteRepository(env.DB)
const workspaceRepository = new CloudflareWorkspaceRepository(env.DB)
const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

async function newWorkspace(): Promise<string> {
  const workspaceId = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').bind(workspaceId, 'Design team', now).run()
  return workspaceId
}

function inviteInto(workspaceId: string, email: string | null, createdAt = now) {
  return inviteRepository.create({ workspaceId, email, code: crypto.randomUUID(), invitedBy: 'user-admin', createdAt, expiresAt: createdAt + 7 * DAY })
}

describe('CloudflareInviteRepository', () => {
  it('hands back only pending invites: not revoked, not expired, not accepted', async () => {
    const workspaceId = await newWorkspace()
    const link = await inviteInto(workspaceId, null)
    const expiredLink = await inviteInto(workspaceId, null, now - 8 * DAY)
    const revokedLink = await inviteInto(workspaceId, null)
    const acceptedEmail = await inviteInto(workspaceId, 'accepted@example.com')
    const pendingEmail = await inviteInto(workspaceId, 'pending@example.com')
    await inviteRepository.revoke(workspaceId, revokedLink.inviteId, now)
    await inviteRepository.markAccepted(acceptedEmail.inviteId, now)
    await inviteRepository.markAccepted(link.inviteId, now)

    const pending = await inviteRepository.listPending(workspaceId, now)

    expect(pending.map(invite => invite.inviteId).sort()).toEqual([link.inviteId, pendingEmail.inviteId].sort())
    expect(await inviteRepository.findPendingByCode(link.code, now)).toEqual(link)
    expect(await inviteRepository.findPendingByCode(expiredLink.code, now)).toBeNull()
    expect(await inviteRepository.findPendingByCode(revokedLink.code, now)).toBeNull()
    expect(await inviteRepository.listPendingForEmail('accepted@example.com', now)).toEqual([])
    expect(await inviteRepository.listPendingForEmail('pending@example.com', now)).toEqual([pendingEmail])
  })

  it('keeps one pending invite per address: inviting again replaces the earlier one', async () => {
    const workspaceId = await newWorkspace()
    const firstInvite = await inviteInto(workspaceId, 'again@example.com')

    const secondInvite = await inviteInto(workspaceId, 'again@example.com')

    expect(await inviteRepository.findPendingByCode(firstInvite.code, now)).toBeNull()
    expect(await inviteRepository.listPendingForEmail('again@example.com', now)).toEqual([secondInvite])
  })

  it('keeps a link that never expires pending until it is revoked, and no invite of a deleted workspace', async () => {
    const workspaceId = await newWorkspace()
    const deletedWorkspaceId = await newWorkspace()
    const lastingLink = await inviteRepository.create({ workspaceId, email: null, code: crypto.randomUUID(), invitedBy: 'user-admin', createdAt: now, expiresAt: null })
    const linkOfDeleted = await inviteInto(deletedWorkspaceId, null)
    await workspaceRepository.delete(deletedWorkspaceId, now)

    expect(await inviteRepository.findPendingByCode(lastingLink.code, now + 3650 * DAY)).toEqual(lastingLink)
    expect(await inviteRepository.findPendingByCode(linkOfDeleted.code, now)).toBeNull()
    await inviteRepository.revoke(workspaceId, lastingLink.inviteId, now)
    expect(await inviteRepository.findPendingByCode(lastingLink.code, now)).toBeNull()
  })

  it('revokes only a pending invite of the given workspace', async () => {
    const workspaceId = await newWorkspace()
    const otherWorkspaceId = await newWorkspace()
    const link = await inviteInto(workspaceId, null)

    const fromOtherWorkspace = await inviteRepository.revoke(otherWorkspaceId, link.inviteId, now)
    const revoked = await inviteRepository.revoke(workspaceId, link.inviteId, now)
    const revokedTwice = await inviteRepository.revoke(workspaceId, link.inviteId, now)

    expect(fromOtherWorkspace).toBeNull()
    expect(revoked).toEqual(link)
    expect(revokedTwice).toBeNull()
  })
})

describe('joining a workspace', () => {
  it('adds a new member once, and keeps a removed person out unless the join readmits them', async () => {
    const workspaceId = await newWorkspace()

    const firstJoin = await workspaceRepository.join(workspaceId, 'user-newcomer', now, { readmitsRemoved: false })
    const secondJoin = await workspaceRepository.join(workspaceId, 'user-newcomer', now, { readmitsRemoved: false })
    await env.DB.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, 'user-keeper', 'admin', ?)").bind(workspaceId, now).run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, 'user-removed', 'admin', ?)").bind(workspaceId, now).run()
    await workspaceRepository.removeMember(workspaceId, 'user-removed', now)
    const keptOut = await workspaceRepository.join(workspaceId, 'user-removed', now, { readmitsRemoved: false })
    const readmitted = await workspaceRepository.join(workspaceId, 'user-removed', now, { readmitsRemoved: true })

    expect(firstJoin).toMatchObject({ status: 'joined', membership: { role: 'member', workspace: { workspaceId } } })
    expect(secondJoin.status).toBe('already_member')
    expect(keptOut).toEqual({ status: 'removed' })
    expect(readmitted).toMatchObject({ status: 'joined', membership: { role: 'member' } })
  })
})
