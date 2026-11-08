import type { MailQuota, MailQuotaScope, OutboundMailing, OutboundMailLog } from '@open-artifact/core'

const SCOPE_COLUMN: Record<MailQuotaScope, 'workspace_id' | 'sender_id'> = { workspace: 'workspace_id', sender: 'sender_id' }

export class CloudflareOutboundMailLog implements OutboundMailLog {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  // The count and the insert are one statement, so two requests at once cannot both slip under the cap.
  async record(mailing: OutboundMailing, quota: MailQuota): Promise<boolean> {
    const column = SCOPE_COLUMN[quota.scope]
    const scopeValue = quota.scope === 'workspace' ? mailing.workspaceId : mailing.senderId
    const [inserted] = await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO outbound_mail (kind, sender_id, workspace_id, mail_count, sent_at)
           SELECT ?1, ?2, ?3, ?4, ?5
           WHERE (SELECT COALESCE(SUM(mail_count), 0) FROM outbound_mail WHERE kind = ?1 AND ${column} = ?6 AND sent_at > ?7) + ?4 <= ?8`,
        )
        .bind(mailing.kind, mailing.senderId, mailing.workspaceId, mailing.count, mailing.sentAt, scopeValue, quota.since, quota.max),
      this.#db.prepare(`DELETE FROM outbound_mail WHERE kind = ? AND ${column} = ? AND sent_at <= ?`).bind(mailing.kind, scopeValue, quota.since),
    ])
    return (inserted?.meta.changes ?? 0) > 0
  }
}
