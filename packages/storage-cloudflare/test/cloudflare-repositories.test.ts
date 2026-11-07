import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
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

async function addUser(name: string): Promise<string> {
  const userId = `user-${name.toLowerCase()}`
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)')
    .bind(userId, name, `${name.toLowerCase()}@example.com`, now, now)
    .run()
  return userId
}

async function joinedFirstWorkspace(userId: string, newWorkspaceName = 'Design team') {
  const membership = await workspaceRepository.joinFirstWorkspace(userId, newWorkspaceName)
  if (!membership) throw new Error(`${userId} was not let into a workspace`)
  return membership
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
    files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('<h1>Sign up</h1>') }],
  })
}

describe('CloudflareWorkspaceRepository', () => {
  it('makes the first person the admin of a new workspace and adds later people as members', async () => {
    const founderId = await addUser('Lin')
    const colleagueId = await addUser('Zhou')

    const founderMembership = await joinedFirstWorkspace(founderId, 'Design team')
    const colleagueMembership = await joinedFirstWorkspace(colleagueId, 'Ignored name')
    const members = await workspaceRepository.listMembers(founderMembership.workspace.workspaceId)

    expect(founderMembership).toMatchObject({ role: 'admin', workspace: { name: 'Design team', publicLinksEnabled: true } })
    expect(colleagueMembership).toMatchObject({ role: 'member', workspace: { workspaceId: founderMembership.workspace.workspaceId } })
    expect(members.map(member => [member.name, member.role])).toEqual([
      ['Lin', 'admin'],
      ['Zhou', 'member'],
    ])
  })

  it('keeps a removed member out, even when they would join again', async () => {
    const adminId = await addUser('Lin')
    const leaverId = await addUser('Wang')
    const { workspace } = await joinedFirstWorkspace(adminId)
    await joinedFirstWorkspace(leaverId)

    const removal = await workspaceRepository.removeMember(workspace.workspaceId, leaverId, Date.now())
    const rejoin = await workspaceRepository.joinFirstWorkspace(leaverId, 'Design team')
    const secondRemoval = await workspaceRepository.removeMember(workspace.workspaceId, leaverId, Date.now())

    expect(removal).toBe('changed')
    expect(rejoin).toBeNull()
    expect(await workspaceRepository.membershipsOf(leaverId)).toEqual([])
    expect(secondRemoval).toBe('not_member')
  })

  it('lets only one of two admins step down when both try at once', async () => {
    const firstAdminId = await addUser('Lin')
    const secondAdminId = await addUser('Qian')
    const { workspace } = await joinedFirstWorkspace(firstAdminId)
    await joinedFirstWorkspace(secondAdminId)
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
    const { workspace } = await joinedFirstWorkspace(adminId)

    await workspaceRepository.setPublicLinksEnabled(workspace.workspaceId, false)

    const [membership] = await workspaceRepository.membershipsOf(adminId)
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
    workspaceId = (await joinedFirstWorkspace(authorId)).workspace.workspaceId
  })

  it('stores sharing settings and grants', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    const publicSharing = { visibility: 'public_link', publicLinkExpiresAt: 1_900_000_000_000, publicLinkPasswordHash: 'hash', anonymousWriteEnabled: true, publicLinkShowsComments: true, listed: false } as const
    await accessRepository.saveSharing(artifactId, publicSharing, [{ userId: reviewerId, role: 'commenter' }])
    await accessRepository.saveSharing(artifactId, publicSharing, [{ userId: reviewerId, role: 'editor' }])

    const summary = await artifactRepository.findSummary(artifactId)
    expect(summary?.sharing).toEqual({ visibility: 'public_link', publicLinkExpiresAt: 1_900_000_000_000, publicLinkPasswordHash: 'hash', anonymousWriteEnabled: true, publicLinkShowsComments: true, listed: false })
    expect(await accessRepository.listGrants(artifactId)).toEqual([{ artifactId, userId: reviewerId, role: 'editor' }])
    expect((await accessRepository.listGrantsOfUser(reviewerId)).map(grant => grant.artifactId)).toContain(artifactId)

    await accessRepository.saveSharing(artifactId, publicSharing, [])
    expect(await accessRepository.listGrants(artifactId)).toEqual([])
  })

  it('saves neither the sharing nor the people when one part of the save fails', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)
    const privateSharing = { visibility: 'private', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: false } as const

    const duplicatePerson = accessRepository.saveSharing(artifactId, { ...privateSharing, visibility: 'specified' }, [{ userId: reviewerId, role: 'viewer' }, { userId: reviewerId, role: 'editor' }])

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

  it('keeps shared documents per collection with who created and last changed them', async () => {
    const sharedDataRepository = new CloudflareSharedDataRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    await sharedDataRepository.putDocument(artifactId, 'signups', 'lin', { session: 'Morning' }, authorId)
    const updatedDocument = await sharedDataRepository.putDocument(artifactId, 'signups', 'lin', { session: 'Afternoon' }, reviewerId)
    await sharedDataRepository.putDocument(artifactId, 'votes', 'anonymous-1', { choice: 'A' }, null)

    expect(updatedDocument).toMatchObject({ data: { session: 'Afternoon' }, createdBy: authorId, updatedBy: reviewerId })
    expect(await sharedDataRepository.listCollections(artifactId)).toEqual([
      { collection: 'signups', documentCount: 1 },
      { collection: 'votes', documentCount: 1 },
    ])
    expect(await sharedDataRepository.deleteDocument(artifactId, 'votes', 'anonymous-1')).toBe(true)
    expect(await sharedDataRepository.deleteDocument(artifactId, 'votes', 'anonymous-1')).toBe(false)
    expect(await sharedDataRepository.listDocuments(artifactId, 'votes')).toEqual([])
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
    const workspaceId = (await joinedFirstWorkspace(authorId)).workspace.workspaceId
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
    const workspaceId = (await joinedFirstWorkspace(authorId)).workspace.workspaceId
    const publicSharing = { visibility: 'public_link', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false } as const
    const withOpening = await artifactRepository.create({ workspaceId, authorId, title: 'Opening', slug: 'opening', visibility: 'public_link', publicLinkExpiresAt: null, publishedVia: null, note: null, excerpt: '页面开头的话', listed: true, summary: null, files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })
    const withSummary = await artifactRepository.create({ workspaceId, authorId, title: 'Summarized', slug: 'summarized', visibility: 'public_link', publicLinkExpiresAt: null, publishedVia: null, note: null, excerpt: '页面开头的话', listed: true, summary: '作者写的摘要', files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })
    const unlisted = await createArtifactIn(workspaceId, authorId)
    await accessRepository.saveSharing(unlisted.artifactId, { ...publicSharing, listed: false }, [])

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
