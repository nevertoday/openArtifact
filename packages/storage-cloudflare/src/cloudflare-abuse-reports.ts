import type { AbuseReports, NewAbuseReport } from '@open-artifact/core'

export class CloudflareAbuseReports implements AbuseReports {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  // The count and the insert are one statement, so a burst of reports cannot slip past the cap.
  async record(report: NewAbuseReport, cap: { max: number; since: number }): Promise<string | null> {
    const reportId = crypto.randomUUID()
    const inserted = await this.#db
      .prepare(
        `INSERT INTO abuse_reports (id, artifact_id, short_id, reason, details, reporter_email, reporter_id, ip_hash, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT COUNT(*) FROM abuse_reports WHERE artifact_id = ?2 AND created_at > ?10) < ?11`,
      )
      .bind(reportId, report.artifactId, report.shortId, report.reason, report.details, report.reporterEmail, report.reporterId, report.ipHash, report.createdAt, cap.since, cap.max)
      .run()
    return inserted.meta.changes === 1 ? reportId : null
  }

  async claimMail(reportId: string, mailedAt: number, cap: { max: number; since: number }): Promise<boolean> {
    const claimed = await this.#db
      .prepare('UPDATE abuse_reports SET mailed_at = ?2 WHERE id = ?1 AND mailed_at IS NULL AND (SELECT COUNT(*) FROM abuse_reports WHERE mailed_at > ?3) < ?4')
      .bind(reportId, mailedAt, cap.since, cap.max)
      .run()
    return claimed.meta.changes === 1
  }

  async releaseMail(reportId: string): Promise<void> {
    await this.#db.prepare('UPDATE abuse_reports SET mailed_at = NULL WHERE id = ?').bind(reportId).run()
  }

  async countUnmailedSince(since: number): Promise<number> {
    return (await this.#db.prepare('SELECT COUNT(*) AS count FROM abuse_reports WHERE created_at > ? AND mailed_at IS NULL').bind(since).first<number>('count')) ?? 0
  }
}
