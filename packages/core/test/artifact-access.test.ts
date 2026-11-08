import { describe, expect, it } from 'vitest'
import { ArtifactAccess } from '../src/artifact-access.ts'
import { ArtifactRemoval } from '../src/artifact-removal.ts'
import type { ArtifactViewer } from '../src/artifact-access.ts'
import type { ArtifactSharing, ArtifactSummary } from '../src/artifact-repository.ts'

const now = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000
const authorId = 'user-author'

function artifactWith(sharing: Partial<ArtifactSharing>, removal: ArtifactRemoval | null = null): ArtifactSummary {
  return {
    artifactId: 'artifact-1',
    shortId: 'k7f3q9x2m4ab',
    slug: 'roadmap',
    workspaceId: 'workspace-1',
    title: 'Design doc',
    authorId,
    sharing: { visibility: 'workspace', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: false, ...sharing },
    version: 1,
    publishedVia: null,
    updatedAt: now,
    removal,
    summary: null,
    currentVersionNote: null,
    currentVersionAt: now,
  }
}

const author: ArtifactViewer = { userId: authorId, workspaceRole: 'member', grantRole: null, publicLinkUnlocked: false, tokenScope: null }
const member: ArtifactViewer = { userId: 'user-member', workspaceRole: 'member', grantRole: null, publicLinkUnlocked: false, tokenScope: null }
const admin: ArtifactViewer = { ...member, userId: 'user-admin', workspaceRole: 'admin' }
const outsider: ArtifactViewer = { userId: 'user-outsider', workspaceRole: null, grantRole: null, publicLinkUnlocked: false, tokenScope: null }
const anonymous: ArtifactViewer = { userId: null, workspaceRole: null, grantRole: null, publicLinkUnlocked: true, tokenScope: null }
const lockedAnonymous: ArtifactViewer = { ...anonymous, publicLinkUnlocked: false }

function permissions(sharing: Partial<ArtifactSharing>, viewer: ArtifactViewer, publicLinksEnabled = true) {
  return new ArtifactAccess(artifactWith(sharing), publicLinksEnabled, now).permissionsFor(viewer)
}

