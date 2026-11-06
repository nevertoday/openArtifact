import {
  ArtifactAccess,
  PublicLinkPassword,
  type ArtifactSharing,
  type ArtifactSummary,
  type ArtifactVisibility,
  type GrantRole,
  type PersonGrant,
} from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import { People } from '../people.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'
import { SharingNotices } from './sharing-notices.ts'

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

  /** The person the author is about to add; the share dialog shows them before anything is saved. */
  async findPerson(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const email = new URL(request.url).searchParams.get('email')?.trim() ?? ''
    if (email.length === 0) throw HttpError.badRequest('email is required')
    const person = await this.#context.repositories.users.findByEmail(email)
    if (!person) throw HttpError.notFound('a person with this email; they need to sign in once before you can add them')
    if (person.userId === summary.authorId) throw HttpError.badRequest('the author can always see their own artifact')
    return Response.json({ userId: person.userId, name: People.displayName(person), email: person.email })
  }

  /** Each field left out keeps its saved value; `grants`, when sent, is the complete list of people. */
  async update(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const requestBody = await JsonBody.of(request)
    const savedGrants: PersonGrant[] = (await this.#context.repositories.artifactAccess.listGrants(artifactId)).map(({ userId, role }) => ({ userId, role }))
    const sharing = await this.#sharingFrom(requestBody, summary)
    const grants = requestBody.has('grants') ? await this.#grantsFrom(requestBody.raw('grants'), summary, savedGrants) : savedGrants
    await this.#context.repositories.artifactAccess.saveSharing(artifactId, sharing, grants)
    const newlyGranted = SharingApi.#newlyGranted({ visibility: summary.sharing.visibility, grants: savedGrants }, { visibility: sharing.visibility, grants })
    await new SharingNotices(this.#context).sharedWith(identity, summary, newlyGranted)
    return Response.json(await this.#sharingJson({ ...summary, sharing }, grants))
  }

  async #sharingFrom(requestBody: JsonBody, summary: ArtifactSummary): Promise<ArtifactSharing> {
    const visibility = requestBody.oneOf('visibility', VISIBILITIES, summary.sharing.visibility)
    const workspace = await this.#context.repositories.workspaces.findWorkspace(summary.workspaceId)
    const publicLinkForbidden = visibility === 'public_link' && !workspace?.publicLinksEnabled
    if (publicLinkForbidden) throw HttpError.badRequest('the workspace admin has switched public links off')
    return {
      visibility,
      publicLinkExpiresAt: SharingApi.#expiresAtOf(requestBody, summary.sharing.publicLinkExpiresAt),
      publicLinkPasswordHash: await SharingApi.#passwordHashOf(requestBody, summary.sharing.publicLinkPasswordHash),
      anonymousWriteEnabled: requestBody.boolean('anonymousWriteEnabled', summary.sharing.anonymousWriteEnabled),
      publicLinkShowsComments: requestBody.boolean('publicLinkShowsComments', summary.sharing.publicLinkShowsComments),
    }
  }

  // People already on the list stay valid even if their account was deleted; a person added now must exist.
  async #grantsFrom(grantsJson: unknown, summary: ArtifactSummary, savedGrants: PersonGrant[]): Promise<PersonGrant[]> {
    if (!Array.isArray(grantsJson)) throw HttpError.badRequest('grants must be a list of { userId, role }')
    if (grantsJson.length > MAX_GRANTS) throw HttpError.badRequest(`an artifact may be shared with at most ${MAX_GRANTS} people`)
    const grants = grantsJson.map(grantJson => SharingApi.#personGrantOf(grantJson))
    const userIds = grants.map(grant => grant.userId)
    if (new Set(userIds).size !== userIds.length) throw HttpError.badRequest('each person may appear only once in grants')
    if (userIds.includes(summary.authorId)) throw HttpError.badRequest('the author can always see their own artifact')
    const savedUserIds = new Set(savedGrants.map(grant => grant.userId))
    const addedUserIds = userIds.filter(userId => !savedUserIds.has(userId))
    const addedProfiles = await this.#context.repositories.users.profilesOf(addedUserIds)
    const unknownUserIds = addedUserIds.filter(userId => !addedProfiles.has(userId))
    if (unknownUserIds.length > 0) throw HttpError.badRequest(`grants name people who have no account: ${unknownUserIds.join(', ')}`)
    return grants
  }

  async #sharingJson(summary: ArtifactSummary, grants: PersonGrant[]) {
    const [members, workspace, grantedProfiles] = await Promise.all([
      this.#context.repositories.workspaces.listMembers(summary.workspaceId),
      this.#context.repositories.workspaces.findWorkspace(summary.workspaceId),
      this.#context.repositories.users.profilesOf(grants.map(grant => grant.userId)),
    ])
    return {
      visibility: summary.sharing.visibility,
      publicLink: {
        expiresAt: summary.sharing.publicLinkExpiresAt,
        hasPassword: summary.sharing.publicLinkPasswordHash !== null,
        anonymousWriteEnabled: summary.sharing.anonymousWriteEnabled,
        showsComments: summary.sharing.publicLinkShowsComments,
        allowedInWorkspace: workspace?.publicLinksEnabled ?? false,
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

  // Absent keeps the current expiry, so an author can still save after the link has expired; null means never.
  static #expiresAtOf(requestBody: JsonBody, currentExpiresAt: number | null): number | null {
    if (!requestBody.has('publicLinkExpiresAt')) return currentExpiresAt
    const expiresAt = requestBody.raw('publicLinkExpiresAt')
    if (expiresAt === null) return null
    const isFutureTime = Number.isInteger(expiresAt) && (expiresAt as number) > Date.now()
    if (!isFutureTime) throw HttpError.badRequest('publicLinkExpiresAt must be a future time in milliseconds, or null for never')
    return expiresAt as number
  }

  // Absent keeps the current password, null removes it, a string sets a new one.
  static async #passwordHashOf(requestBody: JsonBody, currentHash: string | null): Promise<string | null> {
    if (!requestBody.has('publicLinkPassword')) return currentHash
    const newPassword = requestBody.optionalText('publicLinkPassword', MAX_PASSWORD_LENGTH)
    return newPassword === null ? null : PublicLinkPassword.hash(newPassword)
  }
}
