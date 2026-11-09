import { avatarStyle } from '../avatar.js'
import { element, icon, initialOf, m, submitOnce, timeElement, userMessageOf } from '../common.js'
import { MODIFIER_KEY } from './comment-mode.js'
import { COMMENT_FILTERS } from './comment-threads.js'

const COPIED_LABEL_MS = 2000
const COMMENT_LINK_PREFIX = '#comment-'
const THREAD_CONTROLS = ['.comment-pin', '.comment-thread__resolve', '.comment-thread__reply-toggle', '.comment-thread__more']
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
  /** Asked on each render: a tablet can gain or lose a keyboard while the page is open. */
  #byTouch
  #handoff
  #filter = 'open'
  #activeId = null
  #replyingTo = null
  #replyDrafts = new Map()
  #arrivedIds = new Set()
  #freshId = null
  #orphanedIds = new Set()
  #renderWhenIdle = false

  /** `handoff` is null for people who cannot edit: an agent acting for them could not change the page. */
  constructor({ element: listElement, threads, drawer, stage, canComment, byTouch, handoff }) {
    super()
    this.#element = listElement
    this.#threads = threads
    this.#drawer = drawer
    this.#stage = stage
    this.#canComment = canComment
    this.#byTouch = byTouch
    this.#handoff = handoff
    threads.addEventListener('change', () => this.render())
    listElement.addEventListener('focusout', () => setTimeout(() => this.#renderIfWaiting()))
    this.#renderFoot()
    matchMedia('(pointer: coarse)').addEventListener('change', () => this.#renderFoot())
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
    if (open.length === 0) return Xxd.toast(m.viewerClient.comments.noneOpen, { within: this.#toastRegion })
    const index = open.findIndex(thread => thread.id === this.#activeId)
    const firstStep = direction > 0 ? open[0] : open.at(-1)
    const next = index < 0 ? firstStep : open[(index + direction + open.length) % open.length]
    this.select(next.id, { reveal: true, focus: true })
  }

  /** Threads whose element is gone from the version on screen say their spot is lost instead of pointing nowhere. */
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
    const threadsOrEmpty = shownThreads.length > 0 ? element('div', { className: 'comment-threads' }, shownThreads.map(thread => this.#threadElement(thread))) : this.#emptyState()
    list.replaceChildren(this.#handoffBar() ?? '', threadsOrEmpty)
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

  // A refresh would replace the reply being typed or the menu being read, so it waits until the person is done.
  #isTyping() {
    const focused = document.activeElement
    return (this.#element.contains(focused) && focused.matches('textarea')) || this.#element.querySelector('.xxd-menu:popover-open') !== null
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
    if (this.#byTouch()) foot.replaceChildren(m.viewerClient.comments.footTouch)
    else foot.replaceChildren(...m.viewerClient.comments.footKeys(element('kbd', { className: 'xxd-kbd' }, 'C'), element('kbd', { className: 'xxd-kbd' }, 'J'), element('kbd', { className: 'xxd-kbd' }, 'K')))
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
      m.viewerClient.comments.filters[filter], element('span', { className: 'comment-filter__count' }, String(this.#threads.count(filter))))
    const group = element('div', { className: 'xxd-segmented', 'data-xxd-segmented': true, 'data-size': 'sm', role: 'radiogroup', 'aria-label': m.viewerClient.comments.filterLabel }, shownFilters.map(option))
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
    slot.replaceChildren(element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'xs', onClick: () => this.select(firstArrived, { focus: true }) }, m.viewerClient.comments.arrived(arrivedCount)))
  }

  #emptyState() {
    const noCommentsYet = this.#canComment ? (this.#byTouch() ? m.viewerClient.comments.writeFirstTouch : m.viewerClient.comments.writeFirstPointer) : m.viewerClient.comments.noCommentsYet
    const hasComments = this.#threads.count('all') > 0
    const emptyText = {
      open: hasComments ? m.viewerClient.comments.emptyOpen : noCommentsYet,
      agent: m.viewerClient.comments.emptyAgent,
      all: noCommentsYet,
    }[this.#filter]
    return element('div', { className: 'xxd-empty comment-threads__empty', 'data-size': 'sm' }, element('p', { className: 'xxd-empty__text' }, emptyText))
  }

  #threadElement(thread) {
    const isResolved = !thread.isOpen
    const isActive = thread.id === this.#activeId
    // A resolved thread folds to one line until it is selected again: what is still open stays easy to scan.
    const folded = isResolved && !isActive && this.#replyingTo !== thread.id
    const threadElement = element('article', {
      className: 'comment-thread',
      'data-thread-id': thread.id,
      'data-state': thread.pinState,
      'data-active': isActive,
      'data-folded': folded,
      'data-arrived': this.#arrivedIds.has(thread.id) || thread.id === this.#freshId,
      tabindex: '-1',
      'aria-label': m.viewerClient.comments.threadLabel({ number: thread.number, author: CommentList.#authorOf(thread.root), resolved: isResolved }),
    }, folded ? this.#foldedLineOf(thread) : [
      this.#metaOf(thread),
      this.#excerptOf(thread),
      element('p', { className: 'comment-thread__body' }, thread.root.body),
      thread.replies.length > 0 ? element('ol', { className: 'comment-replies' }, thread.replies.map(reply => this.#replyElement(thread, reply))) : null,
      isResolved ? CommentList.#resolutionOf(thread.root) : null,
      this.#canComment ? this.#replyFormOrPrompt(thread, isActive) : null,
    ])
    threadElement.addEventListener('click', event => {
      if (event.target.closest('button, a, form')) return
      this.select(thread.id)
    })
    return threadElement
  }

  #pinOf(thread) {
    const pinContent = thread.pinState === 'resolved' ? icon('Check', 12) : String(thread.number)
    return element('button', { type: 'button', className: 'comment-pin', 'data-state': thread.pinState, 'aria-label': m.viewerClient.comments.showPin(thread.number), onClick: () => this.select(thread.id) }, pinContent)
  }

  // The pin alone marks the thread, in the shape it has on the page; a second square for the author read as another number.
  #metaOf(thread) {
    return element('div', { className: 'comment-thread__meta' },
      this.#pinOf(thread),
      element('b', { className: 'comment-thread__author' }, CommentList.#authorOf(thread.root)),
      timeElement(thread.root.createdAt),
      thread.forAgent ? element('span', { className: 'xxd-badge', 'data-tone': 'warning' }, m.viewerClient.comments.forAgent) : null,
      this.#canComment ? this.#toolsOf(thread) : null,
    )
  }

  #foldedLineOf(thread) {
    return element('div', { className: 'comment-thread__folded' },
      this.#pinOf(thread),
      element('b', { className: 'comment-thread__author' }, CommentList.#authorOf(thread.root)),
      element('span', { className: 'comment-thread__folded-body' }, thread.root.body))
  }

  // Resolving sits outside the menu, one press away; the rest are named in words inside it.
  #toolsOf(thread) {
    const isResolved = !thread.isOpen
    const tool = (iconName, label, onClick, className) => element('button', { type: 'button', className: `xxd-btn ${className}`, 'data-variant': 'ghost', 'data-size': 'xs', 'data-icon-only': '', 'aria-label': label, 'data-tooltip': label, onClick }, icon(iconName, 16))
    const resolveTool = isResolved
      ? tool('RotateCcw', m.viewerClient.comments.reopenLabel(thread.number), () => this.#reopen(thread), 'comment-thread__resolve')
      : tool('CircleCheck', m.viewerClient.comments.resolveLabel(thread.number), () => this.#resolve(thread), 'comment-thread__resolve')
    const replyTool = thread.id === this.#activeId ? null : tool('Reply', m.viewerClient.comments.replyTo(thread.number), () => this.#openReply(thread.id), 'comment-thread__reply-toggle')
    const menuId = `comment-menu-${thread.id}`
    const menuItem = (iconName, label, onClick, extra = {}) => element('button', { type: 'button', className: 'xxd-menu__item', role: 'menuitem', onClick, ...extra }, icon(iconName, 14), label)
    const items = [
      this.#handoff && !isResolved ? menuItem('Bot', m.viewerClient.handoff.copyOne, () => this.#copyToAgent(null, [thread], m.viewerClient.handoff.copiedOne(thread.number))) : null,
      menuItem('Link', m.viewerClient.comments.copyLink, () => this.#copyLink(thread)),
      ...(thread.root.canDelete ? [element('div', { className: 'xxd-menu__sep', role: 'separator' }), menuItem('Trash2', m.viewerClient.comments.delete, () => this.#deleteThread(thread), { 'data-tone': 'danger', 'aria-label': m.viewerClient.comments.deleteLabel(thread.number) })] : []),
    ]
    return element('div', { className: 'comment-thread__tools' },
      resolveTool,
      replyTool,
      element('button', { type: 'button', className: 'xxd-btn comment-thread__more', 'data-variant': 'ghost', 'data-size': 'xs', 'data-icon-only': '', 'data-xxd-menu': menuId, 'aria-label': m.viewerClient.comments.more(thread.number) }, icon('Ellipsis', 16)),
      element('div', { className: 'xxd-menu comment-thread__menu', id: menuId, role: 'menu', popover: '' }, items))
  }

  async #copyLink(thread) {
    const link = new URL(location.href)
    link.hash = `${COMMENT_LINK_PREFIX.slice(1)}${thread.root.commentId}`
    const copied = await Xxd.copyText(link.href)
    Xxd.toast(copied ? m.viewerClient.comments.linkCopied : m.viewerClient.handoff.copyFailed, { tone: copied ? 'success' : 'danger', within: this.#toastRegion })
  }

  // Every comment still open under the filter, ready to paste in one go: what an agent should work through next.
  #handoffBar() {
    const showsWork = this.#filter === 'open' || this.#filter === 'agent'
    const waiting = this.#threads.all.filter(thread => thread.isCountedIn(this.#filter))
    if (!this.#handoff || !showsWork || waiting.length === 0) return null
    const copyAll = element('button', {
      type: 'button',
      className: 'xxd-btn agent-handoff__copy',
      'data-variant': 'ghost',
      'data-size': 'xs',
      onClick: event => this.#copyToAgent(event.currentTarget, waiting, m.viewerClient.handoff.copiedAll(waiting.length)),
    }, icon('Copy', 14), element('span', { 'data-copy-label': '' }, m.viewerClient.handoff.copyAll))
    // The how-to stays one hover away on the link that leads to it, so the line reads as a count and an action.
    const setUp = element('a', { className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'xs', 'data-icon-only': '', href: '/settings/agents', 'aria-label': m.viewerClient.handoff.setUp, 'data-tooltip': m.viewerClient.handoff.hint }, icon('ArrowUpRight', 16))
    return element('section', { className: 'agent-handoff', 'aria-label': m.viewerClient.handoff.region },
      icon('Bot', 16),
      element('p', { className: 'agent-handoff__title' }, this.#filter === 'agent' ? m.viewerClient.handoff.waitingAgent(waiting.length) : m.viewerClient.handoff.waitingOpen(waiting.length)),
      copyAll,
      setUp)
  }

  #excerptOf(thread) {
    const lostSpot = this.#orphanedIds.has(thread.id) ? element('span', { className: 'comment-thread__lost' }, m.viewerClient.comments.lostSpot) : null
    if (!thread.excerpt && !lostSpot) return null
    return element('p', { className: 'comment-thread__quote' }, lostSpot, thread.excerpt)
  }

  // The selected thread offers a reply in the shape of a box, so where the reply goes is plain before pressing.
  #replyFormOrPrompt(thread, isActive) {
    if (this.#replyingTo === thread.id) return this.#replyForm(thread)
    if (!isActive) return null
    return element('button', { type: 'button', className: 'comment-thread__reply-toggle comment-reply-prompt', 'aria-label': m.viewerClient.comments.replyTo(thread.number), onClick: () => this.#openReply(thread.id) },
      icon('Reply', 14), element('span', {}, m.viewerClient.comments.replyPlaceholder))
  }

  // Quiet until its reply is pointed at, at the end of the reply's own line.
  static #deleteButton(onClick, label) {
    return element('button', { type: 'button', className: 'xxd-btn comment-thread__delete', 'data-variant': 'ghost', 'data-size': 'xs', 'data-icon-only': '', 'aria-label': label, 'data-tooltip': label, onClick }, icon('Trash2', 14))
  }

  // Deleting cannot be undone, so it always asks; the kit puts cancel first and the danger action last.
  static #confirmDeletion(title, message) {
    return Xxd.confirmDialog({ title, message, confirmLabel: m.viewerClient.comments.delete, cancelLabel: m.viewerClient.actions.cancel, closeLabel: m.viewerClient.actions.close, tone: 'danger' })
  }

  async #deleteThread(thread) {
    const replyCount = thread.replies.length
    const confirmed = await CommentList.#confirmDeletion(m.viewerClient.comments.deleteTitle(thread.number), m.viewerClient.comments.deleteMessage(replyCount))
    if (!confirmed) return
    const neighbourId = this.#neighbourOf(thread.id)
    try {
      await this.#threads.remove(thread.id)
      this.#announce(m.viewerClient.comments.deleted(thread.number))
      Xxd.toast(m.viewerClient.comments.deleted(thread.number), { within: this.#toastRegion })
      this.#focusThreadOrList(neighbourId)
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  async #deleteReply(thread, reply) {
    const confirmed = await CommentList.#confirmDeletion(m.viewerClient.comments.deleteReplyTitle, m.viewerClient.comments.deleteReplyMessage)
    if (!confirmed) return
    try {
      await this.#threads.remove(reply.commentId)
      this.#announce(m.viewerClient.comments.replyDeletedFrom(thread.number))
      Xxd.toast(m.viewerClient.comments.replyDeleted, { within: this.#toastRegion })
      this.#threadElementOf(thread.id)?.querySelector('.comment-thread__reply-toggle')?.focus()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  // The control itself says it copied for a moment, in words, so it never reads as another control's symbol.
  // `control` is null for a menu item, which closes as it is pressed: the toast alone says it copied.
  async #copyToAgent(control, threads, doneMessage) {
    // The kit falls back to a hidden selection when the clipboard API is refused; it answers false only when both fail.
    const copied = await Xxd.copyText(this.#handoff.promptFor(threads))
    if (!copied) {
      Xxd.toast(m.viewerClient.handoff.copyFailed, { tone: 'danger', within: this.#toastRegion })
      return
    }
    if (!control) {
      Xxd.toast(doneMessage, { tone: 'success', within: this.#toastRegion })
      return
    }
    const label = control.querySelector('[data-copy-label]') ?? control
    const restingLabel = label.textContent
    // Held at its resting width, so the shorter word does not pull the controls beside it.
    control.style.minWidth = `${control.offsetWidth}px`
    label.textContent = m.viewerClient.handoff.copied
    control.setAttribute('data-copied', '')
    Xxd.toast(doneMessage, { tone: 'success', within: this.#toastRegion })
    setTimeout(() => {
      label.textContent = restingLabel
      control.removeAttribute('data-copied')
      control.style.minWidth = ''
    }, COPIED_LABEL_MS)
  }

  // The thread after this one in the list, or the one before when it is the last: where the keyboard goes once it leaves.
  #neighbourOf(threadId) {
    const shownIds = this.#threads.all.filter(candidate => candidate.matches(this.#filter)).map(candidate => candidate.id)
    const index = shownIds.indexOf(threadId)
    return shownIds[index + 1] ?? shownIds[index - 1] ?? null
  }

  #focusThreadOrList(threadId) {
    const focusTarget = (threadId && this.#threadElementOf(threadId)?.querySelector('.comment-pin')) ?? this.#element.querySelector('[data-comment-threads]')
    focusTarget.focus()
  }

  async #resolve(thread) {
    const neighbourId = this.#neighbourOf(thread.id)
    try {
      await this.#threads.setResolved(thread.id, true)
      this.#announce(m.viewerClient.comments.resolved(thread.number))
      Xxd.toast(m.viewerClient.comments.resolved(thread.number), { within: this.#toastRegion, action: { label: m.viewerClient.actions.undo, onClick: () => this.#reopen(thread) } })
      this.#focusThreadOrList(neighbourId)
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  async #reopen(thread) {
    try {
      await this.#threads.setResolved(thread.id, false)
      this.#announce(m.viewerClient.comments.reopened(thread.number))
      this.#threadElementOf(thread.id)?.querySelector('.comment-thread__resolve')?.focus()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  #replyForm(thread) {
    const replyBody = element('textarea', { className: 'xxd-textarea', rows: '2', required: true, placeholder: m.viewerClient.comments.replyPlaceholder, 'aria-label': m.viewerClient.comments.replyTo(thread.number), onInput: event => this.#replyDrafts.set(thread.id, event.target.value) }, this.#replyDrafts.get(thread.id) ?? '')
    const replyForm = element('form', { className: 'comment-reply-form', 'data-reply-form': thread.id },
      replyBody,
      element('div', { className: 'comment-reply-form__row' },
        element('span', { className: 'viewer-shortcut', 'aria-hidden': 'true' }, element('kbd', { className: 'xxd-kbd' }, MODIFIER_KEY), element('kbd', { className: 'xxd-kbd' }, '↵')),
        element('button', { type: 'button', className: 'xxd-btn ui-dialog-cancel', 'data-size': 'sm', onClick: () => this.cancelReply() }, m.viewerClient.actions.cancel),
        element('button', { type: 'submit', className: 'xxd-btn', 'data-variant': 'primary', 'data-size': 'sm' }, m.viewerClient.comments.reply),
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
      this.#announce(m.viewerClient.comments.replied(thread.number))
      this.#threadElementOf(thread.id)?.querySelector('.comment-thread__reply-toggle')?.focus()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#toastRegion })
    }
  }

  static #authorOf(comment) {
    return comment.postedVia ? m.viewerClient.comments.onBehalf({ agent: comment.postedVia, person: comment.author.name }) : comment.author.name
  }

  #replyElement(thread, reply) {
    const byAgent = reply.postedVia !== null
    const who = byAgent
      ? [element('span', { className: 'comment-agent-mark', 'aria-hidden': 'true' }, icon('SquareTerminal', 14)), element('b', { className: 'comment-thread__author' }, reply.postedVia), element('span', { className: 'xxd-badge' }, m.viewerClient.comments.onBehalfBadge(reply.author.name))]
      : [element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'data-avatar': '', style: avatarStyle(reply.author.name), 'aria-hidden': 'true' }, initialOf(reply.author.name)), element('b', { className: 'comment-thread__author' }, reply.author.name)]
    const deleteReply = this.#canComment && reply.canDelete ? CommentList.#deleteButton(() => this.#deleteReply(thread, reply), m.viewerClient.comments.deleteReplyLabel(reply.postedVia ?? reply.author.name)) : null
    return element('li', { className: 'comment-reply', 'data-agent': byAgent }, element('div', { className: 'comment-thread__meta' }, who, timeElement(reply.createdAt), deleteReply), element('p', {}, reply.body))
  }

  static #resolutionOf(root) {
    const resolver = root.resolvedBy?.name
    const when = root.resolvedAt ? [' · ', timeElement(root.resolvedAt)] : []
    return element('p', { className: 'comment-thread__resolution' }, resolver ? m.viewerClient.comments.resolvedBy(resolver) : m.viewerClient.comments.resolvedPlain, when)
  }
}
