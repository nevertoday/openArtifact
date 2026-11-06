import type { ArtifactComment } from './comment-repository.ts'

/** A top-level comment and its replies. Resolving the top-level comment resolves the thread. */
export class CommentThread {
  readonly root: ArtifactComment
  readonly replies: ArtifactComment[]

  private constructor(root: ArtifactComment, replies: ArtifactComment[]) {
    this.root = root
    this.replies = replies
  }

  /** Groups comments into threads, in the order the threads were started; replies whose thread is missing are left out. */
  static allOf(comments: ArtifactComment[]): CommentThread[] {
    const repliesByRoot = new Map<string, ArtifactComment[]>()
    for (const comment of comments) {
      const rootId = comment.parentId
      if (rootId !== null) repliesByRoot.set(rootId, [...(repliesByRoot.get(rootId) ?? []), comment])
    }
    const roots = comments.filter(comment => comment.parentId === null)
    return roots.map(root => new CommentThread(root, repliesByRoot.get(root.commentId) ?? []))
  }

  get isOpen(): boolean {
    return this.root.resolvedAt === null
  }

  get comments(): ArtifactComment[] {
    return [this.root, ...this.replies]
  }

  /** Everyone who wrote in the thread. */
  get participantIds(): Set<string> {
    return new Set(this.comments.map(comment => comment.authorId))
  }

  /**
   * Someone waits for this person when the thread is open, someone else wrote last, and either the thread asks
   * them, as the artifact's author, for something a person must do, or they took part in it.
   */
  isWaitingFor(userId: string, artifactAuthorId: string): boolean {
    const lastComment = this.replies.at(-1) ?? this.root
    const someoneElseWroteLast = lastComment.authorId !== userId
    const asksTheAuthor = artifactAuthorId === userId && !this.root.forAgent
    return this.isOpen && someoneElseWroteLast && (asksTheAuthor || this.participantIds.has(userId))
  }

  /** An open thread addressed to an agent waits for the agents of the artifact's author. */
  isWaitingForAgentOf(userId: string, artifactAuthorId: string): boolean {
    return this.isOpen && this.root.forAgent && artifactAuthorId === userId
  }
}
