import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Membership } from '@open-artifact/core'
import {
  CloudflareAccessTokenRepository,
  CloudflareArtifactAccessRepository,
  CloudflareArtifactRepository,
  CloudflareCommentRepository,
  CloudflareProfileRepository,
  CloudflareSharedDataRepository,
  CloudflareUserDirectory,
  CloudflareWorkspaceRepository,
} from '../src/index.ts'

const artifactRepository = new CloudflareArtifactRepository(env.DB, env.FILES)
const workspaceRepository = new CloudflareWorkspaceRepository(env.DB)
const ROOMY = { maxDocuments: 2000, maxBytes: 5 * 1024 ** 2 }

async function createWorkspace(name: string, creatorId: string, createdAt: number): Promise<Membership> {
  const membership = await workspaceRepository.create(name, creatorId, createdAt, { max: Number.MAX_SAFE_INTEGER })
  if (membership === null) throw new Error(`workspace ${name} was not created`)
  return membership
}

async function addUser(name: string): Promise<string> {
  const userId = `user-${name.toLowerCase()}`
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
    .bind(userId, name, `${name.toLowerCase()}@example.com`, now, now)
    .run()
  return userId
}

// The team a test works in: the first person to join a name creates the workspace as its admin, later people join it.
async function joinedTeam(userId: string, teamName = 'Design team') {
  const teamId = await env.DB.prepare('SELECT id FROM workspaces WHERE name = ? AND personal_of IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1').bind(teamName).first<string>('id')
  if (teamId === null) return createWorkspace(teamName, userId, Date.now())
  const joinResult = await workspaceRepository.join(teamId, userId, Date.now(), { readmitsRemoved: false })
  if (joinResult.status === 'removed') throw new Error(`${userId} was not let into ${teamName}`)
  return joinResult.membership
}

async function createArtifactIn(workspaceId: string, authorId: string) {
  return artifactRepository.create({
    workspaceId,
    authorId,
    title: 'Signup sheet',
    slug: 'signup-sheet',
    visibility: 'workspace',
    publicLinkExpiresAt: null,
    publishedVia: null,
    note: null,
    excerpt: null,
    listed: false,
    summary: null,
    shareText: null,
    files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('<h1>Sign up</h1>') }],
  })
}

