import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const app = new TestApp()
let adminCookie = ''
let adminId = ''
let workspaceId = ''

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
  const me = await app.json<{ user: { userId: string }; workspace: { workspaceId: string } }>('/api/me', { cookie: adminCookie })
  adminId = me.body.user.userId
  workspaceId = me.body.workspace.workspaceId
})

function addresses(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}@partner.org`)
}

function inviteByEmail(emails: string[]) {
  return app.json<{ code?: string; invites?: unknown[] }>('/api/workspace/invites/email', { method: 'POST', cookie: adminCookie, body: { emails } })
}

async function pendingInviteCount(): Promise<number> {
  const { body } = await app.json<{ invites: unknown[] }>('/api/workspace/invites', { cookie: adminCookie })
  return body.invites.length
}

describe('invite mail', () => {
  it('sends at most 100 a day from one workspace, and refuses a whole batch that would go over', async () => {
    const first = await inviteByEmail(addresses('first', 50))
    const second = await inviteByEmail(addresses('second', 40))
    const mailsBefore = app.mailer.sent.length
    const overflowing = await inviteByEmail(addresses('overflow', 20))
    const mailsAfterRefusal = app.mailer.sent.length
    const invitesAfterRefusal = await pendingInviteCount()
    const filling = await inviteByEmail(addresses('filling', 10))
    const oneMore = await inviteByEmail(['one-more@partner.org'])

    expect([first.status, second.status, overflowing.status, filling.status, oneMore.status]).toEqual([201, 201, 429, 201, 429])
    expect(overflowing.body.code).toBe('mail_limit_reached')
    expect(mailsAfterRefusal).toBe(mailsBefore)
    expect(invitesAfterRefusal).toBe(90)
    expect(app.mailer.lastTo('overflow-0@partner.org')).toBeUndefined()
    expect(app.mailer.lastTo('one-more@partner.org')).toBeUndefined()
  })
})

describe('share mail', () => {
  async function outsiderId(email: string): Promise<string> {
    const cookie = await app.signIn(email)
    const { body } = await app.json<{ user: { userId: string } }>('/api/me', { cookie })
    await app.request(`/api/workspace/members/${body.user.userId}`, { method: 'DELETE', cookie: adminCookie })
    return body.user.userId
  }

  function shareWith(artifactId: string, userIds: string[]) {
    return app.json<{ code?: string }>(`/api/artifacts/${artifactId}/sharing`, { method: 'PUT', cookie: adminCookie, body: { visibility: 'specified', grants: userIds.map(userId => ({ userId, role: 'viewer' })) } })
  }

  it('mails at most 50 people outside the workspace a day for one person, and does not count members', async () => {
    const memberCookie = await app.signIn('colleague@example.com')
    const memberId = (await app.json<{ user: { userId: string } }>('/api/me', { cookie: memberCookie })).body.user.userId
    const firstOutsider = await outsiderId('first-outsider@example.com')
    const secondOutsider = await outsiderId('second-outsider@example.com')
    const page = await app.publish({ cookie: adminCookie }, 'Board memo', '<h1>memo</h1>', 'private')
    const now = Date.now()
    await app.repositories.outboundMail.record({ kind: 'share', senderId: adminId, workspaceId, count: 49, sentAt: now }, { scope: 'sender', max: 50, since: now - DAY_MS })

    const lastAllowed = await shareWith(page.artifactId, [firstOutsider])
    const overLimit = await shareWith(page.artifactId, [firstOutsider, secondOutsider])
    const sharingAfterRefusal = await app.json<{ grants: { userId: string }[] }>(`/api/artifacts/${page.artifactId}/sharing`, { cookie: adminCookie })
    const memberStillFine = await shareWith(page.artifactId, [firstOutsider, memberId])

    expect([lastAllowed.status, overLimit.status, memberStillFine.status]).toEqual([200, 429, 200])
    expect(overLimit.body.code).toBe('mail_limit_reached')
    expect(sharingAfterRefusal.body.grants.map(grant => grant.userId)).toEqual([firstOutsider])
    expect(app.mailer.lastTo('first-outsider@example.com')?.subject).toContain('Board memo')
    expect(app.mailer.lastTo('second-outsider@example.com')?.subject ?? '').not.toContain('Board memo')
  })
  it('counts mail to an address with no account against the same cap', async () => {
    const sharerCookie = await app.signIn('sharer@example.com')
    const sharerId = (await app.json<{ user: { userId: string } }>('/api/me', { cookie: sharerCookie })).body.user.userId
    const page = await app.publish({ cookie: sharerCookie }, 'Offsite agenda', '<h1>agenda</h1>', 'private')
    const now = Date.now()
    await app.repositories.outboundMail.record({ kind: 'share', senderId: sharerId, workspaceId, count: 50, sentAt: now }, { scope: 'sender', max: 50, since: now - DAY_MS })

    const overLimit = await app.json<{ code?: string }>(`/api/artifacts/${page.artifactId}/sharing`, { method: 'PUT', cookie: sharerCookie, body: { visibility: 'specified', grants: [{ email: 'not-yet@example.com', role: 'viewer' }] } })

    expect(overLimit.status).toBe(429)
    expect(app.mailer.lastTo('not-yet@example.com')).toBeUndefined()
  })
})
