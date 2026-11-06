import { ArtifactAccess, type ArtifactPermissions, type ArtifactSummary, type ArtifactViewer, type SigningKey } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError } from '../http-error.ts'
import type { Repositories } from '@open-artifact/core'

export interface OpenedArtifact {
  summary: ArtifactSummary
  permissions: ArtifactPermissions
}

type Permission = Exclude<keyof ArtifactPermissions, 'needsPublicLinkPassword'>

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
  async open(artifactId: string, identity: Identity | null, request: Request): Promise<OpenedArtifact | null> {
    const summary = await this.#repositories.artifacts.findSummary(artifactId)
    if (!summary) return null
    const grants = identity ? await this.#repositories.artifactAccess.listGrants(artifactId) : []
    const grantRole = grants.find(grant => grant.userId === identity?.userId)?.role ?? null
    return this.#opened(summary, identity, grantRole, await this.#publicLinkUnlocked(summary, request))
  }

  /**
   * Throws the error the requester should see: 404 hides artifacts they may not view, 401/403 explain the rest.
   * A permission that needs no view, such as an admin removing a private artifact, passes on its own.
   */
  async require(artifactId: string, identity: Identity | null, request: Request, permission: Permission, action: string): Promise<OpenedArtifact> {
    const openedArtifact = await this.open(artifactId, identity, request)
    if (openedArtifact?.permissions[permission]) return openedArtifact
    const viewable = openedArtifact?.permissions.canView ?? false
    if (!viewable) throw HttpError.notFound(`artifact ${artifactId}`)
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

  /** A cookie that proves the public link's password was entered; changing the password invalidates it. */
  async unlockCookieValue(summary: ArtifactSummary): Promise<string> {
    return this.#signingKey.sign(ArtifactGate.#unlockMessage(summary))
  }

  async #opened(summary: ArtifactSummary, identity: Identity | null, grantRole: ArtifactViewer['grantRole'], publicLinkUnlocked: boolean): Promise<OpenedArtifact> {
    const membership = identity?.memberships.find(candidate => candidate.workspace.workspaceId === summary.workspaceId) ?? null
    const workspace = membership?.workspace ?? (await this.#repositories.workspaces.findWorkspace(summary.workspaceId))
    const viewer: ArtifactViewer = { userId: identity?.userId ?? null, workspaceRole: membership?.role ?? null, grantRole, publicLinkUnlocked }
    const access = new ArtifactAccess(summary, workspace?.publicLinksEnabled ?? false, this.#now)
    return { summary, permissions: access.permissionsFor(viewer) }
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