describe('ArtifactAccess', () => {
  it('gives the author every permission whatever the visibility', () => {
    expect(permissions({ visibility: 'private' }, author)).toEqual({
      canView: true,
      canComment: true,
      canEdit: true,
      canManageSharing: true,
      canWriteSharedData: true,
      canRename: true,
      canRemove: true,
      canRestore: false,
      canReadComments: true,
      canSeeVersions: true,
      canBrowseSharedData: true,
      needsPublicLinkPassword: false,
    })
  })

  it('keeps a private artifact from everyone else, grants and admins included', () => {
    expect(permissions({ visibility: 'private' }, { ...member, grantRole: 'editor' }).canView).toBe(false)
    expect(permissions({ visibility: 'private' }, admin).canView).toBe(false)
  })

  it('lets workspace members view, comment and use shared data, but not edit', () => {
    expect(permissions({ visibility: 'workspace' }, member)).toMatchObject({ canView: true, canComment: true, canWriteSharedData: true, canEdit: false, canManageSharing: false })
    expect(permissions({ visibility: 'workspace' }, outsider).canView).toBe(false)
  })

  it('limits a specified artifact to granted people, each by role', () => {
    expect(permissions({ visibility: 'specified' }, member).canView).toBe(false)
    expect(permissions({ visibility: 'specified' }, { ...outsider, grantRole: 'viewer' })).toMatchObject({ canView: true, canComment: false, canWriteSharedData: true })
    expect(permissions({ visibility: 'specified' }, { ...member, grantRole: 'commenter' })).toMatchObject({ canComment: true, canEdit: false })
    expect(permissions({ visibility: 'specified' }, { ...member, grantRole: 'editor' })).toMatchObject({ canEdit: true, canManageSharing: false })
  })

  it('counts grants at every level except private, so one person can get more than everyone else', () => {
    const grantedOutsider: ArtifactViewer = { ...outsider, grantRole: 'editor' }
    const grantedMember: ArtifactViewer = { ...member, grantRole: 'editor' }

    expect(permissions({ visibility: 'specified' }, grantedOutsider).canEdit).toBe(true)
    expect(permissions({ visibility: 'workspace' }, grantedOutsider)).toMatchObject({ canView: true, canEdit: true })
    expect(permissions({ visibility: 'workspace' }, grantedMember)).toMatchObject({ canView: true, canEdit: true })
    expect(permissions({ visibility: 'workspace' }, member)).toMatchObject({ canView: true, canEdit: false })
    expect(permissions({ visibility: 'public_link' }, grantedMember).canEdit).toBe(true)
    expect(permissions({ visibility: 'private' }, grantedMember).canView).toBe(false)
  })

  it('lets anyone open an active public link but write shared data only when the author allows it', () => {
    expect(permissions({ visibility: 'public_link' }, anonymous)).toMatchObject({ canView: true, canComment: false, canWriteSharedData: false })
    expect(permissions({ visibility: 'public_link', anonymousWriteEnabled: true }, anonymous).canWriteSharedData).toBe(true)
    expect(permissions({ visibility: 'public_link' }, member).canComment).toBe(true)
  })

  it('shows a public-link visitor the current page alone, and comments only when the author turns them on', () => {
    expect(permissions({ visibility: 'public_link' }, anonymous)).toMatchObject({ canView: true, canReadComments: false, canSeeVersions: false, canBrowseSharedData: false })
    expect(permissions({ visibility: 'public_link', publicLinkShowsComments: true }, anonymous)).toMatchObject({ canReadComments: true, canComment: false, canSeeVersions: false })
    expect(permissions({ visibility: 'public_link' }, { ...outsider, publicLinkUnlocked: true })).toMatchObject({ canView: true, canReadComments: false, canSeeVersions: false })
  })

  it('keeps the whole artifact open to members and granted people when it also has a public link', () => {
    expect(permissions({ visibility: 'public_link' }, member)).toMatchObject({ canReadComments: true, canSeeVersions: true, canBrowseSharedData: true })
    expect(permissions({ visibility: 'specified' }, { ...outsider, grantRole: 'viewer' })).toMatchObject({ canReadComments: true, canSeeVersions: true, canBrowseSharedData: true })
  })

  it('asks for the password of a protected public link only when nothing else lets the viewer in', () => {
    expect(permissions({ visibility: 'public_link', publicLinkPasswordHash: 'hash' }, lockedAnonymous)).toMatchObject({ canView: false, needsPublicLinkPassword: true })
    expect(permissions({ visibility: 'public_link', publicLinkPasswordHash: 'hash' }, { ...member, publicLinkUnlocked: false })).toMatchObject({ canView: true, needsPublicLinkPassword: false })
  })

  it('closes a public link once it expires or the workspace switches public links off', () => {
    expect(permissions({ visibility: 'public_link', publicLinkExpiresAt: now - 1 }, anonymous).canView).toBe(false)
    expect(permissions({ visibility: 'public_link', publicLinkExpiresAt: now + 1 }, anonymous).canView).toBe(true)
    expect(permissions({ visibility: 'public_link' }, anonymous, false).canView).toBe(false)
    expect(permissions({ visibility: 'public_link' }, member, false).canView).toBe(true)
  })

  it('lets whoever may edit rename, and only the author or an admin remove', () => {
    expect(permissions({ visibility: 'specified' }, { ...member, grantRole: 'editor' })).toMatchObject({ canRename: true, canRemove: false })
    expect(permissions({ visibility: 'workspace' }, member)).toMatchObject({ canRename: false, canRemove: false })
    expect(permissions({ visibility: 'private' }, admin)).toMatchObject({ canView: false, canRename: false, canRemove: true })
  })

  it('shuts a removed artifact for everyone, and lets the author restore it unless an admin took it down', () => {
    const removedByAuthor = new ArtifactAccess(artifactWith({}, new ArtifactRemoval(now, authorId, false)), true, now)
    const takenDown = new ArtifactAccess(artifactWith({ visibility: 'public_link' }, new ArtifactRemoval(now, 'user-admin', true)), true, now)

    expect(removedByAuthor.permissionsFor(author)).toMatchObject({ canView: false, canEdit: false, canRemove: false, canRestore: true })
    expect(removedByAuthor.permissionsFor(member)).toMatchObject({ canView: false, canRestore: false })
    expect(removedByAuthor.permissionsFor(admin).canRestore).toBe(true)
    expect(takenDown.permissionsFor(author).canRestore).toBe(false)
    expect(takenDown.permissionsFor(admin).canRestore).toBe(true)
    expect(takenDown.permissionsFor(anonymous).canView).toBe(false)
  })

  it('stops restoring once the 30 days are over', () => {
    const removedAt = now - 30 * DAY
    const expired = new ArtifactAccess(artifactWith({}, new ArtifactRemoval(removedAt, authorId, false)), true, now)

    expect(expired.permissionsFor(author).canRestore).toBe(false)
    expect(expired.permissionsFor(admin).canRestore).toBe(false)
    expect(ArtifactRemoval.purgeCutoff(now)).toBe(removedAt)
  })

  it('lets a publish token do everything its person can except change who can see the artifact or remove it', () => {
    const authorAgent: ArtifactViewer = { ...author, tokenScope: 'publish' }
    const access = new ArtifactAccess(artifactWith({ visibility: 'workspace' }), true, now)

    expect(access.permissionsFor(authorAgent)).toMatchObject({ canView: true, canComment: true, canEdit: true, canRename: true, canWriteSharedData: true, canManageSharing: false, canRemove: false })
    expect(access.withheldByTokenScope(authorAgent)).toEqual(['canManageSharing', 'canRemove'])
    expect(access.permissionsFor({ ...author, tokenScope: 'full' })).toMatchObject({ canManageSharing: true, canRemove: true })
    expect(access.withheldByTokenScope({ ...author, tokenScope: 'full' })).toEqual([])
  })

  it('withholds by token scope only what the person could otherwise do', () => {
    const memberAgent: ArtifactViewer = { ...member, tokenScope: 'publish' }

    expect(new ArtifactAccess(artifactWith({ visibility: 'workspace' }), true, now).withheldByTokenScope(memberAgent)).toEqual([])
  })
})

