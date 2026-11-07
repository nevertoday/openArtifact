import { api } from '../common.js'

// A thread resolved a moment ago stays where it was for a while, so it does not vanish under the pointer.
const LINGER_MS = 6000
const EXCERPT_LENGTH = 60
export const COMMENT_FILTERS = ['open', 'agent', 'all']

/** A comment on the page and its replies, numbered in the order the threads were started. */
export class Thread {
  constructor(root, replies, number, lingering) {
    this.root = root
    this.replies = replies
    this.number = number
    this.lingering = lingering
  }

  get id() {
    return this.root.commentId
  }

  get isOpen() {
    return !this.root.resolved
  }

  get forAgent() {
    return this.root.forAgent
  }

  get anchor() {
    return this.root.anchor
  }

  /** How its pin looks: a number, a number in the agent's colour, or a check. */
  get pinState() {
    if (!this.isOpen) return 'resolved'
    return this.forAgent ? 'agent' : 'open'
  }

  /** What the comment points at, as the reader saw it: the selected words in quotes, or the start of the element. */
  get excerpt() {
    const anchor = this.root.anchor
    if (anchor?.quote) return `「${Thread.#clip(anchor.quote.exact)}」`
    return anchor?.textQuote ? Thread.#clip(anchor.textQuote) : ''
  }

  static #clip(text) {
    return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
  }

  /** The newest reply an agent wrote, or null. */
  get agentReply() {
    return this.replies.findLast(reply => reply.postedVia !== null) ?? null
  }

  isWrittenBy(userId) {
    return this.root.author.userId === userId
  }

  /** Whether the filter counts this thread: 待处理 and 给 agent count open threads, 全部 counts every thread. */
  isCountedIn(filter) {
    switch (filter) {
      case 'open':
        return this.isOpen
      case 'agent':
        return this.forAgent && this.isOpen
      case 'all':
        return true
      default:
        throw new Error(`unknown comment filter ${filter}`)
    }
  }

  /** Whether the filter lists this thread: what it counts, and a thread resolved a moment ago, kept in place. */
  matches(filter) {
    return this.isCountedIn(filter) || (this.lingering && filter !== 'all')
  }
}

/**
 * The comments of the artifact as the server has them, grouped into threads, and every change to them: posting,
 * replying, resolving and the live refresh. Announces each change with a "change" event.
 */
export class CommentThreads extends EventTarget {
  #comments = []
  #lingering = new Set()
  #writes = 0
  #commentsPath
  #viewer

  /** `viewer` is { userId, name }, or null for a visitor who may only read. */
  constructor(artifactId, viewer) {
    super()
    this.#commentsPath = `/api/artifacts/${encodeURIComponent(artifactId)}/comments`
    this.#viewer = viewer
  }

  async load() {
    const { comments } = await api(`${this.#commentsPath}?filter=all`)
    this.#comments = comments
    this.#changed()
  }

  get all() {
    const repliesByThread = Map.groupBy(this.#comments.filter(comment => comment.parentId !== null), comment => comment.parentId)
    const roots = this.#comments.filter(comment => comment.parentId === null)
    return roots.map((root, index) => new Thread(root, repliesByThread.get(root.commentId) ?? [], index + 1, this.#lingering.has(root.commentId)))
  }

  thread(threadId) {
    return this.all.find(thread => thread.id === threadId) ?? null
  }

  /** The thread a comment belongs to: itself for a thread's first comment, its thread for a reply. */
  threadOf(commentId) {
    const comment = this.#comments.find(candidate => candidate.commentId === commentId)
    return comment ? this.thread(comment.parentId ?? comment.commentId) : null
  }

  count(filter) {
    return this.all.filter(thread => thread.isCountedIn(filter)).length
  }

  get openCount() {
    return this.all.filter(thread => thread.isOpen).length
  }

  /** The reader has asked an agent for a change that has not come back yet. */
  get isWaitingForAgent() {
    return this.all.some(thread => thread.forAgent && thread.isOpen && thread.isWrittenBy(this.#viewer?.userId))
  }

  async post({ body, forAgent, anchor }) {
    this.#writes++
    const { comment } = await api(this.#commentsPath, { method: 'POST', body: { body, forAgent, anchor } })
    this.#comments.push(comment)
    this.#changed()
    return this.thread(comment.commentId)
  }

  async reply(threadId, body) {
    this.#writes++
    const { comment } = await api(this.#commentsPath, { method: 'POST', body: { body, parentId: threadId } })
    this.#comments.push(comment)
    this.#changed()
  }

  async setResolved(threadId, resolved) {
    this.#writes++
    await api(`/api/comments/${encodeURIComponent(threadId)}`, { method: 'PATCH', body: { resolved } })
    const root = this.#comments.find(comment => comment.commentId === threadId)
    Object.assign(root, { resolved, resolvedAt: resolved ? Date.now() : null, resolvedBy: resolved ? this.#viewer : null })
    if (resolved) this.#linger(threadId)
    this.#changed()
  }

  /**
   * Fetches the comments again. Resolves to what others wrote since the last look, and the reader's own comments
   * to an agent that an agent has just answered and resolved; null when the fetch failed, keeping what is shown.
   * A fetch that a write of this page overlapped may predate that write, so it is dropped; the next one catches up.
   */
  async refresh() {
    const writesBefore = this.#writes
    const fetched = await api(`${this.#commentsPath}?filter=all`).catch(() => null)
    if (!fetched || this.#writes !== writesBefore) return null
    const knownIds = new Set(this.#comments.map(comment => comment.commentId))
    const openBefore = new Set(this.all.filter(thread => thread.isOpen).map(thread => thread.id))
    const arrived = fetched.comments.filter(comment => !knownIds.has(comment.commentId) && comment.author.userId !== this.#viewer?.userId)
    const changed = CommentThreads.#revisionOf(fetched.comments) !== CommentThreads.#revisionOf(this.#comments)
    this.#comments = fetched.comments
    const fixedForMe = this.all.filter(thread => openBefore.has(thread.id) && !thread.isOpen && this.#isAgentFixOfMine(thread, knownIds))
    for (const thread of fixedForMe) this.#linger(thread.id)
    if (changed) this.#changed()
    return { arrived, fixedForMe }
  }

  #isAgentFixOfMine(thread, knownIds) {
    const answeredByAgentJustNow = thread.agentReply !== null && !knownIds.has(thread.agentReply.commentId)
    return thread.forAgent && thread.isWrittenBy(this.#viewer?.userId) && answeredByAgentJustNow
  }

  // Which comments exist and which threads are resolved: all a refresh can change.
  static #revisionOf(comments) {
    return comments.map(comment => `${comment.commentId}:${comment.resolved}`).join(',')
  }

  #linger(threadId) {
    this.#lingering.add(threadId)
    setTimeout(() => {
      this.#lingering.delete(threadId)
      this.#changed()
    }, LINGER_MS)
  }

  #changed() {
    this.dispatchEvent(new Event('change'))
  }
}
