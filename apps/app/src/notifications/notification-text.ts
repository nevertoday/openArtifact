import type { NotificationKind } from '@open-artifact/core'

/** How a notification reads, in the app and in mail; the one place that words them. */
export class NotificationText {
  /**
   * An agent acting for a person is named first, so nobody mistakes its words for the person's own.
   * The label ends where the verb starts: a plain name with a space, the closing bracket without one.
   */
  static actorLabel(actorName: string, agentClient: string | null): string {
    return agentClient === null ? `${actorName} ` : `${agentClient}（代 ${actorName}）`
  }

  static sentence(kind: NotificationKind, actorLabel: string, artifactTitle: string): string {
    switch (kind) {
      case 'comment_on_my_artifact':
        return `${actorLabel}评论了你的「${artifactTitle}」`
      case 'reply_to_my_comment':
        return `${actorLabel}回复了你在「${artifactTitle}」的评论`
      case 'my_comment_resolved':
        return `${actorLabel}解决了你在「${artifactTitle}」的评论`
      case 'new_version':
        return `${actorLabel}发布了「${artifactTitle}」的新版本`
      case 'shared_with_me':
        return `${actorLabel}把「${artifactTitle}」分享给了你`
      case 'public_link_opened':
        return `${actorLabel}把「${artifactTitle}」设为公开链接`
      case 'access_requested':
        return `${actorLabel}想查看「${artifactTitle}」，请你分享给 TA`
    }
  }

  /** Where a notification leads: the comment's thread in the viewer, or the artifact itself. */
  static link(viewerUrl: string, commentId: string | null): string {
    return commentId === null ? viewerUrl : `${viewerUrl}#comment-${encodeURIComponent(commentId)}`
  }
}
