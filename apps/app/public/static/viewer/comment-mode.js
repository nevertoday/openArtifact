import { element, m, submitOnce, userMessageOf } from '../common.js'

const COACH_SEEN_KEY = 'open-artifact.coach.comment'
const COMPOSER_WIDTH = 340
const COMPOSER_GAP = 10
const COMPOSER_EDGE = 8
const COMPOSER_SIDE_MARGIN = 12
const TOUCH_FIRST = matchMedia('(pointer: coarse)')

/** The key held with ↵ to send what was written. */
export const MODIFIER_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** Whether the person writes with a finger: then a long press picks what to comment on, and the words say so. */
export function writesByTouch() {
  return TOUCH_FIRST.matches
}

/** Comment mode: while it is on, a click anywhere on the page picks what the next comment is about. */
export class CommentMode extends EventTarget {
  #on = false
  #button
  #hint
  #frame

  constructor({ button, hint, frame }) {
    super()
    this.#button = button
    this.#hint = hint
    this.#frame = frame
    button.addEventListener('click', () => this.toggle())
    hint.querySelector('[data-exit-comment-mode]').addEventListener('click', () => this.set(false))
    frame.setMode({ commentable: true, commenting: false })
  }

  get isOn() {
    return this.#on
  }

  toggle() {
    this.set(!this.#on)
  }

  set(on) {
    this.#on = on
    this.#frame.setMode({ commentable: true, commenting: on })
    this.#button.setAttribute('aria-pressed', String(on))
    this.#hint.hidden = !on
    this.#hint.querySelector('[data-mode-hint-text]').textContent = on ? (writesByTouch() ? m.viewerClient.commentMode.hintTouch : m.viewerClient.commentMode.hintPointer) : ''
    this.dispatchEvent(new Event('change'))
  }
}

/**
 * The box for a new comment, next to what it is about: below the element when it fits, above when it does not,
 * beside it as a last resort, and over it only when the frame has room nowhere else. It follows the element as
 * the page scrolls. What was typed stays if it closes, for when the same element is picked again.
 */
export class Composer extends EventTarget {
  #form
  #stage
  #frame
  #threads
  #shownVersion
  #target = null
  #draft = { key: null, body: '', forAgent: false }

  constructor({ form, stage, frame, threads, shownVersion }) {
    super()
    this.#form = form
    this.#stage = stage
    this.#frame = frame
    this.#threads = threads
    this.#shownVersion = shownVersion
    form.querySelector('[data-cancel-composer]').addEventListener('click', () => this.close())
    form.elements.forAgent.addEventListener('change', () => this.#showAgentNote())
    submitOnce(form, () => this.#send())
    frame.addEventListener('target-picked', event => this.open(event.detail))
    frame.addEventListener('viewport', event => this.#follow(event.detail.focused))
    window.addEventListener('resize', () => this.#place())
  }

  get isOpen() {
    return this.#target !== null
  }

  open(picked) {
    this.#keepDraft()
    this.#target = picked
    const sameAsDraft = this.#draft.key === Composer.#keyOf(picked.anchor)
    this.#form.querySelector('[data-composer-label]').textContent = Composer.#wordsOf(picked.label)
    this.#form.querySelector('[data-composer-version]').textContent = `v${this.#shownVersion()}`
    this.#form.querySelector('[data-composer-quote]').textContent = picked.source === 'selection' ? m.viewerClient.quoted(picked.excerpt) : picked.excerpt
    this.#form.elements.body.value = sameAsDraft ? this.#draft.body : ''
    this.#form.elements.forAgent.checked = sameAsDraft && this.#draft.forAgent
    this.#showAgentNote()
    this.#form.hidden = false
    this.#place()
    this.#form.elements.body.focus({ preventScroll: true })
    this.dispatchEvent(new Event('open'))
  }

  close() {
    if (!this.isOpen) return
    this.#keepDraft()
    this.#target = null
    this.#form.hidden = true
    this.#frame.focusAnchor(null)
  }

  #keepDraft() {
    if (!this.#target) return
    this.#draft = { key: Composer.#keyOf(this.#target.anchor), body: this.#form.elements.body.value, forAgent: this.#form.elements.forAgent.checked }
  }

  static #wordsOf({ kind, text }) {
    const kindName = m.viewerClient.blockKinds[kind]
    return text ? `${kindName} · ${text}` : kindName
  }

  static #keyOf(anchor) {
    return `${anchor.selector ?? ''}\n${anchor.quote?.exact ?? ''}`
  }

  #showAgentNote() {
    this.#form.querySelector('[data-agent-note]').hidden = !this.#form.elements.forAgent.checked
  }

  #follow(focusedRect) {
    if (!this.isOpen || !focusedRect) return
    this.#target = { ...this.#target, rect: focusedRect }
    this.#place()
  }

