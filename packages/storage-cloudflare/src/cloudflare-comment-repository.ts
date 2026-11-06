import type { ArtifactComment, CommentAnchor, CommentRepository, NewComment } from '@open-artifact/core'

const COMMENT_COLUMNS = 'id, artifact_id, parent_id, author_id, body, for_agent, posted_via, anchor, resolved_at, resolved_by, created_at'
const JOINED_COMMENT_COLUMNS = COMMENT_COLUMNS.split(', ').map(column => `comments.${column}`).join(', ')

interface CommentRow {
  id: string
  artifact_id: string
  parent_id: string | null
  author_id: string
  body: string
  for_agent: number
  posted_via: string | null
  anchor: string | null
  resolved_at: number | null
  resolved_by: string | null
  created_at: number
}

export class CloudflareCommentRepository implements CommentRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async add(newComment: NewComment): Promise<ArtifactComment> {
    const commentRow = await this.#db
      .prepare(
        `INSERT INTO comments (id, artifact_id, parent_id, author_id, body, for_agent, posted_via, anchor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COMMENT_COLUMNS}`,
      )
      .bind(
        crypto.randomUUID(),
        newComment.artifactId,
        newComment.parentId,
        newComment.authorId,
        newComment.body,
        newComment.forAgent ? 1 : 0,
        newComment.postedVia,
        newComment.anchor === null ? null : JSON.stringify(newComment.anchor),
        Date.now(),
      )
      .first<CommentRow>()
    if (!commentRow) throw new Error(`Comment on artifact ${newComment.artifactId} was not saved`)
    return CloudflareCommentRepository.#commentOf(commentRow)
  }

  async find(commentId: string): Promise<ArtifactComment | null> {
    const commentRow = await this.#db.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = ?`).bind(commentId).first<CommentRow>()
    return commentRow ? CloudflareCommentRepository.#commentOf(commentRow) : null
  }

  async listForArtifact(artifactId: string): Promise<ArtifactComment[]> {
    const { results: commentRows } = await this.#db
      .prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE artifact_id = ? ORDER BY created_at, rowid`)
      .bind(artifactId)
      .all<CommentRow>()
    return commentRows.map(CloudflareCommentRepository.#commentOf)
  }

  async setResolved(commentId: string, resolvedBy: string | null): Promise<void> {
    const resolvedAt = resolvedBy === null ? null : Date.now()
    await this.#db.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').bind(resolvedAt, resolvedBy, commentId).run()
  }

  async listInOpenThreads(workspaceId: string): Promise<ArtifactComment[]> {
    const { results: commentRows } = await this.#db
      .prepare(
        `SELECT ${JOINED_COMMENT_COLUMNS}
         FROM comments
         JOIN artifacts ON artifacts.id = comments.artifact_id
         JOIN comments AS thread_root ON thread_root.id = COALESCE(comments.parent_id, comments.id)
         WHERE artifacts.workspace_id = ? AND thread_root.resolved_at IS NULL
         ORDER BY comments.created_at, comments.rowid`,
      )
      .bind(workspaceId)
      .all<CommentRow>()
    return commentRows.map(CloudflareCommentRepository.#commentOf)
  }

  static #commentOf(commentRow: CommentRow): ArtifactComment {
    return {
      commentId: commentRow.id,
      artifactId: commentRow.artifact_id,
      parentId: commentRow.parent_id,
      authorId: commentRow.author_id,
      body: commentRow.body,
      forAgent: commentRow.for_agent === 1,
      postedVia: commentRow.posted_via,
      anchor: commentRow.anchor === null ? null : CloudflareCommentRepository.#anchorOf(commentRow.anchor),
      resolvedAt: commentRow.resolved_at,
      resolvedBy: commentRow.resolved_by,
      createdAt: commentRow.created_at,
    }
  }

  // Anchors saved before the version and element were recorded hold only x and y.
  static #anchorOf(anchorJson: string): CommentAnchor {
    const storedAnchor = JSON.parse(anchorJson) as Partial<CommentAnchor> & Pick<CommentAnchor, 'x' | 'y'>
    return { x: storedAnchor.x, y: storedAnchor.y, version: storedAnchor.version ?? null, selector: storedAnchor.selector ?? null, textQuote: storedAnchor.textQuote ?? null }
  }
}
