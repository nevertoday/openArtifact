import { CommentThread, type AddressedArtifact, type ArtifactComment, type ArtifactSummary, type GrantRole, type NewNotification, type NotificationKind, type Repositories } from '@open-artifact/core'
import { dateText } from '../../public/static/time-text.js'
import type { Mailer } from '../auth/mailer.ts'
import type { Identity } from '../auth/request-identity.ts'
import { NotificationText } from './notification-text.ts'

/** What happened on an artifact. The notifier decides who hears about it, and through which channel. */
export type ArtifactEvent =
  | { kind: 'comment_added'; comment: ArtifactComment; resolvesThread: boolean }
  | { kind: 'thread_resolved'; threadRoot: ArtifactComment }
  | { kind: 'version_published' }
  | { kind: 'artifact_shared'; sharedWithId: string; role: GrantRole }
  | { kind: 'public_link_opened_by_agent'; expiresAt: number }
  | { kind: 'access_requested'; requesterEmail: string }

/** What the notifier needs to know about the artifact an event happened on. */
export type NotifiedArtifact = Pick<ArtifactSummary, 'artifactId' | 'shortId' | 'slug' | 'title' | 'authorId'>

export type Actor = Pick<Identity, 'userId' | 'name' | 'agentClient'>

const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_NOTIFICATIONS_CHECKED = 50
const ROLE_LABELS: Record<GrantRole, string> = { viewer: '可查看', commenter: '可评论', editor: '可编辑' }

/**
 * Tells people what happened on artifacts they care about: always in the app, and by mail for comments.
 * The change it reports is already saved, so a failure here is logged and never fails the request.
 */
export class Notifier {
  readonly #repositories: Repositories
  readonly #mailer: Mailer
  readonly #artifactUrl: (artifact: AddressedArtifact) => string

  constructor(repositories: Repositories, mailer: Mailer, artifactUrl: (artifact: AddressedArtifact) => string) {
    this.#repositories = repositories
    this.#mailer = mailer
    this.#artifactUrl = artifactUrl
  }