describe('CloudflareWorkspaceRepository', () => {
  it('makes the creator of a workspace its admin and adds people who join as members', async () => {
    const founderId = await addUser('Lin')
    const colleagueId = await addUser('Zhou')

    const founderMembership = await createWorkspace('Founders', founderId, Date.now())
    const colleagueJoin = await workspaceRepository.join(founderMembership.workspace.workspaceId, colleagueId, Date.now(), { readmitsRemoved: false })
    const members = await workspaceRepository.listMembers(founderMembership.workspace.workspaceId)

    expect(founderMembership).toMatchObject({ role: 'admin', workspace: { name: 'Founders', publicLinksEnabled: true, personalOf: null } })
    expect(colleagueJoin).toMatchObject({ status: 'joined', membership: { role: 'member', workspace: { workspaceId: founderMembership.workspace.workspaceId } } })
    expect(members.map(member => [member.name, member.role])).toEqual([
      ['Lin', 'admin'],
      ['Zhou', 'member'],
    ])
  })

  it('keeps a removed member out unless the join readmits them, and lets a person who left back through any join', async () => {
    const adminId = await addUser('Lin')
    const removedId = await addUser('Wang')
    const leaverId = await addUser('Sun')
    const { workspace } = await createWorkspace('Leavers', adminId, Date.now())
    await workspaceRepository.join(workspace.workspaceId, removedId, Date.now(), { readmitsRemoved: false })
    await workspaceRepository.join(workspace.workspaceId, leaverId, Date.now(), { readmitsRemoved: false })

    const removal = await workspaceRepository.removeMember(workspace.workspaceId, removedId, Date.now())
    const leaving = await workspaceRepository.leave(workspace.workspaceId, leaverId, Date.now())
    const removedRejoin = await workspaceRepository.join(workspace.workspaceId, removedId, Date.now(), { readmitsRemoved: false })
    const leaverRejoin = await workspaceRepository.join(workspace.workspaceId, leaverId, Date.now(), { readmitsRemoved: false })
    const secondRemoval = await workspaceRepository.removeMember(workspace.workspaceId, removedId, Date.now())
    const readmission = await workspaceRepository.join(workspace.workspaceId, removedId, Date.now(), { readmitsRemoved: true })

    expect([removal, leaving]).toEqual(['changed', 'changed'])
    expect(removedRejoin).toEqual({ status: 'removed' })
    expect(leaverRejoin).toMatchObject({ status: 'joined', membership: { role: 'member' } })
    expect(secondRemoval).toBe('not_member')
    expect(readmission).toMatchObject({ status: 'joined', membership: { role: 'member' } })
  })

  it('creates one personal workspace however many requests ask at once, and lists it first', async () => {
    const ownerId = await addUser('Gao')
    await createWorkspace('Earlier team', ownerId, Date.now() - 1000)

    const personalMemberships = await Promise.all(Array.from({ length: 6 }, () => workspaceRepository.ensurePersonal(ownerId, 'Gao 的工作区', Date.now())))
    const memberships = await workspaceRepository.membershipsOf(ownerId)

    expect(new Set(personalMemberships.map(membership => membership.workspace.workspaceId)).size).toBe(1)
    expect(memberships.map(membership => [membership.workspace.name, membership.workspace.personalOf, membership.role])).toEqual([
      ['Gao 的工作区', ownerId, 'admin'],
      ['Earlier team', null, 'admin'],
    ])
  })

  it('keeps a person admin of their personal workspace: they cannot leave, be removed, be demoted, or delete it', async () => {
    const ownerId = await addUser('He')
    const guestId = await addUser('Xu')
    const { workspace } = await workspaceRepository.ensurePersonal(ownerId, 'He 的工作区', Date.now())
    await workspaceRepository.join(workspace.workspaceId, guestId, Date.now(), { readmitsRemoved: false })
    await workspaceRepository.changeRole(workspace.workspaceId, guestId, 'admin')

    expect(await workspaceRepository.leave(workspace.workspaceId, ownerId, Date.now())).toBe('personal_workspace')
    expect(await workspaceRepository.removeMember(workspace.workspaceId, ownerId, Date.now())).toBe('personal_workspace')
    expect(await workspaceRepository.changeRole(workspace.workspaceId, ownerId, 'member')).toBe('personal_workspace')
    expect(await workspaceRepository.delete(workspace.workspaceId, Date.now())).toBe(false)
    expect(await workspaceRepository.leave(workspace.workspaceId, guestId, Date.now())).toBe('changed')
  })

  it('hides a deleted workspace from everyone until an admin restores it within the window', async () => {
    const adminId = await addUser('Ma')
    const memberId = await addUser('Lu')
    const { workspace } = await createWorkspace('Short lived', adminId, Date.now())
    await workspaceRepository.join(workspace.workspaceId, memberId, Date.now(), { readmitsRemoved: false })
    const deletedAt = Date.now()

    expect(await workspaceRepository.delete(workspace.workspaceId, deletedAt)).toBe(true)
    expect(await workspaceRepository.findWorkspace(workspace.workspaceId)).toBeNull()
    expect((await workspaceRepository.membershipsOf(memberId)).map(membership => membership.workspace.workspaceId)).not.toContain(workspace.workspaceId)
    expect(await workspaceRepository.listRestorable(adminId, deletedAt - 1)).toEqual([{ workspace: { ...workspace }, deletedAt }])
    expect(await workspaceRepository.listRestorable(memberId, deletedAt - 1)).toEqual([])
    expect(await workspaceRepository.restore(workspace.workspaceId, memberId, deletedAt - 1)).toBe(false)
    expect(await workspaceRepository.restore(workspace.workspaceId, adminId, deletedAt)).toBe(false)

    expect(await workspaceRepository.restore(workspace.workspaceId, adminId, deletedAt - 1)).toBe(true)
    expect(await workspaceRepository.findWorkspace(workspace.workspaceId)).toMatchObject({ name: 'Short lived' })
  })

  it('lets only one of two admins step down when both try at once', async () => {
    const firstAdminId = await addUser('Lin')
    const secondAdminId = await addUser('Qian')
    const { workspace } = await joinedTeam(firstAdminId)
    await joinedTeam(secondAdminId)
    await workspaceRepository.changeRole(workspace.workspaceId, secondAdminId, 'admin')

    const outcomes = await Promise.all([
      workspaceRepository.changeRole(workspace.workspaceId, firstAdminId, 'member'),
      workspaceRepository.removeMember(workspace.workspaceId, secondAdminId, Date.now()),
    ])
    const admins = (await workspaceRepository.listMembers(workspace.workspaceId)).filter(member => member.role === 'admin')

    expect([...outcomes].sort()).toEqual(['changed', 'last_admin'])
    expect(admins).toHaveLength(1)
  })

  it('switches public links off for a whole workspace', async () => {
    const adminId = await addUser('Lin')
    const { workspace } = await joinedTeam(adminId)

    await workspaceRepository.setPublicLinksEnabled(workspace.workspaceId, false)

    const membership = (await workspaceRepository.membershipsOf(adminId)).find(candidate => candidate.workspace.workspaceId === workspace.workspaceId)
    expect(membership?.workspace.publicLinksEnabled).toBe(false)
    expect(await workspaceRepository.findWorkspace(workspace.workspaceId)).toMatchObject({ name: 'Design team', publicLinksEnabled: false })
    expect(await workspaceRepository.findWorkspace('workspace-unknown')).toBeNull()
    await workspaceRepository.setPublicLinksEnabled(workspace.workspaceId, true)
  })
})

