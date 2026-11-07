/** The one place a notification's link is built, for the app and for mail; its words are in the `notification` and `mail` messages. */
export class NotificationLink {
  /**
   * Where a notification leads: the comment's thread in the viewer; for a request for access, the share dialog with
   * the person who asked already filled in; otherwise the artifact itself.
   */
  static to(viewerUrl: string, commentId: string | null, accessRequesterId: string | null = null): string {
    if (commentId !== null) return `${viewerUrl}#comment-${encodeURIComponent(commentId)}`
    if (accessRequesterId !== null) return `${viewerUrl}#share=${encodeURIComponent(accessRequesterId)}`
    return viewerUrl
  }
}
