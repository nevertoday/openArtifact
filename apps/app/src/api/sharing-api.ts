import { PublicLinkPassword, type ArtifactSharing, type ArtifactVisibility, type GrantRole } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import { People } from '../people.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const VISIBILITIES: readonly ArtifactVisibility[] = ['private', 'specified', 'workspace', 'public_link']
const GRANT_ROLES: readonly GrantRole[] = ['viewer', 'commenter', 'editor']
const MAX_PASSWORD_LENGTH = 128

/** Who can see an artifact; only its author changes this. */
export class SharingApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async read(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', 'change who can see this artifact')
    const [grants, members, workspace] = await Promise.all([
      this.#context.repositories.artifactAccess.listGrants(artifactId),
      this.#context.repositories.workspaces.listMembers(summary.workspaceId),
      this.#context.repositories.workspaces.findWorkspace(summary.workspaceId),
    ])
    const grantedProfiles = await this.#context.repositories.users.profilesOf(grants.map(grant => grant.userId))
    return Response.json({
      visibility: summary.sharing.visibility,
      publicLink: {
        expiresAt: summary.sharing.publicLinkExpiresAt,
        hasPassword: summary.sharing.publicLinkPasswordHash !== null,
        anonymousWriteEnabled: summary.sharing.anonymousWriteEnabled,
        allowedInWorkspace: workspace?.publicLinksEnabled ?? false,
      },
      author: { userId: summary.authorId },
      grants: grants.map(grant => {
        const profile = grantedProfiles.get(grant.userId)
        return { userId: grant.userId, role: grant.role, name: profile ? People.displayName(profile) : '已删除的用户', email: profile?.email ?? null }
      }),
      members: members.map(member => ({ userId: member.userId, name: People.displayName(member), email: member.email })),
    })
  }

  async update(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', 'change who can see this artifact')
    const requestBody = await JsonBody.of(request)
    const visibility = requestBody.oneOf('visibility', VISIBILITIES)
    const workspace = await this.#context.repositories.workspaces.findWorkspace(summary.workspaceId)
    const publicLinkForbidden = visibility === 'public_link' && !workspace?.publicLinksEnabled
    if (publicLinkForbidden) throw HttpError.badRequest('the workspace admin has switched public links off')
    const sharing: ArtifactSharing = {
      visibility,
      publicLinkExpiresAt: SharingApi.#expiresAtOf(requestBody, summary.sharing.publicLinkExpiresAt),
      publicLinkPasswordHash: await SharingApi.#passwordHashOf(requestBody, summary.sharing.publicLinkPasswordHash),
      anonymousWriteEnabled: requestBody.boolean('anonymousWriteEnabled', summary.sharing.anonymousWriteEnabled),
    }
    await this.#context.repositories.artifactAccess.updateSharing(artifactId, sharing)
    return Response.json({ visibility, publicLinkExpiresAt: sharing.publicLinkExpiresAt, hasPassword: sharing.publicLinkPasswordHash !== null, anonymousWriteEnabled: sharing.anonymousWriteEnabled })
  }

  async grant(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', 'change who can see this artifact')
    const requestBody = await JsonBody.of(request)
    const person = await this.#context.repositories.users.findByEmail(requestBody.text('email', 320))
    if (!person) throw HttpError.notFound('a person with this email; they need to sign in once before you can add them')
    if (person.userId === summary.authorId) throw HttpError.badRequest('the author can always see their own artifact')
    const role = requestBody.oneOf('role', GRANT_ROLES, 'viewer')
    await this.#context.repositories.artifactAccess.setGrant({ artifactId, userId: person.userId, role })
    return Response.json({ userId: person.userId, name: People.displayName(person), email: person.email, role })
  }

  async revokeGrant(request: Request, artifactId: string, userId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', 'change who can see this artifact')
    await this.#context.repositories.artifactAccess.removeGrant(artifactId, userId)
    return new Response(null, { status: 204 })
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
