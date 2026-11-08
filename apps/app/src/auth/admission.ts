import type { Invite, JoinResult, Membership, Repositories } from '@open-artifact/core'
import type { Messages } from '../i18n/messages.ts'

/** Set when someone opens an invite link, so sign-up and the first visit after sign-in can use it. */
export const INVITE_COOKIE = 'oa_invite'
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A signed-in person, as far as joining a workspace goes. */
export interface Joiner {
  userId: string
  email: string
}

/** Joining through an invite: the join itself, or an invite addressed to someone else. */
export type InviteAcceptance = JoinResult | { status: 'other_address'; invitedEmail: string }

/** How long a personal workspace's name may be, so "{name}'s workspace" fits the workspace name limit. */
const MAX_PERSONAL_NAME_LENGTH = 24

/**
 * The one owner of "can this email create an account", and of which workspaces a person belongs to.
 *
 * | Who                                            | May create an account |
 * |------------------------------------------------|-----------------------|
 * | Any address, when ALLOWED_EMAIL_DOMAINS is "*" | yes                   |
 * | An address in ALLOWED_EMAIL_DOMAINS            | yes                   |
 * | The founder: no account yet, no domains set    | yes                   |
 * | An address with a pending email invite         | yes                   |
 * | Anyone who opened a pending invite link        | yes                   |
 * | Anyone else                                    | no                    |
 *
 * Everyone who signs in has a personal workspace, as its admin. An invite adds its workspace on top: a person who
 * left comes back through any invite, a person an admin removed only through an email invite addressed to them.
 */
export class Admission {
  /** The API's answer; it never names the allowed domains or the setting behind them. The login page words its own. */
  static readonly REFUSAL = "This email can't sign up for Open Artifact yet. Ask an admin to invite you."
  static readonly REFUSAL_CODE = 'EMAIL_NOT_ADMITTED'
  /** In ALLOWED_EMAIL_DOMAINS, opens sign-up to every address. */
  static readonly ANY_DOMAIN = '*'

  readonly #allowedDomains: string[]
  readonly #repositories: Repositories

  /** `allowedDomainsSetting` is a comma-separated list such as "example.com, example.cn", or "*" to admit any address. */
  constructor(allowedDomainsSetting: string | undefined, repositories: Repositories) {
    this.#allowedDomains = (allowedDomainsSetting ?? '')
      .split(',')
      .map(domain => domain.trim().toLowerCase())
      .filter(domain => domain.length > 0)
    this.#repositories = repositories
  }

  /** `inviteCode` is the invite link this browser opened, if any. */
  async mayCreateAccount(email: string, inviteCode: string | null): Promise<boolean> {
    if ((await this.#inviteFor(email, inviteCode)) !== null) return true
    if (this.#allowedDomains.includes(Admission.ANY_DOMAIN)) return true
    if (this.#allowedDomains.length > 0) return this.#allowedDomains.includes(Admission.#domainOf(email))
    // With no allowlist and no invite, only the founder may sign up, so a fresh deployment is never open to everyone.
    return !(await this.#repositories.users.hasAnyUser())
  }

  /** A new account: its personal workspace, and the workspace of the invite it signed up through, if any. */
  async welcome(joiner: Joiner, inviteCode: string | null, personalWorkspaceName: string): Promise<void> {
    await this.ensurePersonal(joiner, personalWorkspaceName)
    const invite = await this.#inviteFor(joiner.email, inviteCode)
    if (invite !== null) await this.#joinThrough(invite, joiner)
  }

  /** Safe on every request: it creates the personal workspace only for a person who has none. */
  ensurePersonal(joiner: Joiner, personalWorkspaceName: string): Promise<Membership> {
    return this.#repositories.workspaces.ensurePersonal(joiner.userId, personalWorkspaceName, Date.now())
  }

  /** The name a personal workspace starts with, in the person's language; they may rename it later. */
  static personalWorkspaceName(m: Messages, displayName: string): string {
    const shortName = displayName.length > MAX_PERSONAL_NAME_LENGTH ? `${displayName.slice(0, MAX_PERSONAL_NAME_LENGTH - 1)}…` : displayName
    return m.server.personalWorkspaceName(shortName)
  }

  /** A signed-in person following an invite link, whether or not they already belong to a workspace. */
  accept(invite: Invite, joiner: Joiner): Promise<InviteAcceptance> {
    if (!Admission.#admits(invite, joiner.email)) return Promise.resolve({ status: 'other_address', invitedEmail: invite.email ?? '' })
    return this.#joinThrough(invite, joiner)
  }

  // A link invite counts only for the addresses it admits; otherwise an email invite addressed to the person does.
  async #inviteFor(email: string, inviteCode: string | null): Promise<Invite | null> {
    const now = Date.now()
    const linkInvite = inviteCode === null ? null : await this.#repositories.invites.findPendingByCode(inviteCode, now)
    if (linkInvite !== null && Admission.#admits(linkInvite, email)) return linkInvite
    const [emailInvite] = await this.#repositories.invites.listPendingForEmail(Admission.normalizedEmail(email), now)
    return emailInvite ?? null
  }

  // An email invite names the person, so it brings back someone an admin removed; a link names nobody, so it does not.
  // Either brings back a person who left.
  async #joinThrough(invite: Invite, joiner: Joiner): Promise<JoinResult> {
    const now = Date.now()
    const joinResult = await this.#repositories.workspaces.join(invite.workspaceId, joiner.userId, now, { readmitsRemoved: invite.email !== null })
    switch (joinResult.status) {
      case 'joined':
        await this.#recordJoin(invite, joiner, now)
        return joinResult
      case 'already_member':
      case 'removed':
        return joinResult
    }
  }

  async #recordJoin(invite: Invite, joiner: Joiner, now: number): Promise<void> {
    await this.#repositories.invites.markAccepted(invite.inviteId, now)
    await this.#repositories.auditLog.record({
      workspaceId: invite.workspaceId,
      actorId: joiner.userId,
      action: 'member.joined',
      targetType: 'member',
      targetId: joiner.userId,
      detail: { via: invite.email === null ? 'link' : 'email' },
    })
  }

  static #admits(invite: Invite, email: string): boolean {
    return invite.email === null || invite.email === Admission.normalizedEmail(email)
  }

  static looksLikeEmail(email: string): boolean {
    return EMAIL_SHAPE.test(email)
  }

  /** Invites store addresses this way, and every comparison with one goes through it. */
  static normalizedEmail(email: string): string {
    return email.trim().toLowerCase()
  }

  static #domainOf(email: string): string {
    return Admission.normalizedEmail(email).split('@').pop() ?? ''
  }
}
