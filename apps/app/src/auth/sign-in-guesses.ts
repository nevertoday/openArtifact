import type { SignInCodeFailures } from '@open-artifact/core'

/**
 * Wrong sign-in codes typed for one address. A code allows three tries and a new one can be asked for every
 * twenty seconds, so without a cap over a longer window someone could keep guessing one person's code for days.
 * After `LIMIT` wrong codes in a day the address cannot sign in with a code until the oldest of them ages out;
 * its owner can still use GitHub, Google or company SSO.
 */
export class SignInGuesses {
  static readonly LIMIT = 10
  static readonly WINDOW_MS = 24 * 60 * 60 * 1000

  readonly #failures: SignInCodeFailures
  readonly #now: () => number

  constructor(failures: SignInCodeFailures, now: () => number = Date.now) {
    this.#failures = failures
    this.#now = now
  }

  async isLocked(email: string): Promise<boolean> {
    return (await this.#failures.countSince(email, this.#now() - SignInGuesses.WINDOW_MS)) >= SignInGuesses.LIMIT
  }

  async recordWrong(email: string): Promise<void> {
    const now = this.#now()
    await this.#failures.record(email, now, now - SignInGuesses.WINDOW_MS)
  }
}
