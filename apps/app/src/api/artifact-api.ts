import { ArtifactRemoval, type ArtifactFile, type ArtifactSummary, type ArtifactVisibility, type PublishResult, type VersionOrigin } from '@open-artifact/core'
import { ArtifactGate, type OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError, type ErrorCode } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { ArtifactFileJson } from './artifact-file-json.ts'
import { JsonBody } from './json-body.ts'
import { PublicLinkExpiry } from './public-link-expiry.ts'

const VISIBILITIES: readonly ArtifactVisibility[] = ['private', 'specified', 'workspace', 'public_link']
const MAX_TITLE_LENGTH = 200
const MAX_NOTE_LENGTH = 200
const BASE_VERSION_HINT = 'pass the version you read; pass force: true only when told to overwrite'

/** Publishing, reading, versions, renaming and removal of artifacts: what agents call through MCP or the HTTP API. */
export class ArtifactApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async create(request: Request): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const requestBody = await JsonBody.of(request)
    const title = requestBody.text('title', MAX_TITLE_LENGTH)
    const visibility = requestBody.oneOf('visibility', VISIBILITIES, 'workspace')
    const publicLinkExpiry = PublicLinkExpiry.of(requestBody, identity, { visibilityBefore: null, visibilityAfter: visibility, savedExpiresAt: null }, Date.now())
    const createdArtifact = await this.#context.repositories.artifacts.create({
      workspaceId: identity.membership.workspace.workspaceId,
      authorId: identity.userId,
      publishedVia: identity.agentClient,
      note: requestBody.optionalText('note', MAX_NOTE_LENGTH),
      title,
      visibility,
      publicLinkExpiresAt: publicLinkExpiry.expiresAt,
      files: ArtifactFileJson.filesFrom(requestBody.raw('files')),
    })
    if (publicLinkExpiry.agentDefaultExpiresAt !== null) {
      const createdSummary = { artifactId: createdArtifact.artifactId, title, authorId: identity.userId }
      await this.#context.notifier.notify(identity, createdSummary, { kind: 'public_link_opened_by_agent', expiresAt: publicLinkExpiry.agentDefaultExpiresAt })
    }
    const createdJson = { ...createdArtifact, url: this.#context.viewerUrl(createdArtifact.artifactId), visibility, publicLinkExpiresAt: publicLinkExpiry.expiresAt }
    return Response.json(createdJson, { status: 201 })
  }

  /** `?removed=true` lists the removed artifacts the caller may restore instead of the ones they can view. */
  async list(request: Request): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const listsRemoved = new URL(request.url).searchParams.get('removed') === 'true'
    const listedArtifacts = listsRemoved ? await this.#context.gate.listRestorable(identity) : await this.#context.gate.listVisible(identity)
    return this.#listResponse(listedArtifacts)
  }

  /** Every artifact of the workspace for its admin, as metadata only: a private one comes without a link. */
  async listWorkspace(): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('see every artifact of the workspace')
    return this.#listResponse(await this.#context.gate.listWorkspace(identity))
  }

  async read(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.identity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canView', 'view this artifact')
    const requestedVersion = new URL(request.url).searchParams.get('version')
    const version = requestedVersion === null ? openedArtifact.summary.version : Number(requestedVersion)
    const readsOlderVersion = version !== openedArtifact.summary.version
    if (readsOlderVersion) ArtifactGate.demand(openedArtifact, identity, 'canSeeVersions', 'read older versions of this artifact')
    const versionContent = await this.#context.repositories.artifacts.readVersion(artifactId, version)
    if (!versionContent) throw HttpError.notFound(`version ${requestedVersion} of artifact ${artifactId}`)
    const names = await this.#namesOf([openedArtifact])
    return Response.json({ ...this.#summaryJson(openedArtifact, names), version, files: versionContent.files.map(file => ArtifactFileJson.toJson(file)) })
  }

  async update(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canEdit', 'publish a new version of this artifact')
    const requestBody = await JsonBody.of(request)
    const files = ArtifactFileJson.filesFrom(requestBody.raw('files'))
    const newTitle = requestBody.optionalText('title', MAX_TITLE_LENGTH)
    const baseVersion = requestBody.boolean('force', false) ? openedArtifact.summary.version : requestBody.positiveInteger('baseVersion', BASE_VERSION_HINT)
    const publishResult = await this.#context.repositories.artifacts.publishOnTopOf(artifactId, baseVersion, {
      authorId: identity.userId,
      publishedVia: identity.agentClient,
      origin: { kind: 'published' },
      note: requestBody.optionalText('note', MAX_NOTE_LENGTH),
      files,
    })
    const renamesWithVersion = publishResult.status === 'published' && newTitle !== null
    if (renamesWithVersion) await this.#rename(identity, openedArtifact.summary, newTitle)
    return this.#publishResponse(identity, openedArtifact, publishResult)
  }

  async rename(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canRename', 'rename this artifact')
    const requestBody = await JsonBody.of(request)
    const title = requestBody.text('title', MAX_TITLE_LENGTH)
    await this.#rename(identity, summary, title)
    return Response.json({ artifactId, title })
  }

  /** Hides the artifact from everyone at once; it can be restored for 30 days, then it is purged. */
  async remove(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canRemove', 'remove this artifact')
    const removal = ArtifactRemoval.by(identity.userId, summary.authorId, Date.now())
    const removedNow = await this.#context.repositories.artifacts.remove(artifactId, removal)
    if (!removedNow) throw HttpError.notFound(`artifact ${artifactId}`)
    await this.#context.repositories.auditLog.record({
      workspaceId: summary.workspaceId,
      actorId: identity.userId,
      action: 'artifact.removed',
      targetType: 'artifact',
      targetId: artifactId,
      detail: { title: summary.title, removedAsAdmin: removal.removedAsAdmin },
    })
    return Response.json({ artifactId, removal: { removedAt: removal.removedAt, removedAsAdmin: removal.removedAsAdmin, purgeAt: removal.purgeAt } })
  }

  async restoreRemoved(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canRestore', 'restore this artifact')
    const restoredNow = await this.#context.repositories.artifacts.restore(artifactId)
    if (!restoredNow) throw HttpError.notFound(`removed artifact ${artifactId}`)
    await this.#context.repositories.auditLog.record({
      workspaceId: summary.workspaceId,
      actorId: identity.userId,
      action: 'artifact.restored',
      targetType: 'artifact',
      targetId: artifactId,
      detail: { title: summary.title },
    })
    return Response.json({ artifactId, title: summary.title, url: this.#context.viewerUrl(artifactId) })
  }

  async listVersions(request: Request, artifactId: string): Promise<Response> {
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canSeeVersions', 'see the versions of this artifact')
    const versionHistory = await this.#context.repositories.artifacts.listVersions(artifactId)
    const authorNames = await this.#context.people.namesOf(versionHistory.map(versionRecord => versionRecord.authorId))
    const versions = versionHistory.map(versionRecord => ({
      version: versionRecord.version,
      author: { userId: versionRecord.authorId, name: authorNames.get(versionRecord.authorId) },
      publishedVia: versionRecord.publishedVia,
      ...ArtifactApi.#originJson(versionRecord.origin),
      note: versionRecord.note,
      createdAt: versionRecord.createdAt,
    }))
    return Response.json({ versions })
  }

  /** The signed address of a version's page, so the viewer can show another version without reloading itself. */
  async versionPage(request: Request, artifactId: string, version: number): Promise<Response> {
    const identity = await this.#context.identity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canView', 'view this artifact')
    const isCurrentVersion = version === openedArtifact.summary.version
    if (!isCurrentVersion) ArtifactGate.demand(openedArtifact, identity, 'canSeeVersions', 'see older versions of this artifact')
    if (!ArtifactGate.hasVersion(openedArtifact, version)) throw HttpError.notFound(`version ${version} of artifact ${artifactId}`)
    return Response.json({ version, url: await this.#context.artifactPages.entryPageUrl(artifactId, version, Date.now()) })
  }

  /**
   * Publishes the files of an older version as a new version; history is never rewritten. Undoing a restore
   * is one more restore, of the version it replaced.
   */
  async restoreVersion(request: Request, artifactId: string, version: number): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canEdit', 'restore a version of this artifact')
    const requestBody = await JsonBody.of(request)
    const baseVersion = requestBody.positiveInteger('baseVersion', BASE_VERSION_HINT)
    const [olderVersion, versionHistory] = await Promise.all([this.#context.repositories.artifacts.readVersion(artifactId, version), this.#context.repositories.artifacts.listVersions(artifactId)])
    const olderVersionRecord = versionHistory.find(versionRecord => versionRecord.version === version)
    if (!olderVersion || !olderVersionRecord) throw HttpError.notFound(`version ${version} of artifact ${artifactId}`)
    const publishResult = await this.#context.repositories.artifacts.publishOnTopOf(artifactId, baseVersion, {
      authorId: identity.userId,
      // The files are the older version's, so the source people see stays the one that made them.
      publishedVia: olderVersionRecord.publishedVia,
      origin: { kind: 'restored', restoredFrom: version },
      note: requestBody.optionalText('note', MAX_NOTE_LENGTH),
      files: olderVersion.files,
    })
    return this.#publishResponse(identity, openedArtifact, publishResult)
  }

  static #originJson(origin: VersionOrigin): { origin: VersionOrigin['kind']; restoredFrom: number | null } {
    switch (origin.kind) {
      case 'published':
        return { origin: 'published', restoredFrom: null }
      case 'restored':
        return { origin: 'restored', restoredFrom: origin.restoredFrom }
    }
  }

  async #publishResponse(publisher: Identity, openedArtifact: OpenedArtifact, publishResult: PublishResult): Promise<Response> {
    const artifactId = openedArtifact.summary.artifactId
    switch (publishResult.status) {
      case 'published':
        await this.#context.notifier.notify(publisher, openedArtifact.summary, { kind: 'version_published' })
        return Response.json({ artifactId, version: publishResult.version, url: this.#context.viewerUrl(artifactId) })
      case 'conflict':
        return this.#conflict(artifactId, publishResult.currentVersion)
      case 'not_found':
        throw HttpError.notFound(`artifact ${artifactId}`)
    }
  }

  // The agent merges its change into the latest files and publishes again on top of currentVersion.
  async #conflict(artifactId: string, currentVersion: number): Promise<Response> {
    const latestVersion = await this.#context.repositories.artifacts.readVersion(artifactId, currentVersion)
    const latestFiles: ArtifactFile[] = latestVersion?.files ?? []
    const conflictBody = {
      code: 'version_conflict' satisfies ErrorCode,
      error: `artifact is at version ${currentVersion}; merge your change into latestFiles and publish again with baseVersion ${currentVersion}`,
      currentVersion,
      latestFiles: latestFiles.map(file => ArtifactFileJson.toJson(file)),
    }
    return Response.json(conflictBody, { status: 409 })
  }

  async #rename(identity: Identity, summary: ArtifactSummary, title: string): Promise<void> {
    if (title === summary.title) return
    await this.#context.repositories.artifacts.rename(summary.artifactId, title)
    await this.#context.repositories.auditLog.record({
      workspaceId: summary.workspaceId,
      actorId: identity.userId,
      action: 'artifact.renamed',
      targetType: 'artifact',
      targetId: summary.artifactId,
      detail: { from: summary.title, to: title },
    })
  }

  async #listResponse(listedArtifacts: OpenedArtifact[]): Promise<Response> {
    const names = await this.#namesOf(listedArtifacts)
    return Response.json({ artifacts: listedArtifacts.map(openedArtifact => this.#summaryJson(openedArtifact, names)) })
  }

  #namesOf(openedArtifacts: OpenedArtifact[]): Promise<Map<string, string>> {
    return this.#context.people.namesOf(openedArtifacts.flatMap(({ summary }) => [summary.authorId, summary.removal?.removedBy ?? null]))
  }

  #summaryJson(openedArtifact: OpenedArtifact, names: Map<string, string>) {
    const { summary, permissions } = openedArtifact
    return {
      artifactId: summary.artifactId,
      title: summary.title,
      version: summary.version,
      visibility: summary.sharing.visibility,
      author: { userId: summary.authorId, name: names.get(summary.authorId) },
      publishedVia: summary.publishedVia,
      updatedAt: summary.updatedAt,
      removal: summary.removal === null ? null : ArtifactApi.#removalJson(summary.removal, names),
      url: permissions.canView ? this.#context.viewerUrl(summary.artifactId) : null,
      permissions: {
        canEdit: permissions.canEdit,
        canComment: permissions.canComment,
        canManageSharing: permissions.canManageSharing,
        canRename: permissions.canRename,
        canRemove: permissions.canRemove,
        canRestore: permissions.canRestore,
      },
    }
  }

  static #removalJson(removal: ArtifactRemoval, names: Map<string, string>) {
    return {
      removedAt: removal.removedAt,
      removedBy: { userId: removal.removedBy, name: names.get(removal.removedBy) },
      removedAsAdmin: removal.removedAsAdmin,
      purgeAt: removal.purgeAt,
    }
  }
}
