import type { PublishLog } from '@open-artifact/core'

export class CloudflarePublishLog implements PublishLog {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  // The count and the insert are one statement, so two publishes at once cannot both take the last place.
  async record(publisherId: string, publishedAt: number, quota: { max: number; since: number }): Promise<number | null> {
    const [inserted] = await this.#db.batch<{ rowid: number }>([
      this.#db
        .prepare(
          `INSERT INTO publish_log (publisher_id, published_at)
           SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM publish_log WHERE publisher_id = ?1 AND published_at > ?3) < ?4
           RETURNING rowid`,
        )
        .bind(publisherId, publishedAt, quota.since, quota.max),
      this.#db.prepare('DELETE FROM publish_log WHERE publisher_id = ? AND published_at <= ?').bind(publisherId, quota.since),
    ])
    return inserted?.results[0]?.rowid ?? null
  }

  async release(entryId: number): Promise<void> {
    await this.#db.prepare('DELETE FROM publish_log WHERE rowid = ?').bind(entryId).run()
  }
}
