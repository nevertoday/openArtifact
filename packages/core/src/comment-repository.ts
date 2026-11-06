/**
 * A spot on the page, as fractions of its width and height, and what was there when the person clicked.
 * Comments saved before the element and version were recorded hold null in those fields.
 */
export interface CommentAnchor {
  x: number
  y: number
  /** The version the person was looking at. */
  version: number | null
  /** A short CSS path to the clicked element, used to find it again after the page changes. */
  selector: string | null
  /** The start of the clicked element's text. */
  textQuote: string | null
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
  /** Every comment of the workspace's unresolved threads, oldest first. */
  listInOpenThreads(workspaceId: string): Promise<ArtifactComment[]>
}
