import { element, icon, initialOf, submitOnce, timeElement, userMessageOf } from '../common.js'
import { MODIFIER_KEY } from './comment-mode.js'
import { COMMENT_FILTERS } from './comment-threads.js'

const FILTER_LABELS = { open: '待处理', agent: '给 agent', all: '全部' }
const COMMENT_LINK_PREFIX = '#comment-'
const THREAD_CONTROLS = ['.comment-pin', '.comment-thread__resolve', '.comment-thread__reply-toggle']
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)')

/**
 * The comments view of the drawer: the threads under a filter, one of them active, each with its replies, a reply
 * box and a way to resolve it. Selecting a thread announces "select", so the page can bring its pin into view;
 * any change to which thread is active announces "change".
 */
export class CommentList extends EventTarget {
  #element
  #threads
  #drawer
  #stage
  #canComment
  #byTouch
  #filter = 'open'
  #activeId = null
  #replyingTo = null
  #replyDrafts = new Map()
  #arrivedIds = new Set()
  #freshId = null
  #orphanedIds = new Set()
  #renderWhenIdle = false

  constructor({ element: listElement, threads, drawer, stage, canComment, byTouch }) {
    super()
    this.#element = listElement
    this.#threads = threads
    this.#drawer = drawer
    this.#stage = stage
    this.#canComment = canComment
    this.#byTouch = byTouch
    threads.addEventListener('change', () => this.render())
    listElement.addEventListener('focusout', () => setTimeout(() => this.#renderIfWaiting()))
    this.#renderFoot()
  }

  get activeId() {
    return this.#activeId
  }

  /** A reply box has focus: Esc there closes that box alone. */
  get isReplyFocused() {
    return this.#replyingTo !== null && Boolean(document.activeElement?.closest('[data-reply-form]'))
  }

  /** Makes a thread the active one, shows it in the drawer and, with `reveal`, brings its pin into view on the page. */
  select(threadId, { reveal = true, focus = false, fresh = false } = {}) {
    const thread = this.#threads.thread(threadId)
    if (!thread) return
    this.#activeId = threadId
    this.#freshId = fresh ? threadId : null
    this.#arrivedIds.delete(threadId)
    if (!thread.matches(this.#filter)) this.#filter = 'all'
    const listWasShown = this.#drawer.isOpen && this.#drawer.view === 'comments'
    if (!listWasShown) this.#drawer.open('comments')
    this.render()
    const threadElement = this.#threadElementOf(threadId)
    const glides = listWasShown && !REDUCED_MOTION.matches
    threadElement?.scrollIntoView({ block: 'nearest', behavior: glides ? 'smooth' : 'instant' })
    if (focus) threadElement?.focus({ preventScroll: true })
    this.dispatchEvent(new CustomEvent('select', { detail: { thread, reveal } }))
    this.dispatchEvent(new Event('change'))
  }

  /** A notification links to #comment-<id>, a thread's first comment or one of its replies. */
  showLinkedComment() {
    if (!location.hash.startsWith(COMMENT_LINK_PREFIX)) return
    const thread = this.#threads.threadOf(decodeURIComponent(location.hash.slice(COMMENT_LINK_PREFIX.length)))
    if (thread) this.select(thread.id, { reveal: true, focus: true })
  }

  /** J and K: the next or previous open thread in the order its pins appear on the page. */
  step(direction, threadsInPageOrder) {
    const open = threadsInPageOrder.filter(thread => thread.isOpen)
    if (open.length === 0) return Xxd.toast('没有待处理的评论', { within: this.#toastRegion })
    const index = open.findIndex(thread => thread.id === this.#activeId)
    const firstStep = direction > 0 ? open[0] : open.at(-1)
    const next = index < 0 ? firstStep : open[(index + direction + open.length) % open.length]
    this.select(next.id, { reveal: true, focus: true })
  }

  /** Threads whose element is gone from the version on screen read 位置已失效 instead of pointing nowhere. */
  showOrphaned(threadIds) {
    const unchanged = threadIds.length === this.#orphanedIds.size && threadIds.every(threadId => this.#orphanedIds.has(threadId))
    if (unchanged) return
    this.#orphanedIds = new Set(threadIds)
    this.render()
  }

  /** Comments others wrote while the page was open: a cue in the drawer leads to the first of them. */
  noteArrived(comments) {
    if (comments.length === 0) return
    for (const comment of comments) this.#arrivedIds.add(this.#threads.threadOf(comment.commentId)?.id ?? comment.commentId)
    this.render()
  }

  render() {
    if (this.#isTyping()) {
      this.#renderWhenIdle = true
      return
    }
    this.#renderWhenIdle = false
    if (!this.#isFilterShown(this.#filter)) this.#filter = 'open'
    this.#forgetActiveWhenGone()
    const list = this.#element.querySelector('[data-comment-threads]')
    const scrollTop = list.scrollTop
    const refocus = this.#focusKeeper()
    const shownThreads = this.#threads.all.filter(thread => thread.matches(this.#filter))
    this.#renderFilters()
    this.#renderArrivedCue()
    list.replaceChildren(shownThreads.length > 0 ? element('div', { className: 'comment-threads' }, shownThreads.map(thread => this.#threadElement(thread))) : this.#emptyState())
    list.scrollTop = scrollTop
    refocus()
    this.#freshId = null
  }

  // Re-rendering replaces every thread's controls; the one that had focus gets it back, in the new copy of its thread.
  #focusKeeper() {
    const focused = document.activeElement
    const thread = this.#element.contains(focused) ? focused.closest('[data-thread-id]') : null
    if (!thread) return () => {}
    const control = THREAD_CONTROLS.find(selector => focused.matches(selector)) ?? null
    const threadId = thread.dataset.threadId
    return () => {
      const renderedThread = this.#threadElementOf(threadId)
      const target = control ? renderedThread?.querySelector(control) : renderedThread
      target?.focus({ preventScroll: true })
    }
  }

  // A thread that left the list, once resolved and no longer kept in place, is no longer the active one.
  #forgetActiveWhenGone() {
    const active = this.#activeId === null ? null : this.#threads.thread(this.#activeId)
    if (this.#activeId === null || active?.matches(this.#filter)) return
    this.#activeId = null
    queueMicrotask(() => this.dispatchEvent(new Event('change')))
  }

  get #toastRegion() {
    return this.#drawer.isOpen ? this.#element : this.#stage
  }

  #announce(text) {
    this.#element.querySelector('[data-comment-status]').textContent = text
  }

  #isTyping() {
    const focused = document.activeElement
    return this.#element.contains(focused) && focused.matches('textarea')
  }

  #renderIfWaiting() {
    if (this.#renderWhenIdle) this.render()
  }

  #threadElementOf(threadId) {
    return this.#element.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`)
  }

  #renderFoot() {
    const foot = this.#element.querySelector('[data-drawer-foot]')
    foot.hidden = !this.#canComment
    if (!this.#canComment) return
    if (this.#byTouch) foot.replaceChildren('长按页面上的内容写评论。')
    else foot.replaceChildren('按 ', element('kbd', { className: 'xxd-kbd' }, 'C'), ' 再点页面写评论，', element('kbd', { className: 'xxd-kbd' }, 'J'), ' ', element('kbd', { className: 'xxd-kbd' }, 'K'), ' 切换评论。')
  }

  #isFilterShown(filter) {
    switch (filter) {
      case 'open':
        return true
      case 'agent':
        return this.#canComment && this.#threads.count('agent') > 0
      case 'all':
        return this.#threads.count('all') > this.#threads.count('open')
      default:
        throw new Error(`unknown comment filter ${filter}`)
    }
  }

  // A filter with nothing under it is not offered; with one filter left there is nothing to choose.
  #renderFilters() {
    const slot = this.#element.querySelector('[data-comment-filters]')
    const shownFilters = COMMENT_FILTERS.filter(filter => this.#isFilterShown(filter))
    const focusWasHere = slot.contains(document.activeElement)
    slot.hidden = shownFilters.length < 2
    if (slot.hidden) return slot.replaceChildren()
    const option = filter => element('button', { type: 'button', role: 'radio', 'aria-checked': String(filter === this.#filter), tabindex: filter === this.#filter ? '0' : '-1', 'data-value': filter },
      FILTER_LABELS[filter], element('span', { className: 'comment-filter__count' }, String(this.#threads.count(filter))))
    const group = element('div', { className: 'xxd-segmented', 'data-xxd-segmented': true, 'data-size': 'sm', role: 'radiogroup', 'aria-label': '筛选评论' }, shownFilters.map(option))
    group.addEventListener('xxd:change', event => {
      this.#filter = event.detail.value
      this.render()
    })
    slot.replaceChildren(group)
    if (focusWasHere) group.querySelector('[aria-checked="true"]')?.focus()
  }

  #renderArrivedCue() {
    const slot = this.#element.querySelector('[data-new-comments]')
    const arrivedCount = this.#arrivedIds.size
    if (arrivedCount === 0) return slot.replaceChildren()
    const [firstArrived] = this.#arrivedIds
    slot.replaceChildren(element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'xs', onClick: () => this.select(firstArrived, { focus: true }) }, `有 ${arrivedCount} 条新评论`))
  }

  #emptyState() {
    const noCommentsYet = this.#canComment ? `还没有评论。${this.#byTouch ? '长按页面上的内容' : '按 C，点页面上的内容'}写第一条。` : '还没有评论。'
    const hasComments = this.#threads.count('all') > 0
    const emptyText = {
      open: hasComments ? '没有待处理的评论。' : noCommentsYet,
      agent: '没有给 agent 的评论。勾上「给 agent」，agent 会按评论修改页面。',
      all: noCommentsYet,
    }[this.#filter]
    return element('div', { className: 'xxd-empty comment-threads__empty', 'data-size': 'sm' }, element('p', { className: 'xxd-empty__text' }, emptyText))
  }

  #threadElement(thread) {
    const isResolved = !thread.isOpen
    const threadElement = element('article', {
      className: 'comment-thread',
      'data-thread-id': thread.id,
      'data-state': thread.pinState,
      'data-active': thread.id === this.#activeId,
      'data-arrived': this.#arrivedIds.has(thread.id) || thread.id === this.#freshId,
      tabindex: '-1',
      'aria-label': `评论 ${thread.number}，${CommentList.#authorOf(thread.root)}${isResolved ? '，已解决' : ''}`,
    },
      this.#metaOf(thread),
      this.#excerptOf(thread),
      element('p', { className: 'comment-thread__body' }, thread.root.body),
      thread.replies.length > 0 ? element('ol', { className: 'comment-replies' }, thread.replies.map(reply => CommentList.#replyElement(reply))) : null,
      isResolved ? CommentList.#resolutionOf(thread.root) : null,
      this.#canComment ? this.#replyArea(thread) : null,
    )
    threadElement.addEventListener('click', event => {
      if (event.target.closest('button, a, form')) return
      this.select(thread.id)
    })
    return threadElement
  }

  #metaOf(thread) {
    const pinContent = thread.pinState === 'resolved' ? icon('Check', 14) : String(thread.number)
    return element('div', { className: 'comment-thread__meta' },
      element('button', { type: 'button', className: 'comment-pin', 'data-state': thread.pinState, 'aria-label': `在页面上显示评论 ${thread.number}`, onClick: () => this.select(thread.id) }, pinContent),
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'aria-hidden': 'true' }, initialOf(thread.root.author.name)),
      element('b', { className: 'comment-thread__author' }, CommentList.#authorOf(thread.root)),
      timeElement(thread.root.createdAt),
      thread.forAgent ? element('span', { className: 'xxd-badge', 'data-tone': 'warning' }, '给 agent') : null,
      this.#canComment ? this.#resolveButton(thread) : null,
    )
  }

  #excerptOf(thread) {
    const lostSpot = this.#orphanedIds.has(thread.id) ? element('span', { className: 'comment-thread__lost' }, '位置已失效') : null
    if (!thread.excerpt && !lostSpot) return null
    return element('p', { className: 'comment-thread__quote' }, lostSpot, thread.excerpt)
  }

  #resolveButton(thread) {
    const isResolved = !thread.isOpen
    const label = isResolved ? `重新打开评论 ${thread.number}` : `解决评论 ${thread.number}`
    return element('button', { type: 'button', className: 'xxd-btn comment-thread__resolve', 'data-variant': 'ghost', 'data-icon-only': true, 'data-size': 'sm', 'aria-label': label, 'data-tooltip': isResolved ? '重新打开' : '解决', 'data-tooltip-placement': 'left', onClick: () => (isResolved ? this.#reopen(thread) : this.#resolve(thread)) },
      icon(isResolved ? 'RotateCcw' : 'Check'))
  }

  // Focus goes to the thread after the resolved one, so the keyboard keeps its place in the list.
  async #resolve(thread) {
    const shownIds = this.#threads.all.filter(candidate => candidate.matches(this.#filter)).map(candidate => candidate.id)
    const nextId = shownIds[shownIds.indexOf(thread.id) + 1] ?? null
    try {
      await this.#threads.setResolved(thread.id, true)
      this.#announce(`已解决评论 ${thread.number}`)
      Xxd.toast(`已解决评论 ${thread.number}`, { within: this.#toastRegion, action: { label: '撤销', onClick: () => this.#reopen(thread) } })
      const focusTarget = nextId ? this.#threadElementOf(nextId)?.querySelector('.comment-pin') : this.#element.querySelector('[data-comment-threads]')
      focusTarget?.focus()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  async #reopen(thread) {
    try {
      await this.#threads.setResolved(thread.id, false)
      this.#announce(`已重新打开评论 ${thread.number}`)
      this.#threadElementOf(thread.id)?.querySelector('.comment-thread__resolve')?.focus()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  #replyArea(thread) {
    if (this.#replyingTo !== thread.id) {
      return element('button', { type: 'button', className: 'xxd-link comment-thread__reply-toggle', onClick: () => this.#openReply(thread.id) }, '回复')
    }
    const replyBody = element('textarea', { className: 'xxd-textarea', rows: '2', required: true, placeholder: '回复…', 'aria-label': `回复评论 ${thread.number}`, onInput: event => this.#replyDrafts.set(thread.id, event.target.value) }, this.#replyDrafts.get(thread.id) ?? '')
    const replyForm = element('form', { className: 'comment-reply-form', 'data-reply-form': thread.id },
      replyBody,
      element('div', { className: 'comment-reply-form__row' },
        element('span', { className: 'viewer-shortcut', 'aria-hidden': 'true' }, element('kbd', { className: 'xxd-kbd' }, MODIFIER_KEY), element('kbd', { className: 'xxd-kbd' }, '↵')),
        element('button', { type: 'button', className: 'xxd-btn ui-dialog-cancel', 'data-size': 'sm', onClick: () => this.cancelReply() }, '取消'),
        element('button', { type: 'submit', className: 'xxd-btn', 'data-variant': 'primary', 'data-size': 'sm' }, '回复'),
      ),
    )
    submitOnce(replyForm, () => this.#sendReply(thread, replyBody.value.trim()))
    queueMicrotask(() => replyBody.focus())
    return replyForm
  }

  #openReply(threadId) {
    this.#replyingTo = threadId
    this.render()
  }

  /** Esc in a reply box closes it; what was typed stays for the next time it opens. */
  cancelReply() {
    const threadId = this.#replyingTo
    if (threadId === null) return
    this.#replyingTo = null
    document.activeElement?.blur()
    this.render()
    this.#threadElementOf(threadId)?.querySelector('.comment-thread__reply-toggle')?.focus()
  }

  async #sendReply(thread, body) {
    if (!body) return
    try {
      await this.#threads.reply(thread.id, body)
      this.#replyDrafts.delete(thread.id)
      this.#replyingTo = null
      document.activeElement?.blur()
      this.render()
      this.#announce(`已回复评论 ${thread.number}`)
      this.#threadElementOf(thread.id)?.querySelector('.comment-thread__reply-toggle')?.focus()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  static #authorOf(comment) {
    return comment.postedVia ? `${comment.postedVia}（代 ${comment.author.name}）` : comment.author.name
  }

  static #replyElement(reply) {
    const byAgent = reply.postedVia !== null
    const who = byAgent
      ? [element('span', { className: 'comment-agent-mark', 'aria-hidden': 'true' }, icon('SquareTerminal', 14)), element('b', { className: 'comment-thread__author' }, reply.postedVia), element('span', { className: 'xxd-badge' }, `代 ${reply.author.name}`)]
      : [element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'aria-hidden': 'true' }, initialOf(reply.author.name)), element('b', { className: 'comment-thread__author' }, reply.author.name)]
    return element('li', { className: 'comment-reply', 'data-agent': byAgent }, element('div', { className: 'comment-thread__meta' }, who, timeElement(reply.createdAt)), element('p', {}, reply.body))
  }

  static #resolutionOf(root) {
    const resolver = root.resolvedBy?.name
    const when = root.resolvedAt ? [' · ', timeElement(root.resolvedAt)] : []
    return element('p', { className: 'comment-thread__resolution' }, resolver ? `${resolver} 标记已解决` : '已解决', when)
  }
}
