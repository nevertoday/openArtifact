/**
 * The pins on the page: one for each open thread that points at a spot, the active thread even when resolved, and
 * a thread resolved a moment ago, shown as a check. It remembers where each pin sits, so J and K can walk the
 * threads in the order they appear on the page.
 */
export class CommentPins {
  #frame
  #threads
  #list
  #isShowingLatest
  #tops = new Map()

  constructor({ frame, threads, list, isShowingLatest }) {
    this.#frame = frame
    this.#threads = threads
    this.#list = list
    this.#isShowingLatest = isShowingLatest
    threads.addEventListener('change', () => this.render())
    list.addEventListener('change', () => this.render())
    frame.addEventListener('pins-placed', event => this.#placed(event.detail))
    frame.addEventListener('pin-selected', event => list.select(event.detail.commentId, { reveal: false, focus: true }))
  }

  render() {
    const shownThreads = this.#threads.all.filter(thread => this.#hasPin(thread))
    this.#frame.showPins(shownThreads.map(thread => ({ commentId: thread.id, number: thread.number, anchor: thread.anchor, state: thread.pinState, active: thread.id === this.#list.activeId })))
  }

  #hasPin(thread) {
    const pointsAtSpot = thread.anchor !== null
    const isWorthShowing = thread.isOpen || thread.lingering || thread.id === this.#list.activeId
    return pointsAtSpot && isWorthShowing
  }

  /** Threads ordered by where their pins sit on the page; threads without a pin keep their numbers' order, after the rest. */
  threadsInPageOrder() {
    const topOf = thread => this.#tops.get(thread.id) ?? Number.MAX_SAFE_INTEGER
    return this.#threads.all.toSorted((first, second) => topOf(first) - topOf(second) || first.number - second.number)
  }

  // An older version may simply not have a newer comment's spot; only the latest version can lose one.
  #placed({ tops, orphaned }) {
    this.#tops = tops
    this.#list.showOrphaned(this.#isShowingLatest() ? orphaned : [])
  }
}
