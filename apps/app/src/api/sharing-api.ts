import {
  ArtifactAccess,
  LOCALES,
  PublicLinkPassword,
  type ArtifactSharing,
  type ArtifactSummary,
  type ArtifactVisibility,
  type GrantRole,
  type PendingGrant,
  type PersonGrant,
  type UserProfile,
} from '@open-artifact/core'
import { ArtifactGate } from '../access/artifact-gate.ts'
import { Admission } from '../auth/admission.ts'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import { messagesFor } from '../i18n/messages.ts'
import { People } from '../people.ts'
import { ShareCard } from '../share/share-card.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'
import { PublicLinkExpiry } from './public-link-expiry.ts'

const VISIBILITIES: readonly ArtifactVisibility[] = ['private', 'specified', 'workspace', 'public_link']
const GRANT_ROLES: readonly GrantRole[] = ['viewer', 'commenter', 'editor']
const MAX_PASSWORD_LENGTH = 128
const MAX_GRANTS = 200
const MANAGE_SHARING = 'change who can see this artifact'

/** The list of people on an artifact: those with an account, and the addresses waiting for one. */
interface SharingPeople {
  grants: PersonGrant[]
  pending: PendingGrant[]
}

/** A grant as the request names it: an account already on the list, or an address. */
type RequestedGrant = PersonGrant | { email: string; role: GrantRole }

