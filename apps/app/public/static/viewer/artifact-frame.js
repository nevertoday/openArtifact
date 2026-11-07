const MESSAGE_PREFIX = 'open-artifact:'
const READY_TIMEOUT_MS = 8000
const SCROLLED_TIMEOUT_MS = 1000
const FADE_IN_MS = 180
const THEME_TOKENS = ['ink', 'paper', 'muted', 'action', 'success-solid', 'success-on-solid', 'success-tint', 'warning-solid', 'warning-on-solid', 'warning-tint', 'danger-solid', 'danger-on-solid', 'danger-text', 'font-body']
const PICK_SOURCES = new Set(['click', 'long-press', 'selection'])
const BLOCK_KINDS = new Set(['heading', 'table', 'figure', 'image', 'video', 'code', 'quote', 'listItem', 'paragraph', 'term', 'definition', 'block', 'selection'])
const FORWARDED_KEYS = new Set(['c', 'C', 'j', 'J', 'k', 'K', '?', 'Escape'])
const MAX_BLOCKS = 20000
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)')
const DARK_SCHEME = matchMedia('(prefers-color-scheme: dark)')

/**
 * The frame's messages come from the artifact page, which anyone could have written: each is checked here for its
 * shape before the rest of the viewer sees it, and what only shows on screen is cut to size. Whether a shared-data
 * request may run is for the shared-data proxy to answer, and how long a comment's anchor may be is the API's rule.
 */
class FrameMessage {
  static fieldsOf(name, message) {
    switch (name) {
      case 'request':
        return FrameMessage.#requestOf(message)
      case 'ready':
        return { blocks: FrameMessage.#blocksOf(message.blocks) }
      case 'target-picked':
        return FrameMessage.#pickOf(message)
      case 'viewport':
        return { top: FrameMessage.#placeOf(message.top), focused: FrameMessage.#rectOf(message.focused) }
      case 'pins-placed':
        return { placed: FrameMessage.#idsOf(message.placed), orphaned: FrameMessage.#idsOf(message.orphaned), tops: FrameMessage.#topsOf(message.tops) }
      case 'pin-selected':
        return { commentId: FrameMessage.#textOf(message.commentId, 64) }
      case 'key':
        return FORWARDED_KEYS.has(message.key) ? { key: message.key } : null
      case 'scrolled':
        return {}
      default:
        return null
    }
  }

  static #isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value)
  }

  static #textOf(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : ''
  }

  static #textOrNull(value) {
    return typeof value === 'string' && value !== '' ? value : null
  }

  static #requestOf(message) {
    const isRequest = typeof message.requestId === 'string' && typeof message.operation === 'string'
    if (!isRequest) return null
    return { requestId: message.requestId.slice(0, 64), operation: message.operation, collection: message.collection, documentId: message.documentId, data: message.data }
  }

  static #blocksOf(blocks) {
    if (!Array.isArray(blocks)) return []
    const wellFormed = blocks.slice(0, MAX_BLOCKS).filter(block => block && typeof block.path === 'string')
    return wellFormed.map(block => ({ path: block.path, tag: FrameMessage.#textOf(block.tag, 16), text: FrameMessage.#textOf(block.text, 4000) }))
  }

  // The shape the comments API stores; the version is the viewer's to fill in.
  static #anchorOf(anchor) {
    const isFraction = value => FrameMessage.#isNumber(value) && value >= 0 && value <= 1
    if (!anchor || !isFraction(anchor.x) || !isFraction(anchor.y)) return null
    return { x: anchor.x, y: anchor.y, selector: FrameMessage.#textOrNull(anchor.selector), textQuote: FrameMessage.#textOrNull(anchor.textQuote), quote: FrameMessage.#quoteOf(anchor.quote) }
  }

  static #quoteOf(quote) {
    const exact = FrameMessage.#textOrNull(quote?.exact)
    if (exact === null) return null
    return { exact, prefix: typeof quote.prefix === 'string' ? quote.prefix : '', suffix: typeof quote.suffix === 'string' ? quote.suffix : '' }
  }

  static #pickOf(message) {
    const anchor = FrameMessage.#anchorOf(message.anchor)
    const rect = FrameMessage.#rectOf(message.rect)
    if (!PICK_SOURCES.has(message.source) || !anchor || !rect) return null
    return { source: message.source, anchor, rect, label: FrameMessage.#labelOf(message.label), excerpt: FrameMessage.#textOf(message.excerpt, 120) }
  }

  // The frame names what was picked by its kind; the viewer words it in the page's language.
  static #labelOf(label) {
    const kind = BLOCK_KINDS.has(label?.kind) ? label.kind : 'block'
    return { kind, text: FrameMessage.#textOf(label?.text, 40) }
  }

  static #rectOf(rect) {
    const isRect = rect && ['x', 'y', 'width', 'height'].every(side => FrameMessage.#isNumber(rect[side]))
    return isRect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  }

  static #placeOf(place) {
    const isPlace = place && typeof place.path === 'string' && typeof place.text === 'string' && FrameMessage.#isNumber(place.offset)
    return isPlace ? { path: place.path.slice(0, 2000), text: place.text.slice(0, 120), offset: place.offset } : null
  }

