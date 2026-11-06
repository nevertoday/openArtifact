import type { AccessTokenScope } from './access-token-repository.ts'
import type { GrantRole } from './artifact-access-repository.ts'
import type { ArtifactRemoval } from './artifact-removal.ts'
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
  /** The scope of the API token behind the request; null for a person in the browser. */
  tokenScope: AccessTokenScope | null
}

export interface ArtifactPermissions {
  canView: boolean
  canComment: boolean
  canEdit: boolean
  canManageSharing: boolean
  canWriteSharedData: boolean
  canRename: boolean
  /** Removing hides the artifact from everyone; an admin may remove any artifact without being able to view it. */
  canRemove: boolean
  /** Only a removed artifact can be restored, and only until it is purged. */
  canRestore: boolean
  canReadComments: boolean
  /** The version history and older versions, which name the people who published them. */
  canSeeVersions: boolean
  /** Every collection of shared data at once, as the data tab lists it; the page's own SDK calls need only canView. */
  canBrowseSharedData: boolean
  /** The viewer could open the public link after entering its password. */
  needsPublicLinkPassword: boolean
}

/** Something a viewer may or may not do; the password prompt is a state, not a permission. */
export type ArtifactPermission = Exclude<keyof ArtifactPermissions, 'needsPublicLinkPassword'>

// An agent with a publish token works on artifacts but never changes who can see them, nor removes or restores them.
const WITHHELD_BY_TOKEN_SCOPE: Record<AccessTokenScope, readonly ArtifactPermission[]> = {
  publish: ['canManageSharing', 'canRemove', 'canRestore'],
  full: [],
}

const NO_PERMISSIONS: ArtifactPermissions = {
  canView: false,
  canComment: false,
  canEdit: false,
  canManageSharing: false,
  canWriteSharedData: false,
  canRename: false,
  canRemove: false,
  canRestore: false,
  canReadComments: false,
  canSeeVersions: false,
  canBrowseSharedData: false,
  needsPublicLinkPassword: false,
}

// Everyone inside the artifact's circle, whatever their role, sees its comments, history and data.
const INSIDE_VIEW: ArtifactPermissions = { ...NO_PERMISSIONS, canView: true, canReadComments: true, canSeeVersions: true, canBrowseSharedData: true }

// A viewer role uses the page, shared data included; a commenter also comments; an editor also publishes.
const GRANT_PERMISSIONS: Record<GrantRole, ArtifactPermissions> = {
  viewer: { ...INSIDE_VIEW, canWriteSharedData: true },
  commenter: { ...INSIDE_VIEW, canComment: true, canWriteSharedData: true },
  editor: { ...INSIDE_VIEW, canComment: true, canEdit: true, canWriteSharedData: true },
}
const MEMBER_PERMISSIONS: ArtifactPermissions = GRANT_PERMISSIONS.commenter
const AUTHOR_PERMISSIONS: ArtifactPermissions = { ...INSIDE_VIEW, canComment: true, canEdit: true, canManageSharing: true, canWriteSharedData: true, canRename: true, canRemove: true }

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

  // A removed artifact is gone for everyone; the only thing left to do with it is restore it.
  permissionsFor(viewer: ArtifactViewer): ArtifactPermissions {
    const permissions = { ...this.#personPermissions(viewer) }
    for (const withheldPermission of this.withheldByTokenScope(viewer)) permissions[withheldPermission] = false
    return permissions
  }

  /** What the viewer's person may do here but the token they sent may not. */
  withheldByTokenScope(viewer: ArtifactViewer): ArtifactPermission[] {
    if (viewer.tokenScope === null) return []
    const personPermissions = this.#personPermissions(viewer)
    return WITHHELD_BY_TOKEN_SCOPE[viewer.tokenScope].filter(permission => personPermissions[permission])
  }

  #personPermissions(viewer: ArtifactViewer): ArtifactPermissions {
    const removal = this.#summary.removal
    if (removal !== null) return { ...NO_PERMISSIONS, canRestore: this.#mayRestore(viewer, removal) }
    if (this.#isAuthor(viewer)) return AUTHOR_PERMISSIONS
    const sharedPermissions = ArtifactAccess.#widest([this.#grantPermissions(viewer), this.#memberPermissions(viewer), this.#publicLinkPermissions(viewer)])
    return { ...sharedPermissions, canRename: sharedPermissions.canEdit, canRemove: ArtifactAccess.#isAdmin(viewer) }
  }

  #mayRestore(viewer: ArtifactViewer, removal: ArtifactRemoval): boolean {
    if (removal.isPastRestoring(this.#now)) return false
    const authorMayRestore = this.#isAuthor(viewer) && !removal.removedAsAdmin
    return ArtifactAccess.#isAdmin(viewer) || authorMayRestore
  }

  #isAuthor(viewer: ArtifactViewer): boolean {
    return viewer.userId !== null && viewer.userId === this.#summary.authorId
  }

  static #isAdmin(viewer: ArtifactViewer): boolean {
    return viewer.workspaceRole === 'admin'
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
    // A visitor who reaches the artifact only through its link sees the page, not the people who work on it.
    const { anonymousWriteEnabled, publicLinkShowsComments } = this.#summary.sharing
    return { ...NO_PERMISSIONS, canView: true, canWriteSharedData: anonymousWriteEnabled, canReadComments: publicLinkShowsComments }
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
      canRename: anyGrants('canRename'),
      canRemove: anyGrants('canRemove'),
      canRestore: anyGrants('canRestore'),
      canReadComments: anyGrants('canReadComments'),
      canSeeVersions: anyGrants('canSeeVersions'),
      canBrowseSharedData: anyGrants('canBrowseSharedData'),
      needsPublicLinkPassword: !canView && anyGrants('needsPublicLinkPassword'),
    }
  }
}