describe('CloudflareUserDirectory', () => {
  it('finds people by id and by email in any letter case', async () => {
    const userDirectory = new CloudflareUserDirectory(env.DB)
    const linId = await addUser('Lin')
    expect(await userDirectory.hasAnyUser()).toBe(true)

    const profiles = await userDirectory.profilesOf([linId, linId, 'user-unknown'])
    const foundByEmail = await userDirectory.findByEmail(' LIN@example.com ')

    expect([...profiles.keys()]).toEqual([linId])
    expect(foundByEmail?.userId).toBe(linId)
    expect(await userDirectory.profilesOf([])).toEqual(new Map())
  })
})

describe('artifact access, comments and shared data', () => {
  let workspaceId = ''
  let authorId = ''
  let reviewerId = ''

  beforeAll(async () => {
    authorId = await addUser('Lin')
    reviewerId = await addUser('Chen')
    workspaceId = (await joinedTeam(authorId)).workspace.workspaceId
  })

  it('stores sharing settings and grants', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    const publicSharing = { visibility: 'public_link', publicLinkExpiresAt: 1_900_000_000_000, publicLinkPasswordHash: 'hash', anonymousWriteEnabled: true, publicLinkShowsComments: true, listed: false } as const
    await accessRepository.saveSharing(artifactId, publicSharing, [{ userId: reviewerId, role: 'commenter' }], [])
    await accessRepository.saveSharing(artifactId, publicSharing, [{ userId: reviewerId, role: 'editor' }], [])

    const summary = await artifactRepository.findSummary(artifactId)
    expect(summary?.sharing).toEqual({ visibility: 'public_link', publicLinkExpiresAt: 1_900_000_000_000, publicLinkPasswordHash: 'hash', anonymousWriteEnabled: true, publicLinkShowsComments: true, listed: false })
    expect(await accessRepository.listGrants(artifactId)).toEqual([{ artifactId, userId: reviewerId, role: 'editor' }])
    expect((await accessRepository.listGrantsOfUser(reviewerId)).map(grant => grant.artifactId)).toContain(artifactId)

    await accessRepository.saveSharing(artifactId, publicSharing, [], [])
    expect(await accessRepository.listGrants(artifactId)).toEqual([])
  })

  it('saves neither the sharing nor the people when one part of the save fails', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)
    const privateSharing = { visibility: 'private', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: false } as const

    const duplicatePerson = accessRepository.saveSharing(artifactId, { ...privateSharing, visibility: 'specified' }, [{ userId: reviewerId, role: 'viewer' }, { userId: reviewerId, role: 'editor' }], [])

    await expect(duplicatePerson).rejects.toThrow()
    expect((await artifactRepository.findSummary(artifactId))?.sharing.visibility).toBe('workspace')
    expect(await accessRepository.listGrants(artifactId)).toEqual([])
  })

  it('threads comments, lists the open threads of a workspace, and resolves them', async () => {
    const commentRepository = new CloudflareCommentRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    const agentRequest = await commentRepository.add({ artifactId, parentId: null, authorId: reviewerId, body: 'Add the R2 write to the diagram', forAgent: true, postedVia: null, anchor: { x: 0.25, y: 0.5, version: 1, selector: 'main > h2', textQuote: 'Storage', quote: { exact: 'R2', prefix: 'the ', suffix: ' write' } } })
    await commentRepository.add({ artifactId, parentId: agentRequest.commentId, authorId, body: 'Done in v2', forAgent: false, postedVia: 'Claude Code', anchor: null })
    const openBefore = await commentRepository.listInOpenThreads(workspaceId)
    await commentRepository.setResolved(agentRequest.commentId, authorId)
    const openAfter = await commentRepository.listInOpenThreads(workspaceId)

    const thread = await commentRepository.listForArtifact(artifactId)
    expect(thread.map(comment => [comment.body, comment.parentId === agentRequest.commentId, comment.postedVia])).toEqual([
      ['Add the R2 write to the diagram', false, null],
      ['Done in v2', true, 'Claude Code'],
    ])
    expect(openBefore.filter(comment => comment.artifactId === artifactId).map(comment => comment.body)).toEqual(['Add the R2 write to the diagram', 'Done in v2'])
    expect(openAfter.filter(comment => comment.artifactId === artifactId)).toEqual([])
    expect(await commentRepository.find(agentRequest.commentId)).toMatchObject({ resolvedBy: authorId, forAgent: true, anchor: { x: 0.25, y: 0.5, version: 1, selector: 'main > h2', textQuote: 'Storage', quote: { exact: 'R2', prefix: 'the ', suffix: ' write' } } })

    await commentRepository.setResolved(agentRequest.commentId, null)
    expect(await commentRepository.find(agentRequest.commentId)).toMatchObject({ resolvedAt: null, resolvedBy: null })
  })

  it('reads an anchor saved before versions and elements were recorded', async () => {
    const commentRepository = new CloudflareCommentRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)
    await env.DB.prepare('INSERT INTO comments (id, artifact_id, author_id, body, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('old-pinned-comment', artifactId, reviewerId, 'old pin', JSON.stringify({ x: 0.1, y: 0.2 }), Date.now())
      .run()

    expect((await commentRepository.find('old-pinned-comment'))?.anchor).toEqual({ x: 0.1, y: 0.2, version: null, selector: null, textQuote: null, quote: null })
  })

  it('lets one person create no more workspaces than the cap, even at once, not counting their personal one', async () => {
    const creatorId = `creator-${crypto.randomUUID()}`
    await workspaceRepository.ensurePersonal(creatorId, 'Mine', Date.now())

    const racing = await Promise.all(Array.from({ length: 8 }, (_, index) => workspaceRepository.create(`Team ${index}`, creatorId, Date.now(), { max: 3 })))
    const memberships = await workspaceRepository.membershipsOf(creatorId)
    const someoneElse = await workspaceRepository.create('Theirs', `other-${crypto.randomUUID()}`, Date.now(), { max: 3 })

    expect(racing.filter(created => created !== null)).toHaveLength(3)
    expect(memberships).toHaveLength(4)
    expect(someoneElse).not.toBeNull()
  })

  it('keeps shared documents per collection with who created and last changed them', async () => {
    const sharedDataRepository = new CloudflareSharedDataRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    await sharedDataRepository.putDocument(artifactId, 'signups', 'lin', { session: 'Morning' }, authorId, ROOMY)
    const updatedDocument = await sharedDataRepository.putDocument(artifactId, 'signups', 'lin', { session: 'Afternoon' }, reviewerId, ROOMY)
    await sharedDataRepository.putDocument(artifactId, 'votes', 'anonymous-1', { choice: 'A' }, null, ROOMY)

    expect(updatedDocument).toMatchObject({ data: { session: 'Afternoon' }, createdBy: authorId, updatedBy: reviewerId })
    expect(await sharedDataRepository.listCollections(artifactId)).toEqual([
      { collection: 'signups', documentCount: 1 },
      { collection: 'votes', documentCount: 1 },
    ])
    expect(await sharedDataRepository.deleteDocument(artifactId, 'votes', 'anonymous-1')).toBe(true)
    expect(await sharedDataRepository.deleteDocument(artifactId, 'votes', 'anonymous-1')).toBe(false)
    expect(await sharedDataRepository.listDocuments(artifactId, 'votes')).toEqual([])
  })

  it('keeps an artifact\'s shared data within its cap on documents and bytes, even under concurrent writes', async () => {
    const sharedDataRepository = new CloudflareSharedDataRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)
    const { artifactId: otherArtifactId } = await createArtifactIn(workspaceId, authorId)
    const documentCap = { maxDocuments: 5, maxBytes: 1_000_000 }

    const racing = await Promise.all(Array.from({ length: 12 }, (_, index) => sharedDataRepository.putDocument(artifactId, 'votes', `v${index}`, { choice: index }, null, documentCap)))
    const savedId = racing.find(saved => saved !== null)?.documentId ?? ''
    const replacedWhenFull = await sharedDataRepository.putDocument(artifactId, 'votes', savedId, { choice: 'changed' }, null, documentCap)
    const otherArtifact = await sharedDataRepository.putDocument(otherArtifactId, 'votes', 'v0', { choice: 0 }, null, documentCap)
    const byteCap = { maxDocuments: 100, maxBytes: 30 }
    const fitting = await sharedDataRepository.putDocument(otherArtifactId, 'notes', 'n', { text: 'x'.repeat(4) }, null, byteCap)
    const overBytes = await sharedDataRepository.putDocument(otherArtifactId, 'notes', 'm', { text: '汉' }, null, byteCap)
    const shrinking = await sharedDataRepository.putDocument(otherArtifactId, 'notes', 'n', { text: '' }, null, byteCap)

    expect(racing.filter(saved => saved !== null)).toHaveLength(5)
    expect(replacedWhenFull?.data).toEqual({ choice: 'changed' })
    expect(otherArtifact).not.toBeNull()
    expect(fitting).not.toBeNull()
    expect(overBytes).toBeNull()
    expect(shrinking).not.toBeNull()
  })

  it('accepts a token only while it is neither revoked nor expired, and says which it is', async () => {
    const tokenRepository = new CloudflareAccessTokenRepository(env.DB)
    const now = Date.now()
    const activeToken = await tokenRepository.create({ userId: authorId, workspaceId, name: 'Claude Code', tokenHash: 'hash-active', expiresAt: now + 60_000, scope: 'publish' })
    await tokenRepository.create({ userId: authorId, workspaceId, name: 'Old CI', tokenHash: 'hash-expired', expiresAt: now - 1, scope: 'full' })

    const usedToken = await tokenRepository.useToken('hash-active', now)
    const expiredToken = await tokenRepository.useToken('hash-expired', now)
    const revokedByStranger = await tokenRepository.revoke(activeToken.tokenId, reviewerId)
    const revokedByOwner = await tokenRepository.revoke(activeToken.tokenId, authorId)

    expect(usedToken).toMatchObject({ status: 'active', accessToken: { tokenId: activeToken.tokenId, lastUsedAt: now } })
    expect(expiredToken).toEqual({ status: 'expired' })
    expect(revokedByStranger).toBe(false)
    expect(revokedByOwner).toBe(true)
    expect(await tokenRepository.useToken('hash-active', now)).toEqual({ status: 'revoked' })
    expect(await tokenRepository.useToken('hash-never-issued', now)).toEqual({ status: 'unknown' })
    expect((await tokenRepository.listForUser(authorId)).map(token => token.name)).toEqual(expect.arrayContaining(['Claude Code', 'Old CI']))
  })

  it('keeps each token\'s scope, and gives tokens made before scopes existed full access', async () => {
    const tokenRepository = new CloudflareAccessTokenRepository(env.DB)
    const now = Date.now()
    await tokenRepository.create({ userId: authorId, workspaceId, name: 'Publisher', tokenHash: 'hash-publish', expiresAt: null, scope: 'publish' })
    await env.DB.prepare('INSERT INTO personal_access_tokens (id, user_id, workspace_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('token-before-scopes', authorId, workspaceId, 'Older laptop', 'hash-before-scopes', now)
      .run()

    expect(await tokenRepository.useToken('hash-publish', now)).toMatchObject({ accessToken: { name: 'Publisher', scope: 'publish' } })
    expect(await tokenRepository.useToken('hash-before-scopes', now)).toMatchObject({ accessToken: { name: 'Older laptop', scope: 'full' } })
  })
})

