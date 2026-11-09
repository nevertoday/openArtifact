import { ArtifactRemoval, ArtifactSlug, type ArtifactFile, type ArtifactSummary, type ArtifactVisibility, type PublishResult, type VersionOrigin } from '@open-artifact/core'
import { ArtifactGate, type OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError, type ErrorCode } from '../http-error.ts'
import { MAX_POST_WEIGHT, postWeight } from '../../public/static/share-text.js'
import { ShareCard } from '../share/share-card.ts'
import type { ApiContext } from './api-context.ts'
import { ArtifactFileJson } from './artifact-file-json.ts'
import { JsonBody } from './json-body.ts'
import { PageExcerpt } from './page-excerpt.ts'
import { PublicLinkExpiry } from './public-link-expiry.ts'

const VISIBILITIES: readonly ArtifactVisibility[] = ['private', 'specified', 'workspace', 'public_link']
const MAX_TITLE_LENGTH = 200
// The words kept in the address are cut to 60 characters; this only bounds what a caller may send.
const MAX_SLUG_INPUT_LENGTH = 200
const MAX_NOTE_LENGTH = 200
export const MAX_SUMMARY_LENGTH = 300
// Links in it may be long, as each weighs 23 whatever its length; the weight is the real limit.
const MAX_SHARE_TEXT_LENGTH = 1000
const LIST_ON_PERSONAL_PAGE = 'list it on your personal page'
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
    const requestedSlug = requestBody.optionalText('slug', MAX_SLUG_INPUT_LENGTH)
    const visibility = requestBody.oneOf('visibility', VISIBILITIES, 'workspace')
    const listed = ArtifactApi.#listedOnCreate(requestBody, identity, visibility)
    const publicLinkExpiry = PublicLinkExpiry.of(requestBody, identity, { visibilityBefore: null, visibilityAfter: visibility, savedExpiresAt: null, listedAfter: listed }, Date.now())
    const files = ArtifactFileJson.filesFrom(requestBody.raw('files'))
    const workspaceId = identity.membership.workspace.workspaceId
    const note = requestBody.optionalText('note', MAX_NOTE_LENGTH)
    const summary = requestBody.optionalText('summary', MAX_SUMMARY_LENGTH)
    const shareText = ArtifactApi.#shareTextFrom(requestBody)
    const { slug, createdArtifact } = await this.#context.publishLimits.publishWithin({ publisherId: identity.userId, workspaceId, files, newArtifact: true }, async () => {
      const [englishTitle, excerpt] = await Promise.all([this.#englishTitle('', requestedSlug, title), PageExcerpt.of(files)])
      const slug = ArtifactSlug.forNewArtifact(requestedSlug, title, englishTitle)
      const createdArtifact = await this.#context.repositories.artifacts.create({
        workspaceId,
        authorId: identity.userId,
        publishedVia: identity.agentClient,
        note,
        excerpt,
        title,
        slug,
        visibility,
        publicLinkExpiresAt: publicLinkExpiry.expiresAt,
        listed,
        summary,
        shareText,
        files,
      })
      return { slug, createdArtifact }
    })
    const createdSummary = { artifactId: createdArtifact.artifactId, shortId: createdArtifact.shortId, slug, title, authorId: identity.userId }
    if (listed) await this.#context.personalPages.claim(identity.userId)
    if (publicLinkExpiry.agentDefaultExpiresAt !== null) {
      await this.#context.notifier.notify(identity, createdSummary, { kind: 'public_link_opened_by_agent', expiresAt: publicLinkExpiry.agentDefaultExpiresAt })
    }
    const share = await this.#shareJson(createdArtifact.artifactId, identity, request)
    const createdJson = { ...createdArtifact, slug, url: this.#context.artifactUrl(createdSummary), visibility, publicLinkExpiresAt: publicLinkExpiry.expiresAt, listed, share }
    return Response.json(createdJson, { status: 201 })
  }

  // Listing puts the page in front of strangers, so it takes the same full-access token as changing sharing later.
  static #listedOnCreate(requestBody: JsonBody, identity: Identity, visibility: ArtifactVisibility): boolean {
    const listed = requestBody.boolean('listed', false)
    if (!listed) return false
    if (identity.tokenScope === 'publish') throw HttpError.outsideTokenScope(LIST_ON_PERSONAL_PAGE)
    if (visibility !== 'public_link') throw new HttpError(400, 'not_listable', 'only an artifact with visibility public_link can be listed on your personal page')
    return true
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
    const newName = { title: requestBody.optionalText('title', MAX_TITLE_LENGTH), slug: requestBody.optionalText('slug', MAX_SLUG_INPUT_LENGTH) }
    const newSummary = requestBody.optionalText('summary', MAX_SUMMARY_LENGTH)
    const newShareText = requestBody.has('shareText') ? { shareText: ArtifactApi.#shareTextFrom(requestBody) } : null
    const baseVersion = requestBody.boolean('force', false) ? openedArtifact.summary.version : requestBody.positiveInteger('baseVersion', BASE_VERSION_HINT)
    const note = requestBody.optionalText('note', MAX_NOTE_LENGTH)
    const publishResult = await this.#context.publishLimits.publishWithin(
      { publisherId: identity.userId, workspaceId: openedArtifact.summary.workspaceId, files, newArtifact: false },
      async () =>
        this.#context.repositories.artifacts.publishOnTopOf(artifactId, baseVersion, {
          authorId: identity.userId,
          publishedVia: identity.agentClient,
          origin: { kind: 'published' },
          note,
          excerpt: await PageExcerpt.of(files),
          files,
        }),
      ArtifactApi.#landed,
    )
    if (publishResult.status !== 'published') return this.#publishResponse(request, identity, openedArtifact.summary, publishResult)
    const renamedSummary = await this.#rename(identity, openedArtifact.summary, newName)
    if (newSummary !== null) await this.#context.repositories.artifacts.setSummary(artifactId, newSummary)
    if (newShareText !== null) await this.#context.repositories.artifacts.setShareText(artifactId, newShareText.shareText)
    return this.#publishResponse(request, identity, renamedSummary, publishResult)
  }

  /**
   * Changes the title, the words in the address, the summary on the personal page, the words for X, or any of
   * them; a summary of null goes back to the page's opening words, a shareText of null to words made from both.
   */
  async rename(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canRename', 'rename this artifact')
    const requestBody = await JsonBody.of(request)
    const changesSummary = requestBody.has('summary')
    const changesShareText = requestBody.has('shareText')
    if (!requestBody.has('title') && !requestBody.has('slug') && !changesSummary && !changesShareText) throw HttpError.badRequest('send a title, a slug, a summary, a shareText, or several of them')
    const newName = {
      title: requestBody.has('title') ? requestBody.text('title', MAX_TITLE_LENGTH) : null,
      slug: requestBody.optionalText('slug', MAX_SLUG_INPUT_LENGTH),
    }
    const renamedSummary = await this.#rename(identity, summary, newName)
    if (changesSummary) await this.#context.repositories.artifacts.setSummary(artifactId, requestBody.optionalText('summary', MAX_SUMMARY_LENGTH))
    if (changesShareText) await this.#context.repositories.artifacts.setShareText(artifactId, ArtifactApi.#shareTextFrom(requestBody))
    const savedSummary = await this.#context.repositories.artifacts.findSummary(artifactId)
    const { title, shortId, slug } = renamedSummary
    const share = await this.#shareJson(artifactId, identity, request)
    return Response.json({ artifactId, title, shortId, slug, url: this.#context.artifactUrl(renamedSummary), summary: savedSummary?.summary ?? null, share })
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
    await this.#context.publishLimits.ensureRoomToRestore(summary.workspaceId)
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
    return Response.json({ artifactId, title: summary.title, url: this.#context.artifactUrl(summary) })
  }

  /**
   * Deletes a removed artifact for good now instead of in 30 days, so its files stop counting at once. Whoever may
   * restore it may do this; nobody may for a page the operator took down, which the operator keeps until the purge.
   */
  async purgeRemoved(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canRestore', 'delete this artifact forever')
    const purgedNow = await this.#context.repositories.artifacts.purgeRemovedNow(artifactId, ArtifactRemoval.purgeCutoff(Date.now()))
    if (!purgedNow) throw HttpError.notFound(`removed artifact ${artifactId}`)
    await this.#context.repositories.auditLog.record({
      workspaceId: summary.workspaceId,
      actorId: identity.userId,
      action: 'artifact.purged',
      targetType: 'artifact',
      targetId: artifactId,
      detail: { title: summary.title },
    })
    return Response.json({ artifactId, title: summary.title })
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
    const note = requestBody.optionalText('note', MAX_NOTE_LENGTH)
    const publishResult = await this.#context.publishLimits.publishWithin(
      { publisherId: identity.userId, workspaceId: openedArtifact.summary.workspaceId, files: olderVersion.files, newArtifact: false },
      async () =>
        this.#context.repositories.artifacts.publishOnTopOf(artifactId, baseVersion, {
          authorId: identity.userId,
          // The files are the older version's, so the source people see stays the one that made them.
          publishedVia: olderVersionRecord.publishedVia,
          origin: { kind: 'restored', restoredFrom: version },
          note,
          excerpt: await PageExcerpt.of(olderVersion.files),
          files: olderVersion.files,
        }),
      ArtifactApi.#landed,
    )
    return this.#publishResponse(request, identity, openedArtifact.summary, publishResult)
  }

  static #landed(publishResult: PublishResult): boolean {
    return publishResult.status === 'published'
  }

  static #originJson(origin: VersionOrigin): { origin: VersionOrigin['kind']; restoredFrom: number | null } {
    switch (origin.kind) {
      case 'published':
        return { origin: 'published', restoredFrom: null }
      case 'restored':
        return { origin: 'restored', restoredFrom: origin.restoredFrom }
    }
  }

  async #publishResponse(request: Request, publisher: Identity, summary: ArtifactSummary, publishResult: PublishResult): Promise<Response> {
    const { artifactId, shortId, slug } = summary
    switch (publishResult.status) {
      case 'published':
        await this.#context.notifier.notify(publisher, summary, { kind: 'version_published' })
        return Response.json({ artifactId, shortId, slug, version: publishResult.version, url: this.#context.artifactUrl(summary), share: await this.#shareJson(artifactId, publisher, request) })
      case 'conflict':
        return this.#conflict(artifactId, publishResult.currentVersion)
      case 'not_found':
        throw HttpError.notFound(`artifact ${artifactId}`)
    }
  }

  // Read again after the write, so the card names the new version and the words just saved.
  async #shareJson(artifactId: string, identity: Identity, request: Request) {
    const openedArtifact = await this.#context.gate.open(artifactId, identity, request)
    if (!openedArtifact) throw new Error(`artifact ${artifactId} disappeared while it was being saved`)
    return ShareCard.of(openedArtifact.summary, openedArtifact.shareReadiness, this.#context.appOrigin).toJson()
  }

  // Blank goes back to the words made from the title and summary.
  static #shareTextFrom(requestBody: JsonBody): string | null {
    const shareText = requestBody.optionalText('shareText', MAX_SHARE_TEXT_LENGTH)
    if (shareText === null) return null
    const weight = postWeight(shareText)
    if (weight > MAX_POST_WEIGHT) {
      const message = `shareText weighs ${weight} on X with the link, over the ${MAX_POST_WEIGHT} a post may weigh; CJK characters and emoji count 2, each link 23`
      throw new HttpError(400, 'share_text_too_long', message, { field: 'shareText' })
    }
    return shareText
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

  /** Returns the summary as renamed; null in either field keeps what the artifact has, see ArtifactSlug.afterChange. */
  async #rename(identity: Identity, summary: ArtifactSummary, newName: { title: string | null; slug: string | null }): Promise<ArtifactSummary> {
    const title = newName.title ?? summary.title
    const changedTitle = title === summary.title ? null : title
    const englishTitle = await this.#englishTitle(summary.slug, newName.slug, changedTitle)
    const slug = ArtifactSlug.afterChange(summary.slug, newName.slug, changedTitle, englishTitle)
    if (changedTitle === null && slug === summary.slug) return summary
    await this.#context.repositories.artifacts.rename(summary.artifactId, { title, slug })
    if (changedTitle !== null) await this.#recordRename(identity, summary, title)
    return { ...summary, title, slug }
  }

  async #englishTitle(currentSlug: string, requestedSlug: string | null, changedTitle: string | null): Promise<string | null> {
    const titleToTranslate = ArtifactSlug.titleToTranslate(currentSlug, requestedSlug, changedTitle)
    return titleToTranslate === null ? null : this.#context.titleTranslator.toEnglish(titleToTranslate)
  }

  async #recordRename(identity: Identity, summary: ArtifactSummary, title: string): Promise<void> {
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
      url: permissions.canView ? this.#context.artifactUrl(summary) : null,
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
