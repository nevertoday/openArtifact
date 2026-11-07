export const NOTIFICATION_KINDS = ['comment_on_my_artifact', 'reply_to_my_comment', 'my_comment_resolved', 'new_version', 'shared_with_me', 'public_link_opened', 'access_requested'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Something that happened on an artifact, told to one person. */
export interface Notification {
  notificationId: string
  recipientId: string
  kind: NotificationKind
  artifactId: string
  /** The comment the notification points at; null for a new version or a share. */
  commentId: string | null
  actorId: string
  /** The agent client that acted for the actor, e.g. "Claude Code"; null when the person acted in the browser. */
  actorAgentClient: string | null
  createdAt: number
  readAt: number | null
}

export type NewNotification = Omit<Notification, 'notificationId' | 'createdAt' | 'readAt'>

export interface NotificationRepository {
  addAll(newNotifications: NewNotification[]): Promise<void>
  /** Newest first. */
  listForRecipient(recipientId: string, limit: number): Promise<Notification[]>
  /** Returns false when the recipient has no such notification. */
  markRead(recipientId: string, notificationId: string): Promise<boolean>
  markAllRead(recipientId: string): Promise<void>
}
