import type { Notification } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import type { Messages } from '../i18n/messages.ts'
import { HttpError } from '../http-error.ts'
import { NotificationText } from '../notifications/notification-text.ts'
import type { ApiContext } from './api-context.ts'

const SHOWN_NOTIFICATIONS = 50

/** The person's notifications as readable sentences, newest first; the bell in the top bar reads them. */
export class NotificationApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async list(request: Request): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const notifications = await this.#context.repositories.notifications.listForRecipient(identity.userId, SHOWN_NOTIFICATIONS)
    const openableArtifacts = await this.#openableArtifacts(notifications, identity, request)
    const shownNotifications = notifications.filter(notification => openableArtifacts.has(notification.artifactId))
    const actorNames = await this.#context.people.namesOf(shownNotifications.map(notification => notification.actorId))
    const m = await this.#context.messages()
    return Response.json({
      notifications: shownNotifications.map(notification => this.#notificationJson(m, notification, openableArtifacts, actorNames)),
      unreadCount: shownNotifications.filter(notification => notification.readAt === null).length,
    })
  }

  async markRead(notificationId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const marked = await this.#context.repositories.notifications.markRead(identity.userId, notificationId)
    if (!marked) throw HttpError.notFound(`notification ${notificationId}`)
    return new Response(null, { status: 204 })
  }

  async markAllRead(): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    await this.#context.repositories.notifications.markAllRead(identity.userId)
    return new Response(null, { status: 204 })
  }

  // A notification about an artifact the person can no longer open is not shown, so its title does not leak.
  async #openableArtifacts(notifications: Notification[], identity: Identity, request: Request): Promise<Map<string, OpenedArtifact>> {
    const artifactIds = [...new Set(notifications.map(notification => notification.artifactId))]
    const openedArtifacts = await Promise.all(artifactIds.map(artifactId => this.#context.gate.open(artifactId, identity, request)))
    const viewableArtifacts = openedArtifacts.filter((openedArtifact): openedArtifact is OpenedArtifact => openedArtifact?.permissions.canView === true)
    return new Map(viewableArtifacts.map(openedArtifact => [openedArtifact.summary.artifactId, openedArtifact]))
  }

  #notificationJson(m: Messages, notification: Notification, openableArtifacts: Map<string, OpenedArtifact>, actorNames: Map<string, string>) {
    const actorName = actorNames.get(notification.actorId) ?? ''
    const artifactTitle = openableArtifacts.get(notification.artifactId)?.summary.title ?? ''
    const actorLabel = m.notification.actorLabel({ name: actorName, agentClient: notification.actorAgentClient })
    return {
      notificationId: notification.notificationId,
      kind: notification.kind,
      artifactId: notification.artifactId,
      commentId: notification.commentId,
      actor: { userId: notification.actorId, name: actorName, agentClient: notification.actorAgentClient },
      text: m.notification.sentences[notification.kind]({ actor: actorLabel, title: artifactTitle }),
      url: NotificationText.link(this.#context.viewerUrl(notification.artifactId), notification.commentId, notification.kind === 'access_requested' ? notification.actorId : null),
      createdAt: notification.createdAt,
      read: notification.readAt !== null,
    }
  }
}