describe('pending grants', () => {
  it('become grants for the account that signs up with the address, once, keeping a grant the person already has', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const authorId = await addUser('PendingAuthor')
    const membership = await joinedTeam(authorId)
    const draft = await createArtifactIn(membership.workspace.workspaceId, authorId)
    const notes = await createArtifactIn(membership.workspace.workspaceId, authorId)
    const sharing = { visibility: 'specified' as const, publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: false }
    const newcomerId = await addUser('Newcomer')
    await accessRepository.saveSharing(draft.artifactId, sharing, [], [{ email: 'newcomer@example.com', role: 'editor', grantedBy: authorId, createdAt: 1 }])
    await accessRepository.saveSharing(notes.artifactId, sharing, [{ userId: newcomerId, role: 'viewer' }], [{ email: 'newcomer@example.com', role: 'editor', grantedBy: authorId, createdAt: 1 }])

    await accessRepository.claimPendingGrants('newcomer@example.com', newcomerId)
    await accessRepository.claimPendingGrants('newcomer@example.com', newcomerId)

    expect(await accessRepository.listGrants(draft.artifactId)).toEqual([{ artifactId: draft.artifactId, userId: newcomerId, role: 'editor' }])
    expect(await accessRepository.listGrants(notes.artifactId)).toEqual([{ artifactId: notes.artifactId, userId: newcomerId, role: 'viewer' }])
    expect(await accessRepository.listPendingGrants(draft.artifactId)).toEqual([])
  })
})

