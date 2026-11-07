import { InviteCode, LOCALES, type Invite } from '@open-artifact/core'
import { Admission } from '../auth/admission.ts'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import { messagesFor } from '../i18n/messages.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

export const INVITE_LIFETIME_DAYS = 7
const DAY = 24 * 60 * 60 * 1000
const MAX_EMAILS_PER_REQUEST = 50
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

  /** A reusable link anyone may open to join, until it expires or is revoked. */
  async createLink(): Promise<Response> {
    const admin = await this.#context.requireWorkspaceAdmin('invite people')
    const invite = await this.#issue(admin, null)
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
    const invites = await Promise.all(newEmails.map(email => this.#issue(admin, email)))
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

  async #issue(admin: Identity, email: string | null): Promise<Invite> {
    const now = Date.now()
    const workspaceId = admin.membership.workspace.workspaceId
    const invite = await this.#context.repositories.invites.create({ workspaceId, email, code: InviteCode.generate(), invitedBy: admin.userId, createdAt: now, expiresAt: now + INVITE_LIFETIME_DAYS * DAY })
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
          subject: messagesFor(inviterLocale).mail.invite.subject(details),
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

  static #addressOf(invite: Invite): string {
    if (invite.email === null) throw new Error(`invite ${invite.inviteId} is a link and has no address to mail`)
    return invite.email
  }

  static #emailsOf(requestBody: JsonBody): string[] {
    const emails = requestBody.raw('emails')
    const isList = Array.isArray(emails) && emails.length >= 1 && emails.length <= MAX_EMAILS_PER_REQUEST
    if (!isList) throw HttpError.badRequest(`emails must be a list of 1 to ${MAX_EMAILS_PER_REQUEST} addresses`)
    const normalizedEmails = emails.map(email => (typeof email === 'string' ? Admission.normalizedEmail(email) : ''))
    const malformedEmail = normalizedEmails.find(email => !EMAIL_SHAPE.test(email))
    if (malformedEmail !== undefined) throw HttpError.badRequest(`"${malformedEmail}" is not an email address`)
    return [...new Set(normalizedEmails)]
  }
}
