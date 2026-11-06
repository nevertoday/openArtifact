import { CommentThread, type ArtifactComment, type ArtifactSummary, type NewNotification, type NotificationKind, type Repositories } from '@open-artifact/core'
import type { Mailer } from '../auth/mailer.ts'
import type { Identity } from '../auth/request-identity.ts'
import { NotificationText } from './notification-text.ts'

/** What happened on an artifact. The notifier decides who hears about it, and through which channel. */
export type ArtifactEvent =
  | { kind: 'comment_added'; comment: ArtifactComment; resolvesThread: boolean }
  | { kind: 'thread_resolved'; threadRoot: ArtifactComment }
  | { kind: 'version_published' }
  | { kind: 'artifact_shared'; sharedWithId: string }

export type Actor = Pick<Identity, 'userId' | 'name' | 'agentClient'>

/**
 * Tells people what happened on artifacts they care about: always in the app, and by mail for comments.
 * The change it reports is already saved, so a failure here is logged and never fails the request.
 */
export class Notifier {
  readonly #repositories: Repositories
  readonly #mailer: Mailer
  readonly #viewerUrl: (artifactId: string) => string

  constructor(repositories: Repositories, mailer: Mailer, viewerUrl: (artifactId: string) => string) {
    this.#repositories = repositories
    this.#mailer = mailer
    this.#viewerUrl = viewerUrl
  }

  async notify(actor: Actor, artifact: ArtifactSummary, event: ArtifactEvent): Promise<void> {
    try {
      const kindByRecipient = await this.#kindByRecipient(artifact, event)
      kindByRecipient.delete(actor.userId)
      const commentId = Notifier.#commentIdOf(event)
      const newNotifications: NewNotification[] = [...kindByRecipient].map(([recipientId, kind]) => ({
        recipientId,
        kind,
        artifactId: artifact.artifactId,
        commentId,
        actorId: actor.userId,
        actorAgentClient: actor.agentClient,
      }))
      await Promise.all([this.#repositories.notifications.addAll(newNotifications), this.#mail(actor, artifact, event, newNotifications)])
    } catch (error) {
      console.error(new Error(`notifications about ${event.kind} on artifact ${artifact.artifactId} could not be saved`, { cause: error }))
    }
  }

  async #kindByRecipient(artifact: ArtifactSummary, event: ArtifactEvent): Promise<Map<string, NotificationKind>> {
    switch (event.kind) {
      case 'comment_added':
        return this.#commentRecipients(artifact, event.comment, event.resolvesThread)
      case 'thread_resolved':
        return new Map([[event.threadRoot.authorId, 'my_comment_resolved']])
      case 'version_published':
        return this.#openThreadParticipants(artifact.artifactId)
      case 'artifact_shared':
        return new Map([[event.sharedWithId, 'shared_with_me']])
    }
  }

  // A more specific kind replaces a general one, so each person hears about one comment once.
  async #commentRecipients(artifact: ArtifactSummary, comment: ArtifactComment, resolvesThread: boolean): Promise<Map<string, NotificationKind>> {
    const kindByRecipient = new Map<string, NotificationKind>([[artifact.authorId, 'comment_on_my_artifact']])
    if (comment.parentId === null) return kindByRecipient
    const thread = await this.#threadOf(comment)
    for (const participantId of thread.participantIds) kindByRecipient.set(participantId, 'reply_to_my_comment')
    if (resolvesThread) kindByRecipient.set(thread.root.authorId, 'my_comment_resolved')
    return kindByRecipient
  }

  async #threadOf(reply: ArtifactComment): Promise<CommentThread> {
    const artifactComments = await this.#repositories.comments.listForArtifact(reply.artifactId)
    const thread = CommentThread.allOf(artifactComments).find(candidate => candidate.root.commentId === reply.parentId)
    if (!thread) throw new Error(`reply ${reply.commentId} has no thread on artifact ${reply.artifactId}`)
    return thread
  }

  async #openThreadParticipants(artifactId: string): Promise<Map<string, NotificationKind>> {
    const artifactComments = await this.#repositories.comments.listForArtifact(artifactId)
    const openThreads = CommentThread.allOf(artifactComments).filter(thread => thread.isOpen)
    const participantIds = openThreads.flatMap(thread => [...thread.participantIds])
    return new Map(participantIds.map(participantId => [participantId, 'new_version']))
  }

  async #mail(actor: Actor, artifact: ArtifactSummary, event: ArtifactEvent, newNotifications: NewNotification[]): Promise<void> {
    const quotedComment = Notifier.#quotedCommentOf(event)
    if (quotedComment === null) return
    const recipients = await this.#repositories.users.profilesOf(newNotifications.map(newNotification => newNotification.recipientId))
    const actorLabel = NotificationText.actorLabel(actor.name, actor.agentClient)
    const link = NotificationText.link(this.#viewerUrl(artifact.artifactId), quotedComment.commentId)
    const mails = newNotifications.flatMap(newNotification => {
      const recipient = recipients.get(newNotification.recipientId)
      const action = Notifier.#mailAction(newNotification.kind, quotedComment)
      if (!recipient || action === null) return []
      const subject = `${actorLabel}在「${artifact.title}」${action}`
      return [{ to: recipient.email, subject, text: `${subject}\n\n${quotedComment.body}\n\n打开查看：${link}` }]
    })
    const deliveries = await Promise.allSettled(mails.map(mail => this.#mailer.send(mail)))
    for (const failedDelivery of deliveries.filter(delivery => delivery.status === 'rejected')) {
      console.error(new Error(`mail about comment ${quotedComment.commentId} could not be sent`, { cause: failedDelivery.reason }))
    }
  }

  /** Null for kinds that stay in the app. */
  static #mailAction(kind: NotificationKind, quotedComment: ArtifactComment): string | null {
    switch (kind) {
      case 'comment_on_my_artifact':
        return Notifier.#commentAction(quotedComment)
      case 'reply_to_my_comment':
        return '回复了评论'
      case 'my_comment_resolved':
        return '解决了你的评论'
      case 'new_version':
      case 'shared_with_me':
        return null
    }
  }

  static #commentAction(comment: ArtifactComment): string {
    if (comment.parentId !== null) return '回复了评论'
    if (comment.forAgent) return '留了一条给 agent 的评论'
    return '发表了评论'
  }

  /** Mail quotes the comment it is about: the one just written, or the one just resolved. */
  static #quotedCommentOf(event: ArtifactEvent): ArtifactComment | null {
    switch (event.kind) {
      case 'comment_added':
        return event.comment
      case 'thread_resolved':
        return event.threadRoot
      case 'version_published':
      case 'artifact_shared':
        return null
    }
  }

  static #commentIdOf(event: ArtifactEvent): string | null {
    return Notifier.#quotedCommentOf(event)?.commentId ?? null
  }
}
