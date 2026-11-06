import type { AuditEvent, AuditLog, NewAuditEvent } from '@open-artifact/core'

interface AuditEventRow {
  id: string
  workspace_id: string
  actor_id: string
  action: string
  target_type: string
  target_id: string
  detail: string
  created_at: number
}

export class CloudflareAuditLog implements AuditLog {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async record(newEvent: NewAuditEvent): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO audit_events (id, workspace_id, actor_id, action, target_type, target_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), newEvent.workspaceId, newEvent.actorId, newEvent.action, newEvent.targetType, newEvent.targetId, JSON.stringify(newEvent.detail), Date.now())
      .run()
  }

  async listLatest(workspaceId: string, limit: number): Promise<AuditEvent[]> {
    const { results: eventRows } = await this.#db
      .prepare('SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .bind(workspaceId, limit)
      .all<AuditEventRow>()
    return eventRows.map(CloudflareAuditLog.#eventOf)
  }

  // Rows are only written by record(), so action, target type and detail always belong together.
  static #eventOf(eventRow: AuditEventRow): AuditEvent {
    return {
      eventId: eventRow.id,
      workspaceId: eventRow.workspace_id,
      actorId: eventRow.actor_id,
      action: eventRow.action,
      targetType: eventRow.target_type,
      targetId: eventRow.target_id,
      detail: JSON.parse(eventRow.detail),
      createdAt: eventRow.created_at,
    } as AuditEvent
  }
}
