import {
  ArtifactAccess,
  type ArtifactPermission,
  type ArtifactPermissions,
  type ArtifactReference,
  type ArtifactSummary,
  type ArtifactViewer,
  type ShareReadiness,
  type SigningKey,
} from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError } from '../http-error.ts'
import type { Repositories } from '@open-artifact/core'

export interface OpenedArtifact {
  summary: ArtifactSummary
  permissions: ArtifactPermissions
  /** What the requester's person may do but the token they sent may not. */
  withheldByTokenScope: ArtifactPermission[]
  /** Whether a link to it may go out to strangers; the same for every viewer. */
  shareReadiness: ShareReadiness
}

/** Every route asks this gate what the requester may do with an artifact; nothing else applies access rules. */
export class ArtifactGate {
  readonly #repositories: Repositories
  readonly #signingKey: SigningKey
  readonly #now: number

  constructor(repositories: Repositories, signingKey: SigningKey, now: number) {
    this.#repositories = repositories
    this.#signingKey = signingKey
    this.#now = now
  }

  static unlockCookieName(artifactId: string): string {
    return `oa_unlock_${artifactId}`
  }

  /** Returns null when the artifact does not exist. */
  open(artifactId: string, identity: Identity | null, request: Request): Promise<OpenedArtifact | null> {
    return this.openReferenced({ kind: 'artifact_id', artifactId }, identity, request)
  }

  /** Like open, for the artifact a link's address names. */
  async openReferenced(reference: ArtifactReference, identity: Identity | null, request: Request): Promise<OpenedArtifact | null> {
    const summary = await this.find(reference)
    if (!summary) return null
    const grants = identity ? await this.#repositories.artifactAccess.listGrants(summary.artifactId) : []
    const grantRole = grants.find(grant => grant.userId === identity?.userId)?.role ?? null
    return this.#opened(summary, identity, grantRole, await this.#publicLinkUnlocked(summary, request))
  }

  /** The artifact a link names, before any access rule; only for code that applies the rules itself. */
  find(reference: ArtifactReference): Promise<ArtifactSummary | null> {
    switch (reference.kind) {
      case 'artifact_id':
        return this.#repositories.artifacts.findSummary(reference.artifactId)
      case 'short_id':
        return this.#repositories.artifacts.findSummaryByShortId(reference.shortId)
    }
  }

  /**
   * Throws the error the requester should see: 404 hides artifacts they may not view, 401/403 explain the rest.
   * A permission that needs no view, such as an admin removing a private artifact, passes on its own.
   */
  async require(artifactId: string, identity: Identity | null, request: Request, permission: ArtifactPermission, action: string): Promise<OpenedArtifact> {
    const openedArtifact = await this.open(artifactId, identity, request)
    if (openedArtifact?.permissions[permission]) return openedArtifact
    const viewable = openedArtifact?.permissions.canView ?? false
    const withheldByToken = openedArtifact?.withheldByTokenScope.includes(permission) ?? false
    if (!openedArtifact || !(viewable || withheldByToken)) throw HttpError.notFound(`artifact ${artifactId}`)
    ArtifactGate.demand(openedArtifact, identity, permission, action)
    return openedArtifact
  }

  /**
   * A member of the artifact's workspace who may not open it is told so and may ask the author to share it;
   * anyone else is told it does not exist, so its existence never leaks outside the workspace.
   */
  static mayAskForAccess(openedArtifact: OpenedArtifact, identity: Identity | null): identity is Identity {
    const { summary, permissions } = openedArtifact
    const isWorkspaceMember = identity?.memberships.some(membership => membership.workspace.workspaceId === summary.workspaceId) ?? false
    return isWorkspaceMember && !permissions.canView && summary.removal === null
  }

  /** For a permission on an artifact already opened: throws the 401 or 403 the requester should see. */
  /** Versions are numbered from 1 without gaps, so a version exists when it lies between 1 and the latest. */
  static hasVersion(openedArtifact: OpenedArtifact, version: number): boolean {
    return Number.isInteger(version) && version >= 1 && version <= openedArtifact.summary.version
  }

