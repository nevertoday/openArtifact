import {
  ArtifactAccess,
  PublicLinkPassword,
  type ArtifactSharing,
  type ArtifactSummary,
  type ArtifactVisibility,
  type GrantRole,
  type PersonGrant,
} from '@open-artifact/core'
import { ArtifactGate } from '../access/artifact-gate.ts'
import { HttpError } from '../http-error.ts'
import { People } from '../people.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'
import { PublicLinkExpiry } from './public-link-expiry.ts'

const VISIBILITIES: readonly ArtifactVisibility[] = ['private', 'specified', 'workspace', 'public_link']
const GRANT_ROLES: readonly GrantRole[] = ['viewer', 'commenter', 'editor']
const MAX_PASSWORD_LENGTH = 128
const MAX_GRANTS = 200
const MANAGE_SHARING = 'change who can see this artifact'

/** Who can see an artifact; only its author changes this, and every change is saved in one request. */
export class SharingApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async read(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const grants = await this.#context.repositories.artifactAccess.listGrants(artifactId)
    return Response.json(await this.#sharingJson(summary, grants))
  }

  /** A member who may not open the artifact asks its author to share it; the author hears through the notifier. */
  async requestAccess(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const openedArtifact = await this.#context.gate.open(artifactId, identity, request)
    if (openedArtifact === null || !ArtifactGate.mayAskForAccess(openedArtifact, identity)) throw HttpError.notFound(`artifact ${artifactId}`)
    await this.#context.notifier.notify(identity, openedArtifact.summary, { kind: 'access_requested', requesterEmail: identity.email })
    return new Response(null, { status: 204 })
  }

  /** The person the author is about to add; the share dialog shows them before anything is saved. */
  async findPerson(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const email = new URL(request.url).searchParams.get('email')?.trim() ?? ''
    if (email.length === 0) throw HttpError.fieldRequired('email', null)
    const person = await this.#context.repositories.users.findByEmail(email)
    if (!person) throw new HttpError(404, 'person_not_found', 'no person with this email; they need to sign in once before you can add them', { field: 'email' })
    if (person.userId === summary.authorId) throw new HttpError(400, 'author_always_sees', 'the author can always see their own artifact', { field: 'email' })
    return Response.json({ userId: person.userId, name: People.displayName(person), email: person.email })
  }

  /** Each field left out keeps its saved value; `grants`, when sent, is the complete list of people. */
  async update(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const requestBody = await JsonBody.of(request)
    const savedGrants: PersonGrant[] = (await this.#context.repositories.artifactAccess.listGrants(artifactId)).map(({ userId, role }) => ({ userId, role }))
    const visibility = requestBody.oneOf('visibility', VISIBILITIES, summary.sharing.visibility)
    const listedRequested = requestBody.boolean('listed', summary.sharing.listed)
    const publicLinkExpiry = PublicLinkExpiry.of(
      requestBody,
      identity,
      { visibilityBefore: summary.sharing.visibility, visibilityAfter: visibility, savedExpiresAt: summary.sharing.publicLinkExpiresAt, listedAfter: listedRequested },
      Date.now(),
    )
    const sharing = await this.#sharingFrom(requestBody, summary, visibility, publicLinkExpiry.expiresAt)
    if (sharing.listed) await this.#context.personalPages.claim(summary.authorId)
    const grants = requestBody.has('grants') ? await this.#grantsFrom(requestBody.raw('grants'), summary, savedGrants) : savedGrants
    await this.#context.repositories.artifactAccess.saveSharing(artifactId, sharing, grants)
    const newlyGranted = SharingApi.#newlyGranted({ visibility: summary.sharing.visibility, grants: savedGrants }, { visibility, grants })
    for (const grant of newlyGranted) await this.#context.notifier.notify(identity, summary, { kind: 'artifact_shared', sharedWithId: grant.userId, role: grant.role })
    if (publicLinkExpiry.agentDefaultExpiresAt !== null) await this.#context.notifier.notify(identity, summary, { kind: 'public_link_opened_by_agent', expiresAt: publicLinkExpiry.agentDefaultExpiresAt })
    return Response.json(await this.#sharingJson({ ...summary, sharing }, grants))
  }

  async #sharingFrom(requestBody: JsonBody, summary: ArtifactSummary, visibility: ArtifactVisibility, publicLinkExpiresAt: number | null): Promise<ArtifactSharing> {
    const workspace = await this.#context.repositories.workspaces.findWorkspace(summary.workspaceId)
    const publicLinkForbidden = visibility === 'public_link' && !workspace?.publicLinksEnabled
    if (publicLinkForbidden) throw new HttpError(400, 'public_links_off', 'the workspace admin has switched public links off')
    const publicLinkPasswordHash = await SharingApi.#passwordHashOf(requestBody, summary.sharing.publicLinkPasswordHash)
    return {
      visibility,
      publicLinkExpiresAt,
      publicLinkPasswordHash,
      anonymousWriteEnabled: requestBody.boolean('anonymousWriteEnabled', summary.sharing.anonymousWriteEnabled),
      publicLinkShowsComments: requestBody.boolean('publicLinkShowsComments', summary.sharing.publicLinkShowsComments),
      listed: SharingApi.#listedFrom(requestBody, summary, { visibility, publicLinkPasswordHash }),
    }
  }

  // Asking to list a page strangers cannot open is refused; a change that closes the page takes it off the list.
  static #listedFrom(requestBody: JsonBody, summary: ArtifactSummary, sharingAfter: Pick<ArtifactSharing, 'visibility' | 'publicLinkPasswordHash'>): boolean {
    const listable = ArtifactAccess.listable(sharingAfter)
    const asksToList = requestBody.has('listed') && requestBody.boolean('listed', false)
    if (asksToList && !listable) throw new HttpError(400, 'not_listable', 'only a public link without a password can be listed on your personal page', { field: 'listed' })
    return listable && requestBody.boolean('listed', summary.sharing.listed)
  }

  // People already on the list stay valid even if their account was deleted; a person added now must exist.
  async #grantsFrom(grantsJson: unknown, summary: ArtifactSummary, savedGrants: PersonGrant[]): Promise<PersonGrant[]> {
    if (!Array.isArray(grantsJson)) throw HttpError.badRequest('grants must be a list of { userId, role }')
    if (grantsJson.length > MAX_GRANTS) throw HttpError.badRequest(`an artifact may be shared with at most ${MAX_GRANTS} people`)
    const grants = grantsJson.map(grantJson => SharingApi.#personGrantOf(grantJson))
    const userIds = grants.map(grant => grant.userId)
    if (new Set(userIds).size !== userIds.length) throw HttpError.badRequest('each person may appear only once in grants')
    if (userIds.includes(summary.authorId)) throw new HttpError(400, 'author_always_sees', 'the author can always see their own artifact')
    const savedUserIds = new Set(savedGrants.map(grant => grant.userId))
    const addedUserIds = userIds.filter(userId => !savedUserIds.has(userId))
    const addedProfiles = await this.#context.repositories.users.profilesOf(addedUserIds)
    const unknownUserIds = addedUserIds.filter(userId => !addedProfiles.has(userId))
    if (unknownUserIds.length > 0) throw HttpError.badRequest(`grants name people who have no account: ${unknownUserIds.join(', ')}`)
    return grants
  }

  async #sharingJson(summary: ArtifactSummary, grants: PersonGrant[]) {
    const [members, workspace, grantedProfiles, profile] = await Promise.all([
      this.#context.repositories.workspaces.listMembers(summary.workspaceId),
      this.#context.repositories.workspaces.findWorkspace(summary.workspaceId),
      this.#context.repositories.users.profilesOf(grants.map(grant => grant.userId)),
      this.#context.repositories.profiles.findByUser(summary.authorId),
    ])
    return {
      visibility: summary.sharing.visibility,
      peopleApplyUnder: VISIBILITIES.filter(visibility => ArtifactAccess.grantsApplyUnder(visibility)),
      publicLink: {
        expiresAt: summary.sharing.publicLinkExpiresAt,
        hasPassword: summary.sharing.publicLinkPasswordHash !== null,
        anonymousWriteEnabled: summary.sharing.anonymousWriteEnabled,
        showsComments: summary.sharing.publicLinkShowsComments,
        allowedInWorkspace: workspace?.publicLinksEnabled ?? false,
        listed: summary.sharing.listed,
        personalPageUrl: profile ? this.#context.personalPages.url(profile.handle) : null,
      },
      author: { userId: summary.authorId },
      grants: grants.map(grant => {
        const profile = grantedProfiles.get(grant.userId)
        return { userId: grant.userId, role: grant.role, name: profile ? People.displayName(profile) : '已删除的用户', email: profile?.email ?? null }
      }),
      members: members.map(member => ({ userId: member.userId, name: People.displayName(member), email: member.email })),
    }
  }

  static #personGrantOf(grantJson: unknown): PersonGrant {
    const { userId, role } = (typeof grantJson === 'object' && grantJson !== null ? grantJson : {}) as Record<string, unknown>
    const knownRole = GRANT_ROLES.find(candidate => candidate === role)
    const isPersonGrant = typeof userId === 'string' && userId.length > 0 && knownRole !== undefined
    if (!isPersonGrant) throw HttpError.badRequest(`each grant must be { userId, role } with role one of ${GRANT_ROLES.join(', ')}`)
    return { userId, role: knownRole }
  }

  // The people who can open the artifact through the list now and could not through it before the save.
  static #newlyGranted(before: { visibility: ArtifactVisibility; grants: PersonGrant[] }, after: { visibility: ArtifactVisibility; grants: PersonGrant[] }): PersonGrant[] {
    if (!ArtifactAccess.grantsApplyUnder(after.visibility)) return []
    const grantedBefore = ArtifactAccess.grantsApplyUnder(before.visibility) ? new Set(before.grants.map(grant => grant.userId)) : new Set<string>()
    return after.grants.filter(grant => !grantedBefore.has(grant.userId))
  }

  // Absent keeps the current password, null removes it, a string sets a new one.
  static async #passwordHashOf(requestBody: JsonBody, currentHash: string | null): Promise<string | null> {
    if (!requestBody.has('publicLinkPassword')) return currentHash
    const newPassword = requestBody.optionalText('publicLinkPassword', MAX_PASSWORD_LENGTH)
    return newPassword === null ? null : PublicLinkPassword.hash(newPassword)
  }
}
