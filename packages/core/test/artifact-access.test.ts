import { describe, expect, it } from 'vitest'
import { ArtifactAccess } from '../src/artifact-access.ts'
import type { ArtifactViewer } from '../src/artifact-access.ts'
import type { ArtifactSharing, ArtifactSummary } from '../src/artifact-repository.ts'

const now = 1_800_000_000_000
const authorId = 'user-author'

function artifactWith(sharing: Partial<ArtifactSharing>): ArtifactSummary {
  return {
    artifactId: 'artifact-1',
    workspaceId: 'workspace-1',
    title: 'Design doc',
    authorId,
    sharing: { visibility: 'workspace', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, ...sharing },
    version: 1,
    publishedVia: null,
    updatedAt: now,
  }
}

const author: ArtifactViewer = { userId: authorId, workspaceRole: 'member', grantRole: null, publicLinkUnlocked: false }
const member: ArtifactViewer = { userId: 'user-member', workspaceRole: 'member', grantRole: null, publicLinkUnlocked: false }
const admin: ArtifactViewer = { ...member, userId: 'user-admin', workspaceRole: 'admin' }
const outsider: ArtifactViewer = { userId: 'user-outsider', workspaceRole: null, grantRole: null, publicLinkUnlocked: false }
const anonymous: ArtifactViewer = { userId: null, workspaceRole: null, grantRole: null, publicLinkUnlocked: true }
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

  it('lets anyone open an active public link but write shared data only when the author allows it', () => {
    expect(permissions({ visibility: 'public_link' }, anonymous)).toMatchObject({ canView: true, canComment: false, canWriteSharedData: false })
    expect(permissions({ visibility: 'public_link', anonymousWriteEnabled: true }, anonymous).canWriteSharedData).toBe(true)
    expect(permissions({ visibility: 'public_link' }, member).canComment).toBe(true)
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
})
