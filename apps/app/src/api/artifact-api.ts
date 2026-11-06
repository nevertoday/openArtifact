import type { ArtifactFile, ArtifactVisibility, PublishResult } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { ArtifactFileJson } from './artifact-file-json.ts'
import { JsonBody } from './json-body.ts'

const VISIBILITIES: readonly ArtifactVisibility[] = ['private', 'specified', 'workspace', 'public_link']
const MAX_TITLE_LENGTH = 200
const BASE_VERSION_HINT = 'pass the version you read; pass force: true only when told to overwrite'

/** Publishing, reading and versions of artifacts: what agents call through MCP or the HTTP API. */
export class ArtifactApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async create(request: Request): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const requestBody = await JsonBody.of(request)
    const createdArtifact = await this.#context.repositories.artifacts.create({
      workspaceId: identity.membership.workspace.workspaceId,
      authorId: identity.userId,
      publishedVia: identity.agentClient,
      title: requestBody.text('title', MAX_TITLE_LENGTH),
      visibility: requestBody.oneOf('visibility', VISIBILITIES, 'workspace'),
      files: ArtifactFileJson.filesFrom(requestBody.raw('files')),
    })
    return Response.json({ ...createdArtifact, url: this.#context.viewerUrl(createdArtifact.artifactId) }, { status: 201 })
  }

  async list(): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const visibleArtifacts = await this.#context.gate.listVisible(identity)
    const authorNames = await this.#context.people.namesOf(visibleArtifacts.map(openedArtifact => openedArtifact.summary.authorId))
    return Response.json({ artifacts: visibleArtifacts.map(openedArtifact => this.#summaryJson(openedArtifact, authorNames)) })
  }

  async read(request: Request, artifactId: string): Promise<Response> {
    const openedArtifact = await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canView', 'view this artifact')
    const requestedVersion = new URL(request.url).searchParams.get('version')
    const version = requestedVersion === null ? openedArtifact.summary.version : Number(requestedVersion)
    const versionContent = await this.#context.repositories.artifacts.readVersion(artifactId, version)
    if (!versionContent) throw HttpError.notFound(`version ${requestedVersion} of artifact ${artifactId}`)
    const authorNames = await this.#context.people.namesOf([openedArtifact.summary.authorId])
    return Response.json({ ...this.#summaryJson(openedArtifact, authorNames), version, files: versionContent.files.map(file => ArtifactFileJson.toJson(file)) })
  }

  async update(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canEdit', 'publish a new version of this artifact')
    const requestBody = await JsonBody.of(request)
    const files = ArtifactFileJson.filesFrom(requestBody.raw('files'))
    const baseVersion = requestBody.boolean('force', false) ? openedArtifact.summary.version : requestBody.positiveInteger('baseVersion', BASE_VERSION_HINT)
    const publishResult = await this.#context.repositories.artifacts.publishOnTopOf(artifactId, baseVersion, { authorId: identity.userId, publishedVia: identity.agentClient, files })
    return this.#publishResponse(artifactId, publishResult)
  }

  async listVersions(request: Request, artifactId: string): Promise<Response> {
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canView', 'view this artifact')
    const versionHistory = await this.#context.repositories.artifacts.listVersions(artifactId)
    const authorNames = await this.#context.people.namesOf(versionHistory.map(versionRecord => versionRecord.authorId))
    const versions = versionHistory.map(versionRecord => ({
      version: versionRecord.version,
      author: { userId: versionRecord.authorId, name: authorNames.get(versionRecord.authorId) },
      publishedVia: versionRecord.publishedVia,
      createdAt: versionRecord.createdAt,
    }))
    return Response.json({ versions })
  }

  /** Publishes the files of an older version as a new version; history is never rewritten. */
  async restore(request: Request, artifactId: string, version: number): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canEdit', 'restore a version of this artifact')
    const olderVersion = await this.#context.repositories.artifacts.readVersion(artifactId, version)
    if (!olderVersion) throw HttpError.notFound(`version ${version} of artifact ${artifactId}`)
    const publishResult = await this.#context.repositories.artifacts.publishOnTopOf(artifactId, openedArtifact.summary.version, {
      authorId: identity.userId,
      publishedVia: identity.agentClient,
      files: olderVersion.files,
    })
    return this.#publishResponse(artifactId, publishResult)
  }

  async #publishResponse(artifactId: string, publishResult: PublishResult): Promise<Response> {
    switch (publishResult.status) {
      case 'published':
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
      error: `artifact is at version ${currentVersion}; merge your change into latestFiles and publish again with baseVersion ${currentVersion}`,
      currentVersion,
      latestFiles: latestFiles.map(file => ArtifactFileJson.toJson(file)),
    }
    return Response.json(conflictBody, { status: 409 })
  }

  #summaryJson(openedArtifact: OpenedArtifact, authorNames: Map<string, string>) {
    const { summary, permissions } = openedArtifact
    return {
      artifactId: summary.artifactId,
      title: summary.title,
      version: summary.version,
      visibility: summary.sharing.visibility,
      author: { userId: summary.authorId, name: authorNames.get(summary.authorId) },
      publishedVia: summary.publishedVia,
      updatedAt: summary.updatedAt,
      url: this.#context.viewerUrl(summary.artifactId),
      permissions: { canEdit: permissions.canEdit, canComment: permissions.canComment, canManageSharing: permissions.canManageSharing },
    }
  }
}
