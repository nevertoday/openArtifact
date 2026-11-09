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
}