describe('ArtifactAccess#shareReadiness', () => {
  const listedPublic: Partial<ArtifactSharing> = { visibility: 'public_link', listed: true }
  const readiness = (sharing: Partial<ArtifactSharing>, { publicLinksEnabled = true, removal = null as ArtifactRemoval | null } = {}) =>
    new ArtifactAccess(artifactWith(sharing, removal), publicLinksEnabled, now).shareReadiness

  it('names every reason a link cannot go out, and when a shareable one stops working', () => {
    expect(readiness(listedPublic)).toEqual({ kind: 'ready' })
    expect(readiness({ ...listedPublic, publicLinkExpiresAt: now + 5 * DAY })).toEqual({ kind: 'expires', at: now + 5 * DAY })
    expect(readiness({ visibility: 'public_link' })).toEqual({ kind: 'not_listed' })
    expect(readiness({ visibility: 'workspace' })).toEqual({ kind: 'not_public' })
    expect(readiness({ ...listedPublic, publicLinkExpiresAt: now - 1 })).toEqual({ kind: 'not_public' })
    expect(readiness({ ...listedPublic, publicLinkPasswordHash: 'hash' })).toEqual({ kind: 'has_password' })
    expect(readiness(listedPublic, { publicLinksEnabled: false })).toEqual({ kind: 'public_links_off' })
    expect(readiness(listedPublic, { removal: new ArtifactRemoval(now, authorId, false) })).toEqual({ kind: 'removed' })
  })

  it('is shareable exactly when the artifact is on the personal page', () => {
    const removed = new ArtifactRemoval(now, authorId, false)
    for (const visibility of ['private', 'specified', 'workspace', 'public_link'] as const)
      for (const listed of [true, false])
        for (const publicLinkPasswordHash of [null, 'hash'])
          for (const publicLinkExpiresAt of [null, now - 1, now + DAY])
            for (const publicLinksEnabled of [true, false])
              for (const removal of [null, removed]) {
                const access = new ArtifactAccess(artifactWith({ visibility, listed, publicLinkPasswordHash, publicLinkExpiresAt }, removal), publicLinksEnabled, now)
                const shareable = access.shareReadiness.kind === 'ready' || access.shareReadiness.kind === 'expires'
                const state = JSON.stringify({ visibility, listed, publicLinkPasswordHash, publicLinkExpiresAt, publicLinksEnabled, removed: removal !== null })
                expect(shareable, state).toBe(access.onPersonalPage)
              }
  })
})
