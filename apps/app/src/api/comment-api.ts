import type { ArtifactComment, CommentAnchor } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_COMMENT_LENGTH = 5000
const COMMENT_FILTERS = ['all', 'unresolved', 'for_agent'] as const
type CommentFilter = (typeof COMMENT_FILTERS)[number]

/** Comments on an artifact; a comment marked for the agent is what an agent picks up and answers. */
export class CommentApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async list(request: Request, artifactId: string): Promise<Response> {
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canView', 'view this artifact')
    const filter = CommentApi.#filterOf(request)
    const allComments = await this.#context.repositories.comments.listForArtifact(artifactId)
    const shownComments = CommentApi.#threadsMatching(allComments, filter)
    const names = await this.#context.people.namesOf(shownComments.flatMap(comment => [comment.authorId, comment.resolvedBy]))
    return Response.json({ comments: shownComments.map(comment => CommentApi.#commentJson(comment, names)) })
  }

  async add(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canComment', 'comment on this artifact')
    const requestBody = await JsonBody.of(request)
    const threadRoot = await this.#threadRootOf(requestBody.optionalText('parentId', 64), artifactId)
    const resolveRequested = requestBody.boolean('resolve', false)
    if (resolveRequested && threadRoot === null) throw HttpError.badRequest('resolve applies to a reply; pass parentId, or resolve with PATCH /api/comments/{commentId}')
    const addedComment = await this.#context.repositories.comments.add({
      artifactId,
      parentId: threadRoot?.commentId ?? null,
      authorId: identity.userId,
      body: requestBody.text('body', MAX_COMMENT_LENGTH),
      forAgent: threadRoot === null && requestBody.boolean('forAgent', false),
      postedVia: identity.agentClient,
      anchor: threadRoot === null ? CommentApi.#anchorOf(requestBody, openedArtifact.summary.version) : null,
    })
    const resolvesThread = resolveRequested && threadRoot?.resolvedAt === null
    if (resolvesThread) await this.#context.repositories.comments.setResolved(addedComment.parentId as string, identity.userId)
    await this.#context.notifier.notify(identity, openedArtifact.summary, { kind: 'comment_added', comment: addedComment, resolvesThread })
    const names = await this.#context.people.namesOf([identity.userId])
    return Response.json({ comment: CommentApi.#commentJson(addedComment, names) }, { status: 201 })
  }

  async setResolved(request: Request, commentId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const comment = await this.#context.repositories.comments.find(commentId)
    if (!comment) throw HttpError.notFound(`comment ${commentId}`)
    const openedArtifact = await this.#context.gate.require(comment.artifactId, identity, request, 'canComment', 'resolve comments on this artifact')
    const requestBody = await JsonBody.of(request)
    const resolved = requestBody.boolean('resolved', true)
    await this.#context.repositories.comments.setResolved(commentId, resolved ? identity.userId : null)
    const resolvesOpenThread = resolved && comment.parentId === null && comment.resolvedAt === null
    if (resolvesOpenThread) await this.#context.notifier.notify(identity, openedArtifact.summary, { kind: 'thread_resolved', threadRoot: comment })
    return Response.json({ commentId, resolved })
  }

  // Threads are one level deep: a reply to a reply joins the thread of the comment it answers.
  async #threadRootOf(parentId: string | null, artifactId: string): Promise<ArtifactComment | null> {
    if (parentId === null) return null
    const parentComment = await this.#context.repositories.comments.find(parentId)
    if (parentComment?.artifactId !== artifactId) throw HttpError.badRequest('parentId must be a comment on this artifact')
    if (parentComment.parentId === null) return parentComment
    const threadRoot = await this.#context.repositories.comments.find(parentComment.parentId)
    if (!threadRoot) throw new Error(`comment ${parentId} belongs to the missing thread ${parentComment.parentId}`)
    return threadRoot
  }

  // Only a top-level comment points at the page; x and y are fractions of the page's width and height.
  static #anchorOf(requestBody: JsonBody, currentVersion: number): CommentAnchor | null {
    const anchor = requestBody.raw('anchor')
    if (anchor === undefined || anchor === null) return null
    const { x, y } = (typeof anchor === 'object' ? anchor : {}) as Record<string, unknown>
    const isFraction = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1
    if (!isFraction(x) || !isFraction(y)) throw HttpError.badRequest('anchor must be { x, y } with both between 0 and 1')
    return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000, version: currentVersion, selector: null, textQuote: null }
  }

  static #filterOf(request: Request): CommentFilter {
    const requestedFilter = new URL(request.url).searchParams.get('filter') ?? 'all'
    const filter = COMMENT_FILTERS.find(candidate => candidate === requestedFilter)
    if (!filter) throw HttpError.badRequest(`filter must be one of ${COMMENT_FILTERS.join(', ')}`)
    return filter
  }

  // Filters pick top-level comments; their replies come along so each thread stays whole.
  static #threadsMatching(allComments: ArtifactComment[], filter: CommentFilter): ArtifactComment[] {
    const matchesFilter = (comment: ArtifactComment) => {
      switch (filter) {
        case 'all':
          return true
        case 'unresolved':
          return comment.resolvedAt === null
        case 'for_agent':
          return comment.forAgent && comment.resolvedAt === null
      }
    }
    const shownThreadIds = new Set(allComments.filter(comment => comment.parentId === null && matchesFilter(comment)).map(comment => comment.commentId))
    return allComments.filter(comment => shownThreadIds.has(comment.parentId ?? comment.commentId))
  }

  static #commentJson(comment: ArtifactComment, names: Map<string, string>) {
    return {
      commentId: comment.commentId,
      parentId: comment.parentId,
      author: { userId: comment.authorId, name: names.get(comment.authorId) },
      body: comment.body,
      forAgent: comment.forAgent,
      postedVia: comment.postedVia,
      anchor: comment.anchor,
      resolved: comment.resolvedAt !== null,
      resolvedBy: comment.resolvedBy === null ? null : { userId: comment.resolvedBy, name: names.get(comment.resolvedBy) },
      createdAt: comment.createdAt,
    }
  }
}
