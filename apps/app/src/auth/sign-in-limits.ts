import { HttpError } from '../http-error.ts'
import { OpenArtifactAuth } from './open-artifact-auth.ts'

export interface SignInLimiters {
  /** Codes mailed to one address: keeps anyone from filling a person's inbox. */
  byEmail: RateLimit
  /** Codes asked for from one network address: keeps one sender from mailing many addresses. */
  byAddress: RateLimit
}

/**
 * Asking for a sign-in code sends mail, so it is limited per recipient and per sender before Better Auth sees
 * the request. Cloudflare's rate limiter counts at each Cloudflare location, not globally, so these only slow a sender
 * down; `SignInGuesses` caps wrong codes for good.
 */
export class SignInLimits {
  readonly #limiters: SignInLimiters

  constructor(limiters: SignInLimiters) {
    this.#limiters = limiters
  }

  /** The 429 to answer with, or null when the request may go on. */
  async refusalFor(request: Request): Promise<Response | null> {
    const asksForCode = request.method === 'POST' && new URL(request.url).pathname === OpenArtifactAuth.SEND_CODE_PATH
    if (!asksForCode) return null
    const [emailAllowed, addressAllowed] = await Promise.all([this.#emailAllowed(request), this.#addressAllowed(request)])
    if (emailAllowed && addressAllowed) return null
    const refusal = new HttpError(429, 'rate_limited', 'too many sign-in codes were asked for; wait a minute and try again').toResponse()
    refusal.headers.set('Retry-After', '60')
    return refusal
  }

  // An unreadable body is left for Better Auth to refuse with its own error.
  async #emailAllowed(request: Request): Promise<boolean> {
    const requestBody: unknown = await request.clone().json().catch(() => null)
    const email = typeof requestBody === 'object' && requestBody !== null ? (requestBody as { email?: unknown }).email : null
    if (typeof email !== 'string') return true
    const { success } = await this.#limiters.byEmail.limit({ key: email.trim().toLowerCase() })
    return success
  }

  // Cloudflare always names the sender; a request without it comes from local development or tests.
  async #addressAllowed(request: Request): Promise<boolean> {
    const senderAddress = request.headers.get('CF-Connecting-IP')
    if (senderAddress === null) return true
    const { success } = await this.#limiters.byAddress.limit({ key: senderAddress })
    return success
  }
}
