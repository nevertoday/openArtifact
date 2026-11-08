import { InviteCode, LOCALES, type Invite } from '@open-artifact/core'
import { Admission } from '../auth/admission.ts'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import { messagesFor } from '../i18n/messages.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

export const INVITE_LIFETIME_DAYS = 7
/** What an admin may choose for a link; null never expires, for a link pinned in a team's chat or onboarding doc. */
export const LINK_LIFETIME_DAYS = [7, 30, null] as const
const DAY = 24 * 60 * 60 * 1000
const MAX_EMAILS_PER_REQUEST = 50

/** Invites into the current workspace; only its admins create, list and revoke them, from the browser. */
export class InviteApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async list(): Promise<Response> {
    const admin = await this.#context.requireWorkspaceAdmin('see invites')
    const invites = await this.#context.repositories.invites.listPending(admin.membership.workspace.workspaceId, Date.now())
    return Response.json({ invites: await this.#invitesJson(invites) })
  }

  /** A reusable link anyone may open to join, until it expires, if it does, or is revoked. */
  async createLink(request: Request): Promise<Response> {
    const admin = await this.#context.requireWorkspaceAdmin('invite people')
    const lifetimeDays = InviteApi.#linkLifetimeOf(request.headers.get('Content-Type')?.includes('json') ? await JsonBody.of(request) : null)
    const invite = await this.#issue(admin, null, lifetimeDays)
    const [inviteJson] = await this.#invitesJson([invite])
    return Response.json({ invite: inviteJson }, { status: 201 })
  }

  /** One invite per address, each mailed its link; people who already belong are skipped and named back. */
  async inviteByEmail(request: Request): Promise<Response> {
    const admin = await this.#context.requireWorkspaceAdmin('invite people')
    const requestedEmails = InviteApi.#emailsOf(await JsonBody.of(request))
    const members = await this.#context.repositories.workspaces.listMembers(admin.membership.workspace.workspaceId)
    const memberEmails = new Set(members.map(member => Admission.normalizedEmail(member.email)))
    const alreadyMembers = requestedEmails.filter(email => memberEmails.has(email))
    const newEmails = requestedEmails.filter(email => !memberEmails.has(email))
    await this.#context.mailLimits.take('invite', { senderId: admin.userId, workspaceId: admin.membership.workspace.workspaceId }, newEmails.length, Date.now())
    const invites = await Promise.all(newEmails.map(email => this.#issue(admin, email, INVITE_LIFETIME_DAYS)))
    await this.#mail(admin, invites)
    return Response.json({ invites: await this.#invitesJson(invites), alreadyMembers }, { status: 201 })
  }

  async revoke(inviteId: string): Promise<Response> {
    const admin = await this.#context.requireWorkspaceAdmin('revoke invites')
    const workspaceId = admin.membership.workspace.workspaceId
    const revokedInvite = await this.#context.repositories.invites.revoke(workspaceId, inviteId, Date.now())
    if (!revokedInvite) throw HttpError.notFound(`pending invite ${inviteId}`)
    await this.#context.repositories.auditLog.record({ workspaceId, actorId: admin.userId, action: 'invite.revoked', targetType: 'invite', targetId: inviteId, detail: { email: revokedInvite.email } })
    return new Response(null, { status: 204 })
  }

  // `lifetimeDays` is null for a link that never expires.
  async #issue(admin: Identity, email: string | null, lifetimeDays: number | null): Promise<Invite> {
    const now = Date.now()
    const workspaceId = admin.membership.workspace.workspaceId
    const expiresAt = lifetimeDays === null ? null : now + lifetimeDays * DAY
    const invite = await this.#context.repositories.invites.create({ workspaceId, email, code: InviteCode.generate(), invitedBy: admin.userId, createdAt: now, expiresAt })
    await this.#context.repositories.auditLog.record({ workspaceId, actorId: admin.userId, action: 'member.invited', targetType: 'invite', targetId: invite.inviteId, detail: { email } })
    return invite
  }

  // The invites already exist and each link can be copied from settings, so a mail failure is logged and never fails the request.
  // Nobody knows the invitee's language yet, so the mail says it in every language, the inviter's first.
  async #mail(admin: Identity, invites: Invite[]): Promise<void> {
    const inviterLocale = await this.#context.locale()
    const inviteWords = [inviterLocale, ...LOCALES.filter(locale => locale !== inviterLocale)].map(locale => messagesFor(locale).mail.invite)
    const details = { inviter: admin.name, workspace: admin.membership.workspace.name, days: INVITE_LIFETIME_DAYS }
    const deliveries = await Promise.allSettled(
      invites.map(invite =>
        this.#context.mailer.send({
          to: InviteApi.#addressOf(invite),
          subject: inviteWords.map(words => words.subject(details)).join(' / '),
          text: inviteWords.map(words => words.body({ ...details, url: this.#context.inviteUrl(invite.code) })).join('\n\n---\n\n'),
        }),
      ),
    )
    deliveries.forEach((delivery, index) => {
      if (delivery.status === 'rejected') console.error(new Error(`invite ${invites[index]?.inviteId} could not be mailed`, { cause: delivery.reason }))
    })
  }

  async #invitesJson(invites: Invite[]) {
    const names = await this.#context.people.namesOf(invites.map(invite => invite.invitedBy))
    return invites.map(invite => ({
      inviteId: invite.inviteId,
      email: invite.email,
      url: this.#context.inviteUrl(invite.code),
      invitedBy: { userId: invite.invitedBy, name: names.get(invite.invitedBy) },
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    }))
  }

  // A link without a body keeps the lifetime links always had.
  static #linkLifetimeOf(requestBody: JsonBody | null): number | null {
    if (requestBody === null || !requestBody.has('expiresInDays')) return INVITE_LIFETIME_DAYS
    const expiresInDays = requestBody.raw('expiresInDays')
    const offered = LINK_LIFETIME_DAYS.find(lifetime => lifetime === expiresInDays)
    if (offered === undefined) throw HttpError.fieldInvalid('expiresInDays', `expiresInDays must be one of ${LINK_LIFETIME_DAYS.join(', ')}`)
    return offered
  }

  static #addressOf(invite: Invite): string {
    if (invite.email === null) throw new Error(`invite ${invite.inviteId} is a link and has no address to mail`)
    return invite.email
  }

  static #emailsOf(requestBody: JsonBody): string[] {
    const emails = requestBody.raw('emails')
    const isList = Array.isArray(emails) && emails.length >= 1 && emails.length <= MAX_EMAILS_PER_REQUEST
    if (!isList) throw HttpError.badRequest(`emails must be a list of 1 to ${MAX_EMAILS_PER_REQUEST} addresses`)
    const normalizedEmails = emails.map(email => (typeof email === 'string' ? Admission.normalizedEmail(email) : ''))
    const malformedEmail = normalizedEmails.find(email => !Admission.looksLikeEmail(email))
    if (malformedEmail !== undefined) throw HttpError.badRequest(`"${malformedEmail}" is not an email address`)
    return [...new Set(normalizedEmails)]
  }
}