/** Who can see an artifact; only its author changes this, and every change is saved in one request. */
export class SharingApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async read(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    return Response.json(await this.#sharingJson(summary, await this.#savedPeople(artifactId)))
  }

  /** A member who may not open the artifact asks its author to share it; the author hears through the notifier. */
  async requestAccess(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const openedArtifact = await this.#context.gate.open(artifactId, identity, request)
    if (openedArtifact === null || !ArtifactGate.mayAskForAccess(openedArtifact, identity)) throw HttpError.notFound(`artifact ${artifactId}`)
    await this.#context.notifier.notify(identity, openedArtifact.summary, { kind: 'access_requested', requesterEmail: identity.email })
    return new Response(null, { status: 204 })
  }

  /**
   * The person the author is about to add. Every well-formed address gets the same answer, so the dialog never
   * tells who has an account; the name shows only for someone the author already works with in a workspace.
   */
  async findPerson(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const email = Admission.normalizedEmail(new URL(request.url).searchParams.get('email') ?? '')
    if (email.length === 0) throw HttpError.fieldRequired('email', null)
    if (!Admission.looksLikeEmail(email)) throw HttpError.fieldInvalid('email', `"${email}" is not an email address`)
    const coMember = (await this.#coMembersAt(identity.userId, [email])).get(email)
    if (coMember?.userId === summary.authorId) throw new HttpError(400, 'author_always_sees', 'the author can always see their own artifact', { field: 'email' })
    return Response.json({ email, name: coMember ? People.displayName(coMember) : null })
  }

  /** Each field left out keeps its saved value; `grants`, when sent, is the complete list of people, pending ones included. */
  async update(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canManageSharing', MANAGE_SHARING)
    const requestBody = await JsonBody.of(request)
    const saved = await this.#savedPeople(artifactId)
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
    const people = requestBody.has('grants') ? await this.#peopleFrom(requestBody.raw('grants'), summary, saved, identity) : saved
    const newlyGranted = SharingApi.#newlyListed(summary.sharing.visibility, saved.grants, visibility, people.grants, grant => grant.userId)
    const newlyPending = SharingApi.#newlyListed(summary.sharing.visibility, saved.pending, visibility, people.pending, pending => pending.email)
    const pendingToMail = await this.#mayCreateAccount(newlyPending)
    await this.#takeShareMailQuota(identity, summary, newlyGranted, pendingToMail.length)
    await this.#context.repositories.artifactAccess.saveSharing(artifactId, sharing, people.grants, people.pending)
    for (const grant of newlyGranted) await this.#context.notifier.notify(identity, summary, { kind: 'artifact_shared', sharedWithId: grant.userId, role: grant.role })
    await this.#mailPending(identity, summary, pendingToMail)
    if (publicLinkExpiry.agentDefaultExpiresAt !== null) await this.#context.notifier.notify(identity, summary, { kind: 'public_link_opened_by_agent', expiresAt: publicLinkExpiry.agentDefaultExpiresAt })
    return Response.json(await this.#sharingJson({ ...summary, sharing }, people))
  }

  async #savedPeople(artifactId: string): Promise<SharingPeople> {
    const [grants, pending] = await Promise.all([this.#context.repositories.artifactAccess.listGrants(artifactId), this.#context.repositories.artifactAccess.listPendingGrants(artifactId)])
    return { grants: grants.map(({ userId, role }) => ({ userId, role })), pending }
  }

  // The account behind each address, only where the sharer already works with it in a workspace; null for everyone
  // else, account or not. An address with no account still runs the membership query, so timing does not tell them apart.
  async #coMembersAt(sharerId: string, emails: string[]): Promise<Map<string, UserProfile | null>> {
    const { users, workspaces } = this.#context.repositories
    const sharerWorkspaceIds = new Set((await workspaces.membershipsOf(sharerId)).map(membership => membership.workspace.workspaceId))
    const coMembers = await Promise.all(
      emails.map(async email => {
        const person = await users.findByEmail(email)
        const memberships = await workspaces.membershipsOf(person?.userId ?? '')
        return person !== null && memberships.some(membership => sharerWorkspaceIds.has(membership.workspace.workspaceId)) ? person : null
      }),
    )
    return new Map(emails.map((email, index) => [email, coMembers[index] ?? null]))
  }

  // Where this deployment would refuse the address at sign-up, the grant waits quietly instead of mailing an invitation that cannot be used.
  async #mayCreateAccount(pendingGrants: PendingGrant[]): Promise<PendingGrant[]> {
    const admitted = await Promise.all(pendingGrants.map(pending => this.#context.admission.mayCreateAccount(pending.email, null)))
    return pendingGrants.filter((_, index) => admitted[index])
  }

  // Members hear about pages in their own workspace all the time; mail to anyone else is what a spammer would send.
  async #takeShareMailQuota(identity: Identity, summary: ArtifactSummary, newlyGranted: PersonGrant[], pendingMails: number): Promise<void> {
    const members = await this.#context.repositories.workspaces.listMembers(summary.workspaceId)
    const memberIds = new Set(members.map(member => member.userId))
    const mailsToOutsiders = newlyGranted.filter(grant => !memberIds.has(grant.userId)).length + pendingMails
    await this.#context.mailLimits.take('share', { senderId: identity.userId, workspaceId: summary.workspaceId }, mailsToOutsiders, Date.now())
  }

  // The grants are saved and the dialog lists them, so a mail failure is logged and never fails the request.
  // Nobody knows the person's language yet, so the mail says it in every language, the sharer's first.
  async #mailPending(sharer: Identity, summary: ArtifactSummary, pendingGrants: PendingGrant[]): Promise<void> {
    if (pendingGrants.length === 0) return
    const sharerLocale = await this.#context.locale()
    const shareWords = [sharerLocale, ...LOCALES.filter(locale => locale !== sharerLocale)].map(locale => messagesFor(locale).mail.pendingShare)
    const url = this.#context.artifactUrl(summary)
    const deliveries = await Promise.allSettled(
      pendingGrants.map(pending => {
        const details = { sharer: sharer.name, title: summary.title, email: pending.email, url }
        return this.#context.mailer.send({ to: pending.email, subject: shareWords.map(words => words.subject(details)).join(' / '), text: shareWords.map(words => words.body(details)).join('\n\n---\n\n') })
      }),
    )
    deliveries.forEach((delivery, index) => {
      if (delivery.status === 'rejected') console.error(new Error(`a pending grant on artifact ${summary.artifactId} could not be mailed to address ${index + 1}`, { cause: delivery.reason }))
    })
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

  // People already on the list stay valid even if their account was deleted. An address is added as the account of
  // someone the sharer works with in a workspace; any other address waits for whoever signs in with it, whether or
  // not it has an account, so saving never tells the sharer who uses Open Artifact.
  async #peopleFrom(grantsJson: unknown, summary: ArtifactSummary, saved: SharingPeople, identity: Identity): Promise<SharingPeople> {
    if (!Array.isArray(grantsJson)) throw HttpError.badRequest('grants must be a list of { email, role } or { userId, role }')
    if (grantsJson.length > MAX_GRANTS) throw HttpError.badRequest(`an artifact may be shared with at most ${MAX_GRANTS} people`)
    const requested = grantsJson.map(grantJson => SharingApi.#requestedGrantOf(grantJson))
    const coMembers = await this.#coMembersAt(identity.userId, requested.flatMap(grant => ('email' in grant ? [grant.email] : [])))
    const grants: PersonGrant[] = []
    const pending: PendingGrant[] = []
    const savedPending = new Map(saved.pending.map(savedGrant => [savedGrant.email, savedGrant]))
    for (const grant of requested) {
      const coMember = 'email' in grant ? coMembers.get(grant.email) : null
      if ('userId' in grant) grants.push(grant)
      else if (coMember) grants.push({ userId: coMember.userId, role: grant.role })
      else pending.push({ grantedBy: identity.userId, createdAt: Date.now(), ...savedPending.get(grant.email), email: grant.email, role: grant.role })
    }
    const userIds = grants.map(grant => grant.userId)
    const emails = pending.map(pendingGrant => pendingGrant.email)
    if (new Set(userIds).size !== userIds.length || new Set(emails).size !== emails.length) throw HttpError.badRequest('each person may appear only once in grants')
    if (userIds.includes(summary.authorId)) throw new HttpError(400, 'author_always_sees', 'the author can always see their own artifact')
    const savedUserIds = new Set(saved.grants.map(grant => grant.userId))
    const addedUserIds = userIds.filter(userId => !savedUserIds.has(userId))
    const addedProfiles = await this.#context.repositories.users.profilesOf(addedUserIds)
    const unknownUserIds = addedUserIds.filter(userId => !addedProfiles.has(userId))
    if (unknownUserIds.length > 0) throw HttpError.badRequest(`grants name people who have no account: ${unknownUserIds.join(', ')}`)
    return { grants, pending }
  }

  async #sharingJson(summary: ArtifactSummary, people: SharingPeople) {
    const [members, workspace, grantedProfiles, profile] = await Promise.all([
      this.#context.repositories.workspaces.listMembers(summary.workspaceId),
      this.#context.repositories.workspaces.findWorkspace(summary.workspaceId),
      this.#context.repositories.users.profilesOf(people.grants.map(grant => grant.userId)),
      this.#context.repositories.profiles.findByUser(summary.authorId),
    ])
    const deletedPersonName = (await this.#context.messages()).server.deletedPerson
    const shareReadiness = new ArtifactAccess(summary, workspace?.publicLinksEnabled ?? false, Date.now()).shareReadiness
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
      grants: [
        ...people.grants.map(grant => {
          const profile = grantedProfiles.get(grant.userId)
          return { userId: grant.userId, role: grant.role, name: profile ? People.displayName(profile) : deletedPersonName, email: profile?.email ?? null, pending: false }
        }),
        ...people.pending.map(pendingGrant => ({ userId: null, role: pendingGrant.role, name: null, email: pendingGrant.email, pending: true })),
      ],
      members: members.map(member => ({ userId: member.userId, name: People.displayName(member), email: member.email })),
      share: ShareCard.of(summary, shareReadiness, this.#context.appOrigin).toJson(),
    }
  }

  static #requestedGrantOf(grantJson: unknown): RequestedGrant {
    const { userId, email, role } = (typeof grantJson === 'object' && grantJson !== null ? grantJson : {}) as Record<string, unknown>
    const knownRole = GRANT_ROLES.find(candidate => candidate === role)
    const refusal = HttpError.badRequest(`each grant must be { email, role } or { userId, role } with role one of ${GRANT_ROLES.join(', ')}`)
    if (knownRole === undefined) throw refusal
    if (typeof userId === 'string' && userId.length > 0 && email === undefined) return { userId, role: knownRole }
    if (typeof email !== 'string' || userId !== undefined) throw refusal
    const normalizedEmail = Admission.normalizedEmail(email)
    if (!Admission.looksLikeEmail(normalizedEmail)) throw HttpError.badRequest(`"${normalizedEmail}" is not an email address`)
    return { email: normalizedEmail, role: knownRole }
  }

  // The entries that let someone in through the list now and did not before the save.
  static #newlyListed<Entry>(visibilityBefore: ArtifactVisibility, before: Entry[], visibilityAfter: ArtifactVisibility, after: Entry[], keyOf: (entry: Entry) => string): Entry[] {
    if (!ArtifactAccess.grantsApplyUnder(visibilityAfter)) return []
    const listedBefore = ArtifactAccess.grantsApplyUnder(visibilityBefore) ? new Set(before.map(keyOf)) : new Set<string>()
    return after.filter(entry => !listedBefore.has(keyOf(entry)))
  }

  // Absent keeps the current password, null removes it, a string sets a new one.
  static async #passwordHashOf(requestBody: JsonBody, currentHash: string | null): Promise<string | null> {
    if (!requestBody.has('publicLinkPassword')) return currentHash
    const newPassword = requestBody.optionalText('publicLinkPassword', MAX_PASSWORD_LENGTH)
    return newPassword === null ? null : PublicLinkPassword.hash(newPassword)
  }
}