  static #idsOf(ids) {
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string').map(id => id.slice(0, 64)) : []
  }

  static #topsOf(tops) {
    const entries = tops && typeof tops === 'object' ? Object.entries(tops) : []
    const numbered = entries.filter(([, top]) => FrameMessage.#isNumber(top))
    return new Map(numbered.map(([commentId, top]) => [commentId.slice(0, 64), top]))
  }
}

/**
 * The one owner of the conversation with the artifact frame. The frame is sandboxed without allow-same-origin, so
 * its messages arrive from the opaque origin "null" and its window object is what identifies it; and "*" is the
 * only target that reaches it, so every message goes to that one window.
 *
 * It keeps what the frame should show (language, theme, comment mode, pins, version marks) and hands it to every frame it
 * loads, so another version can take the place of the one on screen without the rest of the viewer noticing.
 * What the frame reports arrives as events: ready, target-picked, viewport, pins-placed, pin-selected, key.
 */
export class ArtifactFrame extends EventTarget {
  #current
  #arriving = null
  #loading = new Map()
  #sharedData
  #shown = { mode: { commentable: false, commenting: false }, pins: [], diff: null }

  constructor(iframe, { version, sharedData }) {
    super()
    this.#current = { iframe, version, blocks: null, place: null, onScrolled: null }
    this.#sharedData = sharedData
    window.addEventListener('message', event => this.#receive(event))
    new MutationObserver(() => this.#send('theme', ArtifactFrame.#themeOfPage())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-accent', 'style'] })
    for (const query of [DARK_SCHEME, REDUCED_MOTION]) query.addEventListener('change', () => this.#send('theme', ArtifactFrame.#themeOfPage()))
    this.#send('language', { locale: document.documentElement.lang })
    // The page may have loaded before this script ran and its ready gone unheard; it says ready again when asked.
    this.#send('sync', {})
  }

  get version() {
    return this.#current.version
  }

  /** The current page's blocks as of its load; empty until it has loaded. */
  get blocks() {
    return this.#current.blocks ?? []
  }

  /** Resolves once the page on screen has loaded and reported its blocks. */
  whenReady() {
    if (this.#current.blocks !== null) return Promise.resolve()
    return new Promise(resolve => this.addEventListener('ready', resolve, { once: true }))
  }

  /** Another version is loading to take this one's place. */
  get isReplacing() {
    return this.#arriving !== null
  }

  setTitle(title) {
    this.#current.iframe.title = title
  }

  setMode(mode) {
    this.#shown.mode = mode
    this.#send('mode', mode)
  }

  showPins(pins) {
    this.#shown.pins = pins
    this.#send('pins', { pins })
  }

  showDiff(diff) {
    this.#shown.diff = diff
    this.#send('compare', { diff })
  }

  /** Outlines the element a comment is being written about; null clears the outline and the selected words. */
  focusAnchor(anchor) {
    this.#send('focus', { anchor })
  }

  scrollToAnchor(anchor) {
    this.#send('scroll-to', { anchor })
  }

  wash(paths, { scroll }) {
    this.#send('wash', { paths, scroll })
  }

  stepTo(path) {
    this.#send('compare-step', { path })
  }

  /**
   * Loads another version over the one on screen, puts the block the reader was looking at back where it was, and
   * fades the new page in before the old one goes. Resolves to both pages' blocks, for telling what changed; or to
   * null when a later call took its place before it loaded.
   */
  async replaceWith(url, version) {
    this.#abandonArrival()
    this.#shown.diff = null
    const previous = this.#current
    const iframe = this.#newFrame(url, { measuredOnly: false })
    iframe.classList.add('viewer-frame--arriving')
    this.#arriving = iframe
    previous.iframe.after(iframe)
    const ready = await this.#readyOf(iframe)
    if (this.#arriving !== iframe) return null
    this.#arriving = null
    this.#current = { iframe, version, blocks: ready?.blocks ?? [], place: previous.place, onScrolled: null }
    this.#showEverything()
    if (previous.place) await this.#restorePlace(previous.place)
    await this.#fadeIn(iframe)
    previous.iframe.remove()
    return { before: previous.blocks ?? [], after: this.#current.blocks }
  }

  /** The blocks of a version that is not on screen, from a hidden copy of its page; null when it never loads. */
  async blocksOf(url) {
    const iframe = this.#newFrame(url, { measuredOnly: true })
    this.#current.iframe.after(iframe)
    const ready = await this.#readyOf(iframe)
    iframe.remove()
    return ready?.blocks ?? null
  }

  #abandonArrival() {
    const arriving = this.#arriving
    if (!arriving) return
    this.#arriving = null
    this.#loading.get(arriving.contentWindow)?.settle(null)
    arriving.remove()
  }

  #newFrame(url, { measuredOnly }) {
    const iframe = document.createElement('iframe')
    for (const name of ['sandbox', 'referrerpolicy', 'title']) iframe.setAttribute(name, this.#current.iframe.getAttribute(name) ?? '')
    if (measuredOnly) {
      iframe.className = 'viewer-frame--measured'
      iframe.setAttribute('aria-hidden', 'true')
      iframe.tabIndex = -1
    }
    iframe.src = url
    return iframe
  }

  #readyOf(iframe) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => settle(null), READY_TIMEOUT_MS)
      const settle = ready => {
        clearTimeout(timeout)
        this.#loading.delete(iframe.contentWindow)
        resolve(ready)
      }
      this.#loading.set(iframe.contentWindow, { settle, measuredOnly: iframe.classList.contains('viewer-frame--measured') })
    })
  }

  #restorePlace(place) {
    return new Promise(resolve => {
      const timeout = setTimeout(resolve, SCROLLED_TIMEOUT_MS)
      this.#current.onScrolled = () => {
        clearTimeout(timeout)
        resolve()
      }
      this.#send('restore-place', { place })
    })
  }