describe('CloudflareProfileRepository', () => {
  const profileRepository = new CloudflareProfileRepository(env.DB)

  it('gives two people with one name their own handles, and moves a handle when the name changes', async () => {
    const firstLin = await profileRepository.claim('user-lin-1', ['lin', 'lin-2'])
    const secondLin = await profileRepository.claim('user-lin-2', ['lin', 'lin-2'])
    const firstLinAgain = await profileRepository.claim('user-lin-1', ['LIN', 'lin-2'])
    const renamed = await profileRepository.claim('user-lin-2', ['lin.yang', 'lin.yang-2'])

    expect([firstLin.handle, secondLin.handle, firstLinAgain.handle]).toEqual(['lin', 'lin-2', 'lin'])
    expect(renamed.handle).toBe('lin.yang')
    expect((await profileRepository.findByHandle('LIN.YANG'))?.userId).toBe('user-lin-2')
    expect(await profileRepository.findByHandle('lin-2')).toBeNull()
  })

  it('changes the bio and the pinned artifact separately', async () => {
    const authorId = await addUser('Pinner')
    const workspaceId = (await joinedTeam(authorId)).workspace.workspaceId
    const { artifactId } = await createArtifactIn(workspaceId, authorId)
    await profileRepository.claim(authorId, ['pinner'])

    await profileRepository.update(authorId, { bio: '写规则的人' })
    const pinned = await profileRepository.update(authorId, { pinnedArtifactId: artifactId })
    const bioKept = await profileRepository.update(authorId, { bio: '写规则和评审的人' })
    const unpinned = await profileRepository.update(authorId, { pinnedArtifactId: null })

    expect(pinned).toMatchObject({ bio: '写规则的人', pinnedArtifactId: artifactId })
    expect(bioKept.pinnedArtifactId).toBe(artifactId)
    expect(unpinned).toMatchObject({ bio: '写规则和评审的人', pinnedArtifactId: null })
  })
})

