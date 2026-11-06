/** A spot on the page, as fractions of its width and height. */
export interface CommentAnchor {
  x: number
  y: number
}

export interface ArtifactComment {
  commentId: string
  artifactId: string
  parentId: string | null
  authorId: string
  body: string
  /** The author asked an agent to act on this comment rather than a person. */
  forAgent: boolean
  postedVia: string | null
  anchor: CommentAnchor | null
  resolvedAt: number | null
  resolvedBy: string | null
  createdAt: number
}

export interface NewComment {
  artifactId: string
  parentId: string | null
  authorId: string
  body: string
  forAgent: boolean
  postedVia: string | null
  anchor: CommentAnchor | null
}

export interface CommentRepository {
  add(newComment: NewComment): Promise<ArtifactComment>
  find(commentId: string): Promise<ArtifactComment | null>
  listForArtifact(artifactId: string): Promise<ArtifactComment[]>
  /** `resolvedBy` null reopens the comment. */
  setResolved(commentId: string, resolvedBy: string | null): Promise<void>
  countWaitingForAgent(workspaceId: string): Promise<Map<string, number>>
}
