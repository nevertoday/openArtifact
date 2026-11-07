import { CommentThread, type ArtifactComment, type CommentAnchor, type CommentQuote } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import { NotificationText } from '../notifications/notification-text.ts'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_COMMENT_LENGTH = 5000
const MAX_ANCHOR_SELECTOR_LENGTH = 512
const MAX_ANCHOR_QUOTE_LENGTH = 120
const MAX_SELECTED_TEXT_LENGTH = 500
const MAX_SELECTION_CONTEXT_LENGTH = 64
const COMMENT_FILTERS = ['all', 'unresolved', 'for_agent'] as const
type CommentFilter = (typeof COMMENT_FILTERS)[number]

/** Comments on an artifact; a comment marked for the agent is what an agent picks up and answers. */
export class CommentApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async list(request: Request, artifactId: string): Promise<Response> {
    const identity = await this.#context.identity()
    const openedArtifact = await this.#context.gate.require(artifactId, identity, request, 'canReadComments', 'read the comments on this artifact')
    const filter = CommentApi.#filterOf(request)
    const allComments = await this.#context.repositories.comments.listForArtifact(artifactId)
    const shownComments = CommentApi.#threadsMatching(allComments, filter)
    const names = await this.#context.people.namesOf(shownComments.flatMap(comment => [comment.authorId, comment.resolvedBy]))
    const deletable = (comment: ArtifactComment) => identity !== null && CommentApi.#mayRemove(comment, identity.userId, openedArtifact)
    return Response.json({ comments: shownComments.map(comment => CommentApi.#commentJson(comment, names, deletable(comment))) })
  }

  /** The agent's inbox: open comments addressed to an agent on every artifact the caller may publish to. */
  async listWaitingForMyAgent(request: Request): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    CommentApi.#requireInboxQuery(request)
    const [visibleArtifacts, openThreadComments] = await Promise.all([
      this.#context.gate.listVisible(identity),
      this.#context.repositories.comments.listInOpenThreads(identity.membership.workspace.workspaceId),
    ])
    const editableArtifacts = new Map(visibleArtifacts.filter(openedArtifact => openedArtifact.permissions.canEdit).map(openedArtifact => [openedArtifact.summary.artifactId, openedArtifact]))
    const waitingThreads = CommentThread.allOf(openThreadComments).flatMap(thread => {
      const editableArtifact = editableArtifacts.get(thread.root.artifactId)
      return thread.root.forAgent && editableArtifact ? [{ thread, editableArtifact }] : []
    })
    const names = await this.#context.people.namesOf(waitingThreads.flatMap(({ thread }) => thread.comments.map(comment => comment.authorId)))
    return Response.json({ comments: waitingThreads.map(({ thread, editableArtifact }) => this.#inboxJson(thread, editableArtifact, names)) })
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
    if (resolvesThread && threadRoot) await this.#context.repositories.comments.setResolved(threadRoot.commentId, identity.userId)
    await this.#context.notifier.notify(identity, openedArtifact.summary, { kind: 'comment_added', comment: addedComment, resolvesThread })
    const names = await this.#context.people.namesOf([identity.userId])
    return Response.json({ comment: CommentApi.#commentJson(addedComment, names, true) }, { status: 201 })
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

  async remove(request: Request, commentId: string): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const comment = await this.#context.repositories.comments.find(commentId)
    if (!comment) throw HttpError.notFound(`comment ${commentId}`)
    const openedArtifact = await this.#context.gate.require(comment.artifactId, identity, request, 'canReadComments', 'delete comments on this artifact')
    if (!CommentApi.#mayRemove(comment, identity.userId, openedArtifact)) throw HttpError.forbidden('delete a comment someone else wrote')
    await this.#context.repositories.comments.remove(commentId)
    return new Response(null, { status: 204 })
  }

  // People take back their own words; whoever manages the artifact may also clear what others left on it.
  static #mayRemove(comment: ArtifactComment, userId: string, openedArtifact: OpenedArtifact): boolean {
    return comment.authorId === userId || openedArtifact.permissions.canManageSharing
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

  // Only a top-level comment points at the page. x and y are fractions of the page's width and height; the
  // element's CSS path and text let the pin find its spot again after the page changes, and the selected words
  // say which passage of the element the comment is about.
  static #anchorOf(requestBody: JsonBody, currentVersion: number): CommentAnchor | null {
    const anchor = requestBody.raw('anchor')
    if (anchor === undefined || anchor === null) return null
    const anchorFields = (typeof anchor === 'object' ? anchor : {}) as Record<string, unknown>
    const { x, y } = anchorFields
    const isFraction = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1
    if (!isFraction(x) || !isFraction(y)) throw HttpError.badRequest('anchor must be { x, y } with both between 0 and 1')
    return {
      x: Math.round(x * 10_000) / 10_000,
      y: Math.round(y * 10_000) / 10_000,
      version: CommentApi.#anchorVersionOf(anchorFields.version, currentVersion),
      selector: CommentApi.#anchorTextOf(anchorFields, 'selector', MAX_ANCHOR_SELECTOR_LENGTH),
      textQuote: CommentApi.#anchorTextOf(anchorFields, 'textQuote', MAX_ANCHOR_QUOTE_LENGTH),
      quote: CommentApi.#quoteOf(anchorFields.quote),
    }
  }

  static #quoteOf(quote: unknown): CommentQuote | null {
    if (quote === undefined || quote === null) return null
    const quoteFields = (typeof quote === 'object' ? quote : {}) as Record<string, unknown>
    const isText = (value: unknown, minLength: number, maxLength: number): value is string => typeof value === 'string' && value.length >= minLength && value.length <= maxLength
    const { exact, prefix = '', suffix = '' } = quoteFields
    const isValidQuote = isText(exact, 1, MAX_SELECTED_TEXT_LENGTH) && isText(prefix, 0, MAX_SELECTION_CONTEXT_LENGTH) && isText(suffix, 0, MAX_SELECTION_CONTEXT_LENGTH)
    if (!isValidQuote) throw HttpError.badRequest(`anchor.quote must be { exact, prefix, suffix }: the selected text, 1 to ${MAX_SELECTED_TEXT_LENGTH} characters, and up to ${MAX_SELECTION_CONTEXT_LENGTH} characters around it`)
    return { exact, prefix, suffix }
  }

  /** A pin placed without a version was placed on the current one. */
  static #anchorVersionOf(version: unknown, currentVersion: number): number {
    if (version === undefined || version === null) return currentVersion
    const isPublishedVersion = Number.isInteger(version) && (version as number) >= 1 && (version as number) <= currentVersion
    if (!isPublishedVersion) throw HttpError.badRequest(`anchor.version must be a published version, 1 to ${currentVersion}`)
    return version as number
  }

  static #anchorTextOf(anchorFields: Record<string, unknown>, field: 'selector' | 'textQuote', maxLength: number): string | null {
    const value = anchorFields[field]
    if (value === undefined || value === null || value === '') return null
    const isValidText = typeof value === 'string' && value.length <= maxLength
    if (!isValidText) throw HttpError.badRequest(`anchor.${field} must be text of at most ${maxLength} characters`)
    return value
  }

  // Only the caller's own open work is offered, so other values are refused rather than ignored.
  static #requireInboxQuery(request: Request): void {
    const searchParams = new URL(request.url).searchParams
    const asksForOwnOpenWork = searchParams.get('for') === 'me' && searchParams.get('status') === 'open'
    if (!asksForOwnOpenWork) throw HttpError.badRequest('ask for your agent\'s open comments with for=me&status=open')
  }

  #inboxJson(thread: CommentThread, openedArtifact: OpenedArtifact, names: Map<string, string>) {
    const { root, replies } = thread
    return {
      commentId: root.commentId,
      artifactId: root.artifactId,
      title: openedArtifact.summary.title,
      version: openedArtifact.summary.version,
      url: NotificationText.link(this.#context.artifactUrl(openedArtifact.summary), root.commentId),
      anchor: root.anchor,
      body: root.body,
      author: { userId: root.authorId, name: names.get(root.authorId) },
      createdAt: root.createdAt,
      replies: replies.map(reply => ({
        commentId: reply.commentId,
        author: { userId: reply.authorId, name: names.get(reply.authorId) },
        body: reply.body,
        postedVia: reply.postedVia,
        createdAt: reply.createdAt,
      })),
    }
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

  static #commentJson(comment: ArtifactComment, names: Map<string, string>, canDelete: boolean) {
    return {
      commentId: comment.commentId,
      parentId: comment.parentId,
      author: { userId: comment.authorId, name: names.get(comment.authorId) },
      body: comment.body,
      forAgent: comment.forAgent,
      postedVia: comment.postedVia,
      anchor: comment.anchor,
      resolved: comment.resolvedAt !== null,
      resolvedAt: comment.resolvedAt,
      resolvedBy: comment.resolvedBy === null ? null : { userId: comment.resolvedBy, name: names.get(comment.resolvedBy) },
      createdAt: comment.createdAt,
      canDelete,
    }
  }
}