  static demand(openedArtifact: OpenedArtifact, identity: Identity | null, permission: ArtifactPermission, action: string): void {
    if (openedArtifact.permissions[permission]) return
    if (openedArtifact.withheldByTokenScope.includes(permission)) throw HttpError.outsideTokenScope(action)
    throw identity ? HttpError.forbidden(action) : HttpError.unauthorized()
  }

  /** The artifacts of the identity's current workspace that they may view, most recently updated first. */
  async listVisible(identity: Identity): Promise<OpenedArtifact[]> {
    return (await this.listWorkspace(identity)).filter(openedArtifact => openedArtifact.permissions.canView)
  }

  /** The removed artifacts the identity may still restore. */
  async listRestorable(identity: Identity): Promise<OpenedArtifact[]> {
    return (await this.listWorkspace(identity)).filter(openedArtifact => openedArtifact.permissions.canRestore)
  }

  /** Every artifact of the identity's current workspace, removed ones included, each with what the identity may do. */
  async listWorkspace(identity: Identity): Promise<OpenedArtifact[]> {
    const workspaceId = identity.membership.workspace.workspaceId
    const [summaries, grantsOfUser] = await Promise.all([
      this.#repositories.artifacts.listRecentlyUpdated(workspaceId),
      this.#repositories.artifactAccess.listGrantsOfUser(identity.userId),
    ])
    const grantRoleByArtifact = new Map(grantsOfUser.map(grant => [grant.artifactId, grant.role]))
    return Promise.all(summaries.map(summary => this.#opened(summary, identity, grantRoleByArtifact.get(summary.artifactId) ?? null, false)))
  }

  /** The artifacts granted to the identity one by one that it may view, from every workspace. */
  async listSharedWith(identity: Identity): Promise<OpenedArtifact[]> {
    const [summaries, grantsOfUser] = await Promise.all([this.#repositories.artifacts.listGrantedTo(identity.userId), this.#repositories.artifactAccess.listGrantsOfUser(identity.userId)])
    const grantRoleByArtifact = new Map(grantsOfUser.map(grant => [grant.artifactId, grant.role]))
    const openedArtifacts = await Promise.all(summaries.map(summary => this.#opened(summary, identity, grantRoleByArtifact.get(summary.artifactId) ?? null, false)))
    return openedArtifacts.filter(openedArtifact => openedArtifact.permissions.canView)
  }

  /** A cookie that proves the public link's password was entered; changing the password invalidates it. */
  async unlockCookieValue(summary: ArtifactSummary): Promise<string> {
    return this.#signingKey.sign(ArtifactGate.#unlockMessage(summary))
  }

  async #opened(summary: ArtifactSummary, identity: Identity | null, grantRole: ArtifactViewer['grantRole'], publicLinkUnlocked: boolean): Promise<OpenedArtifact> {
    const membership = identity?.memberships.find(candidate => candidate.workspace.workspaceId === summary.workspaceId) ?? null
    const workspace = membership?.workspace ?? (await this.#repositories.workspaces.findWorkspace(summary.workspaceId))
    const viewer: ArtifactViewer = { userId: identity?.userId ?? null, workspaceRole: membership?.role ?? null, grantRole, publicLinkUnlocked, tokenScope: identity?.tokenScope ?? null }
    const access = new ArtifactAccess(summary, workspace?.publicLinksEnabled ?? false, this.#now)
    return { summary, permissions: access.permissionsFor(viewer), withheldByTokenScope: access.withheldByTokenScope(viewer), shareReadiness: access.shareReadiness }
  }

  async #publicLinkUnlocked(summary: ArtifactSummary, request: Request): Promise<boolean> {
    if (summary.sharing.publicLinkPasswordHash === null) return true
    const unlockCookie = HttpCookies.read(request, ArtifactGate.unlockCookieName(summary.artifactId))
    return unlockCookie !== null && (await this.#signingKey.verify(ArtifactGate.#unlockMessage(summary), unlockCookie))
  }

  static #unlockMessage(summary: ArtifactSummary): string {
    return `unlock:${summary.artifactId}:${summary.sharing.publicLinkPasswordHash}`
  }
}
