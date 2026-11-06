import type { UserDirectory } from '@open-artifact/core'

/**
 * Who may create an account. Signing in makes a person a member of the team workspace, so an open
 * sign-up would hand every workspace-visible artifact to anyone with an email address.
 */
export class SignUpPolicy {
  readonly #allowedDomains: string[]
  readonly #users: UserDirectory

  /** `allowedDomainsSetting` is a comma-separated list such as "example.com, example.cn". */
  constructor(allowedDomainsSetting: string | undefined, users: UserDirectory) {
    this.#allowedDomains = (allowedDomainsSetting ?? '')
      .split(',')
      .map(domain => domain.trim().toLowerCase())
      .filter(domain => domain.length > 0)
    this.#users = users
  }

  get refusalMessage(): string {
    if (this.#allowedDomains.length > 0) return `只有这些邮箱域名可以注册：${this.#allowedDomains.join('、')}`
    return '这个 Open Artifact 还没有开放注册。请管理员设置 ALLOWED_EMAIL_DOMAINS。'
  }

  async allows(email: string): Promise<boolean> {
    if (this.#allowedDomains.length > 0) return this.#allowedDomains.includes(SignUpPolicy.#domainOf(email))
    // With no allowlist, only the founder may sign up, so a fresh deployment is never open to everyone.
    return !(await this.#users.hasAnyUser())
  }

  static #domainOf(email: string): string {
    return email.trim().toLowerCase().split('@').pop() ?? ''
  }
}
