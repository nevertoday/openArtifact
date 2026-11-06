import type { Invite, JoinResult, Membership, Repositories } from '@open-artifact/core'

/** Set when someone opens an invite link, so sign-up and the first visit after sign-in can use it. */
export const INVITE_COOKIE = 'oa_invite'
const FIRST_WORKSPACE_NAME = '我的团队'

/** A signed-in person, as far as joining a workspace goes. */
export interface Joiner {
  userId: string
  email: string
}

/** Joining through an invite: the join itself, or an invite addressed to someone else. */
export type InviteAcceptance = JoinResult | { status: 'other_address'; invitedEmail: string }

/**
 * The one owner of "can this email join", and of which workspace a person joins.
 *
 * | Who                                            | May create an account | Joins                                        |
 * |------------------------------------------------|-----------------------|----------------------------------------------|
 * | The founder: no account yet, no domains set     | yes                   | the new first workspace, as admin            |
 * | An address in ALLOWED_EMAIL_DOMAINS            | yes                   | the first workspace, as member               |
 * | An address with a pending email invite         | yes                   | the invite's workspace; readmits if removed  |
 * | Anyone who opened a pending invite link        | yes                   | the invite's workspace; removed stays out    |
 * | Anyone else                                    | no                    |                                              |
 */
export class Admission {
  /** Shown under the email field; it never names the allowed domains or the setting behind them. */
  static readonly REFUSAL = '这个邮箱不能登录 Open Artifact。请用公司邮箱，或请管理员邀请你。'
  static readonly REFUSAL_CODE = 'EMAIL_NOT_ADMITTED'

  readonly #allowedDomains: string[]
  readonly #repositories: Repositories

  /** `allowedDomainsSetting` is a comma-separated list such as "example.com, example.cn". */
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
    if (this.#allowedDomains.length > 0) return this.#allowedDomains.includes(Admission.#domainOf(email))
    // With no allowlist and no invite, only the founder may sign up, so a fresh deployment is never open to everyone.
    return !(await this.#repositories.users.hasAnyUser())
  }

  /** For a person who belongs to no workspace yet; null when an admin removed them and no invite brings them back. */
  async join(joiner: Joiner, inviteCode: string | null): Promise<Membership | null> {
    const invite = await this.#inviteFor(joiner.email, inviteCode)
    if (invite === null) return this.#repositories.workspaces.joinFirstWorkspace(joiner.userId, FIRST_WORKSPACE_NAME)
    const joinResult = await this.#joinThrough(invite, joiner)
    return joinResult.status === 'removed' ? null : joinResult.membership
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

  /** Invites store addresses this way, and every comparison with one goes through it. */
  static normalizedEmail(email: string): string {
    return email.trim().toLowerCase()
  }

  static #domainOf(email: string): string {
    return Admission.normalizedEmail(email).split('@').pop() ?? ''
  }
}
