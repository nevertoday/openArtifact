import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CloudflareAccessTokenRepository,
  CloudflareArtifactAccessRepository,
  CloudflareArtifactRepository,
  CloudflareCommentRepository,
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

async function createArtifactIn(workspaceId: string, authorId: string) {
  return artifactRepository.create({
    workspaceId,
    authorId,
    title: 'Signup sheet',
    visibility: 'workspace',
    publishedVia: null,
    files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('<h1>Sign up</h1>') }],
  })
}

describe('CloudflareWorkspaceRepository', () => {
  it('makes the first person the admin of a new workspace and adds later people as members', async () => {
    const founderId = await addUser('Lin')
    const colleagueId = await addUser('Zhou')

    const founderMembership = await workspaceRepository.joinFirstWorkspace(founderId, 'Design team')
    const colleagueMembership = await workspaceRepository.joinFirstWorkspace(colleagueId, 'Ignored name')
    const members = await workspaceRepository.listMembers(founderMembership.workspace.workspaceId)

    expect(founderMembership).toMatchObject({ role: 'admin', workspace: { name: 'Design team', publicLinksEnabled: true } })
    expect(colleagueMembership).toMatchObject({ role: 'member', workspace: { workspaceId: founderMembership.workspace.workspaceId } })
    expect(members.map(member => [member.name, member.role])).toEqual([
      ['Lin', 'admin'],
      ['Zhou', 'member'],
    ])
  })

  it('switches public links off for a whole workspace', async () => {
    const adminId = await addUser('Lin')
    const { workspace } = await workspaceRepository.joinFirstWorkspace(adminId, 'Design team')

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
    workspaceId = (await workspaceRepository.joinFirstWorkspace(authorId, 'Design team')).workspace.workspaceId
  })

  it('stores sharing settings and grants', async () => {
    const accessRepository = new CloudflareArtifactAccessRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    await accessRepository.updateSharing(artifactId, { visibility: 'public_link', publicLinkExpiresAt: 1_900_000_000_000, publicLinkPasswordHash: 'hash', anonymousWriteEnabled: true })
    await accessRepository.setGrant({ artifactId, userId: reviewerId, role: 'commenter' })
    await accessRepository.setGrant({ artifactId, userId: reviewerId, role: 'editor' })

    const summary = await artifactRepository.findSummary(artifactId)
    expect(summary?.sharing).toEqual({ visibility: 'public_link', publicLinkExpiresAt: 1_900_000_000_000, publicLinkPasswordHash: 'hash', anonymousWriteEnabled: true })
    expect(await accessRepository.listGrants(artifactId)).toEqual([{ artifactId, userId: reviewerId, role: 'editor' }])
    expect((await accessRepository.listGrantsOfUser(reviewerId)).map(grant => grant.artifactId)).toContain(artifactId)

    await accessRepository.removeGrant(artifactId, reviewerId)
    expect(await accessRepository.listGrants(artifactId)).toEqual([])
  })

  it('threads comments, counts the ones waiting for an agent, and resolves them', async () => {
    const commentRepository = new CloudflareCommentRepository(env.DB)
    const { artifactId } = await createArtifactIn(workspaceId, authorId)

    const agentRequest = await commentRepository.add({ artifactId, parentId: null, authorId: reviewerId, body: 'Add the R2 write to the diagram', forAgent: true, postedVia: null, anchor: { x: 0.25, y: 0.5 } })
    await commentRepository.add({ artifactId, parentId: agentRequest.commentId, authorId, body: 'Done in v2', forAgent: false, postedVia: 'Claude Code', anchor: null })
    const waitingBefore = await commentRepository.countWaitingForAgent(workspaceId)
    await commentRepository.setResolved(agentRequest.commentId, authorId)
    const waitingAfter = await commentRepository.countWaitingForAgent(workspaceId)

    const thread = await commentRepository.listForArtifact(artifactId)
    expect(thread.map(comment => [comment.body, comment.parentId === agentRequest.commentId, comment.postedVia])).toEqual([
      ['Add the R2 write to the diagram', false, null],
      ['Done in v2', true, 'Claude Code'],
    ])
    expect(waitingBefore.get(artifactId)).toBe(1)
    expect(waitingAfter.get(artifactId)).toBeUndefined()
    expect(await commentRepository.find(agentRequest.commentId)).toMatchObject({ resolvedBy: authorId, forAgent: true, anchor: { x: 0.25, y: 0.5 } })

    await commentRepository.setResolved(agentRequest.commentId, null)
    expect(await commentRepository.find(agentRequest.commentId)).toMatchObject({ resolvedAt: null, resolvedBy: null })
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

  it('accepts a token only while it is neither revoked nor expired', async () => {
    const tokenRepository = new CloudflareAccessTokenRepository(env.DB)
    const now = Date.now()
    const activeToken = await tokenRepository.create({ userId: authorId, workspaceId, name: 'Claude Code', tokenHash: 'hash-active', expiresAt: now + 60_000 })
    await tokenRepository.create({ userId: authorId, workspaceId, name: 'Old CI', tokenHash: 'hash-expired', expiresAt: now - 1 })

    const usedToken = await tokenRepository.useActiveToken('hash-active', now)
    const expiredToken = await tokenRepository.useActiveToken('hash-expired', now)
    const revokedByStranger = await tokenRepository.revoke(activeToken.tokenId, reviewerId)
    const revokedByOwner = await tokenRepository.revoke(activeToken.tokenId, authorId)

    expect(usedToken).toMatchObject({ tokenId: activeToken.tokenId, lastUsedAt: now })
    expect(expiredToken).toBeNull()
    expect(revokedByStranger).toBe(false)
    expect(revokedByOwner).toBe(true)
    expect(await tokenRepository.useActiveToken('hash-active', now)).toBeNull()
    expect((await tokenRepository.listForUser(authorId)).map(token => token.name)).toEqual(expect.arrayContaining(['Claude Code', 'Old CI']))
  })
})