  async notify(actor: Actor, artifact: NotifiedArtifact, event: ArtifactEvent): Promise<void> {
    try {
      const kindByRecipient = await this.#kindByRecipient(artifact, event, actor)
      // An agent acts as its person, so news about what that agent did must still reach the person.
      const tellsPersonAboutTheirAgent = event.kind === 'public_link_opened_by_agent'
      if (!tellsPersonAboutTheirAgent) kindByRecipient.delete(actor.userId)
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

  async #kindByRecipient(artifact: NotifiedArtifact, event: ArtifactEvent, actor: Actor): Promise<Map<string, NotificationKind>> {
    switch (event.kind) {
      case 'comment_added':
        return this.#commentRecipients(artifact, event.comment, event.resolvesThread)
      case 'thread_resolved':
        return new Map([[event.threadRoot.authorId, 'my_comment_resolved']])
      case 'version_published':
        return this.#openThreadParticipants(artifact.artifactId)
      case 'artifact_shared':
        return new Map([[event.sharedWithId, 'shared_with_me']])
      case 'public_link_opened_by_agent':
        return new Map([[artifact.authorId, 'public_link_opened']])
      case 'access_requested':
        return (await this.#alreadyAsked(artifact, actor)) ? new Map() : new Map([[artifact.authorId, 'access_requested']])
    }
  }

  // Asking again before the author has read the first request would only repeat it.
  async #alreadyAsked(artifact: NotifiedArtifact, requester: Actor): Promise<boolean> {
    const authorNotifications = await this.#repositories.notifications.listForRecipient(artifact.authorId, RECENT_NOTIFICATIONS_CHECKED)
    return authorNotifications.some(notification => notification.kind === 'access_requested' && notification.artifactId === artifact.artifactId && notification.actorId === requester.userId && notification.readAt === null)
  }

  // A more specific kind replaces a general one, so each person hears about one comment once.
  async #commentRecipients(artifact: NotifiedArtifact, comment: ArtifactComment, resolvesThread: boolean): Promise<Map<string, NotificationKind>> {
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

  async #mail(actor: Actor, artifact: NotifiedArtifact, event: ArtifactEvent, newNotifications: NewNotification[]): Promise<void> {
    const recipients = await this.#repositories.users.profilesOf(newNotifications.map(newNotification => newNotification.recipientId))
    const actorLabel = NotificationText.actorLabel(actor.name, actor.agentClient)
    const link = NotificationText.link(this.#artifactUrl(artifact), Notifier.#commentIdOf(event), event.kind === 'access_requested' ? actor.userId : null)
    const mails = newNotifications.flatMap(newNotification => {
      const recipient = recipients.get(newNotification.recipientId)
      const mailContent = Notifier.#mailContentOf(newNotification.kind, event, actorLabel, artifact.title)
      if (!recipient || mailContent === null) return []
      return [{ to: recipient.email, subject: mailContent.subject, text: `${mailContent.body}\n\n打开查看：${link}` }]
    })
    const deliveries = await Promise.allSettled(mails.map(mail => this.#mailer.send(mail)))
    for (const failedDelivery of deliveries.filter(delivery => delivery.status === 'rejected')) {
      console.error(new Error(`mail about ${event.kind} on artifact ${artifact.artifactId} could not be sent`, { cause: failedDelivery.reason }))
    }
  }

  /** Null for kinds that stay in the app. */
  static #mailContentOf(kind: NotificationKind, event: ArtifactEvent, actorLabel: string, artifactTitle: string): { subject: string; body: string } | null {
    switch (kind) {
      case 'comment_on_my_artifact':
      case 'reply_to_my_comment':
      case 'my_comment_resolved':
        return Notifier.#commentMailOf(kind, event, actorLabel, artifactTitle)
      case 'new_version':
        return null
      case 'shared_with_me': {
        if (event.kind !== 'artifact_shared') return null
        const subject = NotificationText.sentence(kind, actorLabel, artifactTitle)
        return { subject, body: `${subject}，你的权限是「${ROLE_LABELS[event.role]}」。` }
      }
      case 'public_link_opened': {
        if (event.kind !== 'public_link_opened_by_agent') return null
        const daysLeft = Math.round((event.expiresAt - Date.now()) / DAY_MS)
        const expiryDate = dateText(event.expiresAt)
        const subject = `${NotificationText.sentence(kind, actorLabel, artifactTitle)}，${daysLeft} 天后过期`
        return { subject, body: `${subject}（${expiryDate}）。拿到链接的人不用登录就能打开。要改有效期或取消公开，打开页面后点「分享」。` }
      }
      case 'access_requested': {
        if (event.kind !== 'access_requested') return null
        const subject = NotificationText.sentence(kind, actorLabel, artifactTitle)
        return { subject, body: `${subject}。TA 的邮箱是 ${event.requesterEmail}。打开页面后点「分享」，把这个邮箱加进来。` }
      }
    }
  }

  // Mail about a comment quotes it: the one just written, or the one just resolved.
  static #commentMailOf(kind: NotificationKind, event: ArtifactEvent, actorLabel: string, artifactTitle: string): { subject: string; body: string } | null {
    const quotedComment = Notifier.#quotedCommentOf(event)
    if (quotedComment === null) return null
    const action = kind === 'comment_on_my_artifact' ? Notifier.#commentAction(quotedComment) : kind === 'reply_to_my_comment' ? '回复了评论' : '解决了你的评论'
    const subject = `${actorLabel}在「${artifactTitle}」${action}`
    return { subject, body: `${subject}\n\n${quotedComment.body}` }
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
      case 'public_link_opened_by_agent':
      case 'access_requested':
        return null
    }
  }

  static #commentIdOf(event: ArtifactEvent): string | null {
    return Notifier.#quotedCommentOf(event)?.commentId ?? null
  }
}
