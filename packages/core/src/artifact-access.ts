import type { GrantRole } from './artifact-access-repository.ts'
import type { ArtifactSummary } from './artifact-repository.ts'
import type { WorkspaceRole } from './workspace-repository.ts'

export interface ArtifactViewer {
  /** null for an anonymous visitor of a public link. */
  userId: string | null
  /** The viewer's role in the artifact's workspace; null when they are not a member. */
  workspaceRole: WorkspaceRole | null
  grantRole: GrantRole | null
  /** The viewer has entered the public link's password, or the link has none. */
  publicLinkUnlocked: boolean
}

export interface ArtifactPermissions {
  canView: boolean
  canComment: boolean
  canEdit: boolean
  canManageSharing: boolean
  canWriteSharedData: boolean
  /** The viewer could open the public link after entering its password. */
  needsPublicLinkPassword: boolean
}

const NO_PERMISSIONS: ArtifactPermissions = {
  canView: false,
  canComment: false,
  canEdit: false,
  canManageSharing: false,
  canWriteSharedData: false,
  needsPublicLinkPassword: false,
}

// A viewer role uses the page, shared data included; a commenter also comments; an editor also publishes.
const GRANT_PERMISSIONS: Record<GrantRole, ArtifactPermissions> = {
  viewer: { ...NO_PERMISSIONS, canView: true, canWriteSharedData: true },
  commenter: { ...NO_PERMISSIONS, canView: true, canComment: true, canWriteSharedData: true },
  editor: { ...NO_PERMISSIONS, canView: true, canComment: true, canEdit: true, canWriteSharedData: true },
}
const MEMBER_PERMISSIONS: ArtifactPermissions = GRANT_PERMISSIONS.commenter
const AUTHOR_PERMISSIONS: ArtifactPermissions = {
  canView: true,
  canComment: true,
  canEdit: true,
  canManageSharing: true,
  canWriteSharedData: true,
  needsPublicLinkPassword: false,
}

/** The one place that decides what a viewer may do with an artifact. */
export class ArtifactAccess {
  readonly #summary: ArtifactSummary
  readonly #publicLinksEnabled: boolean
  readonly #now: number

  constructor(summary: ArtifactSummary, workspacePublicLinksEnabled: boolean, now: number) {
    this.#summary = summary
    this.#publicLinksEnabled = workspacePublicLinksEnabled
    this.#now = now
  }

  get publicLinkActive(): boolean {
    const { visibility, publicLinkExpiresAt } = this.#summary.sharing
    const notExpired = publicLinkExpiresAt === null || publicLinkExpiresAt > this.#now
    return visibility === 'public_link' && this.#publicLinksEnabled && notExpired
  }

  permissionsFor(viewer: ArtifactViewer): ArtifactPermissions {
    const isAuthor = viewer.userId !== null && viewer.userId === this.#summary.authorId
    if (isAuthor) return AUTHOR_PERMISSIONS
    return ArtifactAccess.#widest([this.#grantPermissions(viewer), this.#memberPermissions(viewer), this.#publicLinkPermissions(viewer)])
  }

  #grantPermissions(viewer: ArtifactViewer): ArtifactPermissions {
    const grantsApply = this.#summary.sharing.visibility !== 'private' && viewer.grantRole !== null
    return grantsApply ? GRANT_PERMISSIONS[viewer.grantRole as GrantRole] : NO_PERMISSIONS
  }

  #memberPermissions(viewer: ArtifactViewer): ArtifactPermissions {
    const visibility = this.#summary.sharing.visibility
    const openToMembers = visibility === 'workspace' || visibility === 'public_link'
    return openToMembers && viewer.workspaceRole !== null ? MEMBER_PERMISSIONS : NO_PERMISSIONS
  }

  #publicLinkPermissions(viewer: ArtifactViewer): ArtifactPermissions {
    if (!this.publicLinkActive) return NO_PERMISSIONS
    if (!viewer.publicLinkUnlocked) return { ...NO_PERMISSIONS, needsPublicLinkPassword: true }
    return { ...NO_PERMISSIONS, canView: true, canWriteSharedData: this.#summary.sharing.anonymousWriteEnabled }
  }

  // A permission the viewer holds through any path counts; a password prompt matters only when nothing else lets them in.
  static #widest(candidates: ArtifactPermissions[]): ArtifactPermissions {
    const anyGrants = (permission: keyof ArtifactPermissions) => candidates.some(candidate => candidate[permission])
    const canView = anyGrants('canView')
    return {
      canView,
      canComment: anyGrants('canComment'),
      canEdit: anyGrants('canEdit'),
      canManageSharing: anyGrants('canManageSharing'),
      canWriteSharedData: anyGrants('canWriteSharedData'),
      needsPublicLinkPassword: !canView && anyGrants('needsPublicLinkPassword'),
    }
  }
}
