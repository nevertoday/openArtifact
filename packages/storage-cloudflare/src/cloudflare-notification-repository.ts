import { NOTIFICATION_KINDS, type NewNotification, type Notification, type NotificationKind, type NotificationRepository } from '@open-artifact/core'

const NOTIFICATION_COLUMNS = 'id, recipient_id, kind, artifact_id, comment_id, actor_id, actor_agent_client, created_at, read_at'

interface NotificationRow {
  id: string
  recipient_id: string
  kind: string
  artifact_id: string
  comment_id: string | null
  actor_id: string
  actor_agent_client: string | null
  created_at: number
  read_at: number | null
}

export class CloudflareNotificationRepository implements NotificationRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async addAll(newNotifications: NewNotification[]): Promise<void> {
    if (newNotifications.length === 0) return
    const createdAt = Date.now()
    await this.#db.batch(
      newNotifications.map(newNotification =>
        this.#db
          .prepare(
            `INSERT INTO notifications (id, recipient_id, kind, artifact_id, comment_id, actor_id, actor_agent_client, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            newNotification.recipientId,
            newNotification.kind,
            newNotification.artifactId,
            newNotification.commentId,
            newNotification.actorId,
            newNotification.actorAgentClient,
            createdAt,
          ),
      ),
    )
  }

  async listForRecipient(recipientId: string, limit: number): Promise<Notification[]> {
    const { results: notificationRows } = await this.#db
      .prepare(`SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .bind(recipientId, limit)
      .all<NotificationRow>()
    return notificationRows.map(CloudflareNotificationRepository.#notificationOf)
  }

  async markRead(recipientId: string, notificationId: string): Promise<boolean> {
    const { meta } = await this.#db
      .prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND recipient_id = ?')
      .bind(Date.now(), notificationId, recipientId)
      .run()
    return meta.changes === 1
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.#db.prepare('UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL').bind(Date.now(), recipientId).run()
  }

  static #notificationOf(notificationRow: NotificationRow): Notification {
    return {
      notificationId: notificationRow.id,
      recipientId: notificationRow.recipient_id,
      kind: CloudflareNotificationRepository.#kindOf(notificationRow),
      artifactId: notificationRow.artifact_id,
      commentId: notificationRow.comment_id,
      actorId: notificationRow.actor_id,
      actorAgentClient: notificationRow.actor_agent_client,
      createdAt: notificationRow.created_at,
      readAt: notificationRow.read_at,
    }
  }

  static #kindOf(notificationRow: NotificationRow): NotificationKind {
    const kind = NOTIFICATION_KINDS.find(candidate => candidate === notificationRow.kind)
    if (!kind) throw new Error(`Notification ${notificationRow.id} has the unknown kind "${notificationRow.kind}"`)
    return kind
  }
}