  async #fadeIn(iframe) {
    if (!REDUCED_MOTION.matches) await iframe.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: 'ease-out' }).finished
    iframe.classList.remove('viewer-frame--arriving')
  }

  #showEverything() {
    this.#send('language', { locale: document.documentElement.lang })
    this.#send('theme', ArtifactFrame.#themeOfPage())
    this.#send('mode', this.#shown.mode)
    this.#send('pins', { pins: this.#shown.pins })
    if (this.#shown.diff) this.#send('compare', { diff: this.#shown.diff })
  }

  #receive(event) {
    const message = event.data
    const isFrameMessage = event.origin === 'null' && message && typeof message.type === 'string' && message.type.startsWith(MESSAGE_PREFIX)
    if (!isFrameMessage) return
    const name = message.type.slice(MESSAGE_PREFIX.length)
    const fields = FrameMessage.fieldsOf(name, message)
    if (!fields) return
    if (event.source === this.#current.iframe.contentWindow) this.#fromCurrentFrame(name, fields, event.source)
    else if (this.#loading.has(event.source)) this.#fromLoadingFrame(name, fields, event.source)
  }

  #fromCurrentFrame(name, fields, frameWindow) {
    switch (name) {
      case 'request':
        return this.#answer(fields, frameWindow, { readOnly: false })
      case 'ready':
        this.#current.blocks = fields.blocks
        this.#showEverything()
        return this.#announce(name, fields)
      case 'viewport':
        this.#current.place = fields.top ?? this.#current.place
        return this.#announce(name, fields)
      case 'scrolled':
        return this.#current.onScrolled?.()
      default:
        return this.#announce(name, fields)
    }
  }

  #fromLoadingFrame(name, fields, frameWindow) {
    const loading = this.#loading.get(frameWindow)
    if (name === 'request') return this.#answer(fields, frameWindow, { readOnly: loading.measuredOnly })
    if (name === 'ready') loading.settle(fields)
  }

  async #answer(request, frameWindow, { readOnly }) {
    const response = await this.#sharedData.answer(request, { readOnly })
    frameWindow.postMessage({ type: `${MESSAGE_PREFIX}response`, requestId: request.requestId, ...response }, '*')
  }

  #announce(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }))
  }

  #send(name, fields) {
    this.#current.iframe.contentWindow?.postMessage({ type: `${MESSAGE_PREFIX}${name}`, ...fields }, '*')
  }

  // The overlay in the frame draws with the viewer's own colours, so pins and marks follow the theme and accent.
  static #themeOfPage() {
    const style = getComputedStyle(document.documentElement)
    const isDark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && DARK_SCHEME.matches)
    const tokens = { dim: isDark ? 'rgba(0, 0, 0, .32)' : 'rgba(17, 17, 17, .06)' }
    for (const name of THEME_TOKENS) {
      const value = style.getPropertyValue(`--${name}`).trim()
      if (value !== '') tokens[name] = value
    }
    return { theme: isDark ? 'dark' : 'light', tokens, reducedMotion: REDUCED_MOTION.matches }
  }
}
