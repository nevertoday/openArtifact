import type { ArtifactComment, CommentAnchor } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
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
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canReadComments', 'read the comments on this artifact')
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
    const parentId = requestBody.optionalText('parentId', 64)
    const parentComment = parentId === null ? null : await this.#context.repositories.comments.find(parentId)
    const parentOnOtherArtifact = parentId !== null && parentComment?.artifactId !== artifactId
    if (parentOnOtherArtifact) throw HttpError.badRequest('parentId must be a comment on this artifact')
    // Threads are one level deep: a reply to a reply joins the thread of the comment it answers.
    const threadRootId = parentComment?.parentId ?? parentId
    const addedComment = await this.#context.repositories.comments.add({
      artifactId,
      parentId: threadRootId,
      authorId: identity.userId,
      body: requestBody.text('body', MAX_COMMENT_LENGTH),
      forAgent: parentId === null && requestBody.boolean('forAgent', false),
      postedVia: identity.agentClient,
      anchor: parentId === null ? CommentApi.#anchorOf(requestBody) : null,
    })
    await this.#notify(identity, openedArtifact.summary.title, openedArtifact.summary.authorId, addedComment, parentComment)
    const names = await this.#context.people.namesOf([identity.userId])
    return Response.json({ comment: CommentApi.#commentJson(addedComment, names) }, { status: 201 })
  }

  async setResolved(request: Request, commentId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const comment = await this.#context.repositories.comments.find(commentId)
    if (!comment) throw HttpError.notFound(`comment ${commentId}`)
    await this.#context.gate.require(comment.artifactId, identity, request, 'canComment', 'resolve comments on this artifact')
    const requestBody = await JsonBody.of(request)
    const resolved = requestBody.boolean('resolved', true)
    await this.#context.repositories.comments.setResolved(commentId, resolved ? identity.userId : null)
    return Response.json({ commentId, resolved })
  }

  // The artifact's author hears about new comments, and a comment's author hears about replies to it.
  // The comment is already saved, so a mail failure is logged and never turns the request into an error.
  async #notify(commenter: Identity, artifactTitle: string, artifactAuthorId: string, addedComment: ArtifactComment, parentComment: ArtifactComment | null): Promise<void> {
    const recipientIds = new Set([artifactAuthorId, parentComment?.authorId].filter((userId): userId is string => Boolean(userId)))
    recipientIds.delete(commenter.userId)
    const recipients = await this.#context.repositories.users.profilesOf([...recipientIds])
    const commentKind = CommentApi.#commentKindOf(addedComment, parentComment)
    const viewerUrl = this.#context.viewerUrl(addedComment.artifactId)
    const deliveries = await Promise.allSettled(
      [...recipients.values()].map(recipient =>
        this.#context.mailer.send({
          to: recipient.email,
          subject: `${commenter.name} 在「${artifactTitle}」${commentKind}`,
          text: `${commenter.name}：\n\n${addedComment.body}\n\n打开查看：${viewerUrl}`,
        }),
      ),
    )
    for (const failedDelivery of deliveries.filter(delivery => delivery.status === 'rejected')) {
      console.error(new Error(`comment ${addedComment.commentId} notification could not be sent`, { cause: failedDelivery.reason }))
    }
  }

  // Only a top-level comment points at the page; x and y are fractions of the page's width and height.
  static #anchorOf(requestBody: JsonBody): CommentAnchor | null {
    const anchor = requestBody.raw('anchor')
    if (anchor === undefined || anchor === null) return null
    const { x, y } = (typeof anchor === 'object' ? anchor : {}) as Record<string, unknown>
    const isFraction = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1
    if (!isFraction(x) || !isFraction(y)) throw HttpError.badRequest('anchor must be { x, y } with both between 0 and 1')
    return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 }
  }

  static #commentKindOf(addedComment: ArtifactComment, parentComment: ArtifactComment | null): string {
    if (parentComment) return '回复了评论'
    if (addedComment.forAgent) return '留了一条给 agent 的评论'
    return '发表了评论'
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
