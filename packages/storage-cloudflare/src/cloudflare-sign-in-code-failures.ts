import type { SignInCodeFailures } from '@open-artifact/core'

export class CloudflareSignInCodeFailures implements SignInCodeFailures {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async record(email: string, at: number, forgetBefore: number): Promise<void> {
    await this.#db.batch([
      this.#db.prepare('INSERT INTO sign_in_code_failure (email, failed_at) VALUES (?, ?)').bind(email, at),
      this.#db.prepare('DELETE FROM sign_in_code_failure WHERE email = ? AND failed_at < ?').bind(email, forgetBefore),
    ])
  }

  async countSince(email: string, since: number): Promise<number> {
    const row = await this.#db.prepare('SELECT COUNT(*) AS failures FROM sign_in_code_failure WHERE email = ? AND failed_at > ?').bind(email, since).first<{ failures: number }>()
    return row?.failures ?? 0
  }
}