  #place() {
    if (!this.isOpen) return
    const area = { width: this.#stage.clientWidth, height: this.#stage.clientHeight }
    const target = this.#target.rect
    const width = Math.min(COMPOSER_WIDTH, area.width - COMPOSER_SIDE_MARGIN * 2)
    this.#form.style.width = `${width}px`
    const height = this.#form.offsetHeight
    const fitsBelow = target.y + target.height + COMPOSER_GAP + height <= area.height - COMPOSER_EDGE
    const fitsAbove = target.y - COMPOSER_GAP - height >= COMPOSER_EDGE
    const fitsBeside = target.x + target.width + COMPOSER_GAP + width <= area.width - COMPOSER_EDGE
    let left = Math.max(COMPOSER_SIDE_MARGIN, Math.min(target.x, area.width - width - COMPOSER_SIDE_MARGIN))
    let top = area.height - height - COMPOSER_EDGE
    let side = 'over'
    if (fitsBelow) [top, side] = [target.y + target.height + COMPOSER_GAP, 'below']
    else if (fitsAbove) [top, side] = [target.y - COMPOSER_GAP - height, 'above']
    else if (fitsBeside) [left, top, side] = [target.x + target.width + COMPOSER_GAP, target.y, 'beside']
    this.#form.style.left = `${left}px`
    this.#form.style.top = `${Math.max(COMPOSER_EDGE, Math.min(top, area.height - height - COMPOSER_EDGE))}px`
    this.#form.dataset.side = side
  }

  async #send() {
    const body = this.#form.elements.body.value.trim()
    if (!body || !this.#target) return this.#form.elements.body.focus()
    const forAgent = this.#form.elements.forAgent.checked
    try {
      const thread = await this.#threads.post({ body, forAgent, anchor: { ...this.#target.anchor, version: this.#shownVersion() } })
      this.#draft = { key: null, body: '', forAgent: false }
      this.#target = null
      this.#form.hidden = true
      this.#frame.focusAnchor(null)
      this.dispatchEvent(new CustomEvent('sent', { detail: { thread } }))
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#stage })
    }
  }
}

/** A one-time hint at the bottom of the page. Remembered in the browser; once a session when storage is blocked. */
export class CoachMark {
  #element
  #seenThisSession = false

  constructor(coach) {
    this.#element = coach
    coach.querySelector('[data-dismiss-coach]').addEventListener('click', () => this.dismiss())
    window.addEventListener('resize', () => this.#place())
    // Doing anything else with the page, by pointer or by keyboard, is as good as dismissing it.
    const dismissOutside = event => { if (!coach.contains(event.target)) this.dismiss() }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('click', dismissOutside, true)
  }

  get isOpen() {
    return !this.#element.hidden
  }

  /** `busy` says whether a drawer or dialog is already open, so the hint does not land on top of it. */
  showOnce(busy = () => false) {
    if (this.#wasSeen() || busy() || document.querySelector('dialog[open]')) return
    const text = this.#element.querySelector('[data-coach-text]')
    if (writesByTouch()) text.replaceChildren(m.viewerClient.commentMode.coachTouch)
    else text.replaceChildren(...m.viewerClient.commentMode.coachKeys(element('kbd', { className: 'xxd-kbd' }, 'C')))
    this.#element.hidden = false
    this.#place()
  }

  dismiss() {
    if (!this.isOpen) return
    this.#element.hidden = true
    this.#seenThisSession = true
    try {
      localStorage.setItem(COACH_SEEN_KEY, 'seen')
    } catch {
      // Storage is blocked in this browser; the hint then shows once per page load, as #wasSeen reads it.
    }
  }

  #wasSeen() {
    try {
      return localStorage.getItem(COACH_SEEN_KEY) === 'seen'
    } catch {
      return this.#seenThisSession
    }
  }

  // Hangs under the comment-mode button, its arrow pointing at the button, inside the window.
  #place() {
    if (!this.isOpen) return
    // Rests at the bottom centre, clear of the page's title and its pins, where a thumb or a glance finds it.
    const area = this.#element.offsetParent.getBoundingClientRect()
    this.#element.style.left = `${Math.max(COMPOSER_EDGE, (area.width - this.#element.offsetWidth) / 2)}px`
    this.#element.style.top = `${area.height - this.#element.offsetHeight - COMPOSER_GAP * 3}px`
  }
}