describe('listing on a personal page', () => {
  it('lists the author’s listed, active artifacts with the summary they wrote or the page’s opening words', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const authorId = await addUser('Lister')
    const workspaceId = (await joinedTeam(authorId)).workspace.workspaceId
    const publicSharing = { visibility: 'public_link', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false } as const
    const withOpening = await artifactRepository.create({ workspaceId, authorId, title: 'Opening', slug: 'opening', visibility: 'public_link', publicLinkExpiresAt: null, publishedVia: null, note: null, excerpt: '页面开头的话', listed: true, summary: null, shareText: null, files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })
    const withSummary = await artifactRepository.create({ workspaceId, authorId, title: 'Summarized', slug: 'summarized', visibility: 'public_link', publicLinkExpiresAt: null, publishedVia: null, note: null, excerpt: '页面开头的话', listed: true, summary: '作者写的摘要', shareText: null, files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })
    const unlisted = await createArtifactIn(workspaceId, authorId)
    await accessRepository.saveSharing(unlisted.artifactId, { ...publicSharing, listed: false }, [], [])

    const listed = await artifactRepository.listListedBy(authorId)
    await artifactRepository.setSummary(withSummary.artifactId, null)
    const summaryCleared = await artifactRepository.findSummary(withSummary.artifactId)

    expect(listed.map(summary => [summary.artifactId, summary.summary])).toEqual([
      [withSummary.artifactId, '作者写的摘要'],
      [withOpening.artifactId, '页面开头的话'],
    ])
    expect(summaryCleared?.summary).toBe('页面开头的话')
  })
})
