import { DEFAULT_LOCALE } from '@open-artifact/core'
import { SDK_MESSAGES } from './i18n/sdk-messages.ts'

export const SDK_PATH = '/_sdk/open-artifact.js'

/*
 * Messages between the Open Artifact viewer page (parent) and the artifact frame. Every type starts with
 * "open-artifact:". The frame accepts messages only from the parent window at APP_ORIGIN and posts only to
 * APP_ORIGIN. The parent cannot read the frame's document (the frame has an opaque origin), so everything that
 * needs the page's DOM happens here and is reported by message.
 *
 * An anchor is the comment anchor the API stores: { x, y, version, selector, textQuote, quote }. A block is
 * { path, tag, text }: an element shown as a block with text of its own. A rect { x, y, width, height } is in
 * the frame's viewport; tops are distances from the top of the page.
 *
 * Parent to frame:
 *   response        { requestId, ok, result?, error?, status? }  answer to a shared-data request from the page
 *   sync            the viewer has started listening; a page that has already loaded says ready again
 *   language        { locale }  the viewer's language, for the few words the frame shows itself
 *   theme           { theme, tokens, reducedMotion }  the viewer's colours, as CSS custom property values
 *   mode            { commentable, commenting }  whether the viewer may comment, and comment mode
 *   pins            { pins: [{ commentId, number, anchor, state: 'open' | 'agent' | 'resolved', active }] }
 *   focus           { anchor | null }  outline the element a comment is being written about
 *   scroll-to       { anchor }  bring a comment's element to the middle of the frame
 *   restore-place   { place: { path, text, offset } }  put a block back where it was on screen; answered with scrolled
 *   wash            { paths, scroll }  flash the blocks that just changed, scrolling to the first one if asked
 *   compare         { diff | null }  mark what changed against an older version: { changed, added, removed }
 *   compare-step    { path }  scroll to one change and flash it
 *
 * Frame to parent:
 *   request         { requestId, operation, ... }  shared data and viewer calls from the page
 *   ready           { blocks }  the page has loaded
 *   target-picked   { source: 'click' | 'long-press' | 'selection', anchor, rect, label: { kind, text }, excerpt }
 *                   the viewer words the label; kind is heading, table, figure, image, video, code, quote,
 *                   listItem, paragraph, term, definition, block or selection, and text is '' or a clipped name
 *   viewport        { top: { path, text, offset } | null, focused: rect | null }  at most once a frame
 *   pins-placed     { placed, orphaned, tops }  after every layout of the pins
 *   pin-selected    { commentId }
 *   key             { key }  C, J, K, ? or Escape pressed while the page has focus and nobody is typing
 *   scrolled        after restore-place
 */

/**
 * The script injected into every artifact page. It holds no credentials: each data call is a message to the
 * Open Artifact page around the frame, which checks permissions and calls the API for the viewer. Around the
 * page it draws what commenting needs (pins, outlines, the selection button, version marks) in a shadow root,
 * so the page's CSS cannot reach it. It touches the page itself in two ways only: data-theme on <html> carries
 * the viewer's theme to a page that styles itself by it, and the cursor turns to a crosshair in comment mode.
 */
export class ArtifactSdk {
  static script(appOrigin: string): string {
    return String.raw`(() => {
  const APP_ORIGIN = ${JSON.stringify(appOrigin)}
  const MESSAGE_PREFIX = 'open-artifact:'
  const REQUEST_TIMEOUT_MS = 15000
  const IS_PREVIEW = new URLSearchParams(location.search).has('preview')
  const PREVIEW_ANSWERS = { viewer: null, list: [] }
  const pendingRequests = new Map()
  const viewerMessages = new Map()
  const MESSAGES = ${JSON.stringify(SDK_MESSAGES)}
  let words = MESSAGES[${JSON.stringify(DEFAULT_LOCALE)}]
  let requestCount = 0

  function tellViewer(name, fields) {
    window.parent.postMessage(Object.assign({ type: MESSAGE_PREFIX + name }, fields), APP_ORIGIN)
  }

  window.addEventListener('message', event => {
    const message = event.data
    const fromViewer = event.source === window.parent && event.origin === APP_ORIGIN
    const isViewerMessage = Boolean(message) && typeof message.type === 'string' && message.type.startsWith(MESSAGE_PREFIX)
    if (!fromViewer || !isViewerMessage) return
    const name = message.type.slice(MESSAGE_PREFIX.length)
    if (name === 'response') return settleRequest(message)
    const handle = viewerMessages.get(name)
    if (handle) handle(message)
  })

  // ---------- shared data: the page's calls, answered by the viewer ----------
  function settleRequest(message) {
    const waiting = pendingRequests.get(message.requestId)
    if (!waiting) return
    pendingRequests.delete(message.requestId)
    if (message.ok) waiting.resolve(message.result)
    else waiting.reject(Object.assign(new Error(message.error), { status: message.status }))
  }

  // A home-page thumbnail has nobody to answer its requests, so it renders with no viewer and no data.
  function request(operation, fields) {
    if (IS_PREVIEW) return operation in PREVIEW_ANSWERS ? Promise.resolve(PREVIEW_ANSWERS[operation]) : Promise.reject(new Error('This is a preview'))
    if (window.parent === window) return Promise.reject(new Error('Open this page from Open Artifact to use shared data'))
    const requestId = 'r' + Date.now().toString(36) + '-' + (++requestCount)
    return new Promise((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject })
      tellViewer('request', Object.assign({ requestId, operation }, fields))
      setTimeout(() => {
        if (pendingRequests.delete(requestId)) reject(new Error('Open Artifact did not answer in time'))
      }, REQUEST_TIMEOUT_MS)
    })
  }

  function newDocumentId() {
    if (crypto.randomUUID) return crypto.randomUUID()
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  }

  function collection(name) {
    return Object.freeze({
      list: () => request('list', { collection: name }),
      put: (documentId, data) => request('put', { collection: name, documentId, data }),
      add: data => request('put', { collection: name, documentId: newDocumentId(), data }),
      delete: documentId => request('delete', { collection: name, documentId }),
    })
  }

  window.openArtifact = Object.freeze({
    viewer: () => request('viewer', {}),
    db: Object.freeze({ collection }),
  })

  // A thumbnail, or the page opened in a tab of its own, has no viewer around it to comment with.
  if (IS_PREVIEW || window.parent === window) return

  const SEMANTIC_TARGETS = 'table, figure, pre, blockquote, img, svg, canvas, video, li, h1, h2, h3, h4, h5, h6, p, dt, dd'
  const OBSTACLES = 'img, svg, canvas, video, iframe, button, input, select, textarea'
  const BLOCK_DISPLAY = /^(block|list-item|table|table-row|table-cell|table-caption|flex|grid|flow-root)$/
  const TAG_KINDS = new Map([['table', 'table'], ['figure', 'figure'], ['img', 'image'], ['svg', 'figure'], ['canvas', 'figure'], ['video', 'video'], ['pre', 'code'], ['blockquote', 'quote'], ['li', 'listItem'], ['p', 'paragraph'], ['dt', 'term'], ['dd', 'definition']])
  const THEME_TOKENS = ['ink', 'paper', 'muted', 'action', 'success-solid', 'success-on-solid', 'success-tint', 'warning-solid', 'warning-on-solid', 'warning-tint', 'danger-solid', 'danger-on-solid', 'danger-text', 'dim', 'font-body']
  const FORWARDED_KEYS = new Set(['c', 'C', 'j', 'J', 'k', 'K', '?', 'Escape'])
  const EXCERPT_LENGTH = 60
  const MATCH_LENGTH = 24
  const MAX_SELECTOR_LENGTH = 512
  const MAX_QUOTE_LENGTH = 500
  const QUOTE_CONTEXT_LENGTH = 32
  const PIN_SIZE = 22
  const PIN_GAP = 4
  const LONG_PRESS_MS = 500
  const LONG_PRESS_SLOP_PX = 8
  const SELECTION_SETTLE_MS = 180
  const STEP_WASH_DELAY_MS = 320
  const SCROLL_WASH_DELAY_MS = 420
  const PIN_LEAVE_MS = 220

  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim()
  const clip = (text, length) => (text.length > length ? text.slice(0, length) + '…' : text)
  const isBlock = element => BLOCK_DISPLAY.test(getComputedStyle(element).display)
  const isPageRoot = element => element === document.body || element === document.documentElement
  const reducedMotion = () => state.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches
  const viewportRectOf = box => ({ x: box.left, y: box.top, width: box.width, height: box.height })
  const documentRectOf = element => {
    const box = element.getBoundingClientRect()
    return { left: box.left + scrollX, top: box.top + scrollY, width: box.width, height: box.height }
  }
  const overlaps = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

  // ---------- blocks: what a comment points at and what a version comparison counts ----------
  // Text that belongs to this element and not to a block nested inside it.
  function ownTextOf(element) {
    let text = ''
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent
      else if (child.nodeType === Node.ELEMENT_NODE && !isBlock(child)) text += ownTextOf(child)
    }
    return text
  }

  function sameTagPositionOf(element) {
    const siblings = Array.from(element.parentElement.children).filter(sibling => sibling.tagName === element.tagName)
    return siblings.indexOf(element) + 1
  }

  function hasUniqueId(element) {
    return Boolean(element.id) && Boolean(window.CSS && CSS.escape) && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1
  }

  // A CSS path that finds the element again in a later version: from the nearest ancestor with a unique id, or from body.
  function pathOf(element) {
    const steps = []
    for (let current = element; current && !isPageRoot(current); current = current.parentElement) {
      if (hasUniqueId(current)) return ['#' + CSS.escape(current.id)].concat(steps).join(' > ')
      steps.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + sameTagPositionOf(current) + ')')
    }
    return ['body'].concat(steps).join(' > ')
  }

  const blockIndex = {
    entries: null,
    all() {
      if (this.entries === null) this.entries = this.collect()
      return this.entries
    },
    forget() {
      this.entries = null
    },
    collect() {
      const entries = []
      if (!document.body) return entries
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      for (let element = walker.nextNode(); element; element = walker.nextNode()) {
        if (!isBlock(element)) continue
        const text = normalize(ownTextOf(element))
        if (text) entries.push({ element, path: pathOf(element), tag: element.tagName.toLowerCase(), text })
      }
      return entries
    },
    blocks() {
      return this.all().map(entry => ({ path: entry.path, tag: entry.tag, text: entry.text }))
    },
  }

  // ---------- what a comment is about ----------
  function cardOf(start) {
    for (let element = start; element.parentElement && !isPageRoot(element.parentElement); element = element.parentElement) {
      if (/grid|flex/.test(getComputedStyle(element.parentElement).display)) return element
    }
    return null
  }

  // A block with words of its own: blank margins of the page's column are not something to comment on.
  function nearestBlockWithTextOf(start) {
    for (let element = start; element && !isPageRoot(element); element = element.parentElement) {
      if (isBlock(element) && normalize(ownTextOf(element))) return element
    }
    return null
  }

  // The first semantic block around the node, where any cell stands for its whole table; else the card in a
  // grid or flex row; else the nearest block with words of its own.
  function commentTargetOf(node) {
    const start = node instanceof Element ? node : node && node.parentElement
    if (!start || isPageRoot(start) || start.hasAttribute('data-open-artifact-ui')) return null
    const semantic = start.closest(SEMANTIC_TARGETS)
    if (semantic) return semantic.closest('table') || semantic
    return cardOf(start) || nearestBlockWithTextOf(start)
  }

  function precedingHeadingOf(element) {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    const before = headings.filter(heading => heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    return before[before.length - 1] || null
  }

  function labelOf(element) {
    const tag = element.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) return { kind: 'heading', text: clip(normalize(element.textContent), 12) }
    if (tag === 'table') {
      const title = element.querySelector('caption') || precedingHeadingOf(element)
      return { kind: 'table', text: title ? clip(normalize(title.textContent), 10) : '' }
    }
    if (TAG_KINDS.has(tag)) return { kind: TAG_KINDS.get(tag), text: '' }
    return { kind: 'block', text: clip(normalize(ownTextOf(element)), 10) }
  }

  function wordsOfLabel(label) {
    const kind = words.blockKinds[label.kind]
    return label.text ? kind + ' · ' + label.text : kind
  }

  // A table is named by its caption or first row, never by all of its cells run together.
  function tableExcerptOf(table) {
    const caption = normalize(table.caption ? table.caption.textContent : '')
    if (caption) return caption
    const firstRow = table.rows[0]
    return firstRow ? Array.from(firstRow.cells).map(cell => normalize(cell.textContent)).filter(Boolean).join(' · ') : ''
  }

  function wholeExcerptOf(element) {
    const tag = element.tagName.toLowerCase()
    if (tag === 'table') return tableExcerptOf(element)
    if (tag === 'img') return normalize(element.getAttribute('alt'))
    const figureCaption = tag === 'figure' ? element.querySelector('figcaption') : null
    if (figureCaption) return normalize(figureCaption.textContent)
    return normalize(element.innerText || element.textContent)
  }

  const excerptOf = element => clip(wholeExcerptOf(element), EXCERPT_LENGTH)

  const fractionOf = (value, size) => (size > 0 ? Math.min(1, Math.max(0, value / size)) : 0)

  function pageSize() {
    const root = document.documentElement
    return { width: Math.max(root.scrollWidth, root.clientWidth), height: Math.max(root.scrollHeight, root.clientHeight) }
  }

  // The parent adds the version shown; x and y keep older readers of the anchor working.
  function anchorOf(element, quote) {
    const box = documentRectOf(element)
    const size = pageSize()
    const selector = pathOf(element)
    return {
      x: fractionOf(box.left, size.width),
      y: fractionOf(box.top, size.height),
      selector: selector.length <= MAX_SELECTOR_LENGTH ? selector : null,
      textQuote: excerptOf(element) || null,
      quote,
    }
  }

  // ---------- finding an anchor again, in this version or a later one ----------
  function startsAlike(text, quote) {
    const needle = quote.replace(/…$/, '').slice(0, MATCH_LENGTH)
    return needle !== '' && text.startsWith(needle)
  }

  function stillMatches(element, anchor) {
    if (anchor.quote) return normalize(element.textContent).includes(anchor.quote.exact)
    if (anchor.textQuote) return startsAlike(excerptOf(element), anchor.textQuote) || startsAlike(normalize(element.innerText || element.textContent), anchor.textQuote)
    return true
  }

  // A selector from a comment is untrusted text; one that does not parse matches nothing.
  function elementAtSelector(selector) {
    try {
      return selector ? document.querySelector(selector) : null
    } catch {
      return null
    }
  }

  function tagOfSelector(selector) {
    const lastStep = /([a-z][a-z0-9-]*)(?::nth-of-type\(\d+\))?$/i.exec(selector || '')
    return lastStep && !/#/.test(selector.split(' > ').pop()) ? lastStep[1].toLowerCase() : null
  }

  function candidatesOf(tag) {
    return Array.from(tag ? document.body.getElementsByTagName(tag) : document.body.querySelectorAll(SEMANTIC_TARGETS + ', div'))
  }

  // Comments written before elements were recorded hold only the spot's fractions of the page.
  function blockAtPageSpot(anchor) {
    const size = pageSize()
    const spot = { left: anchor.x * size.width, top: anchor.y * size.height, width: 1, height: 1 }
    const containing = blockIndex.all().map(entry => ({ element: entry.element, box: documentRectOf(entry.element) })).filter(candidate => overlaps(candidate.box, spot))
    containing.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)
    return containing.length > 0 ? commentTargetOf(containing[0].element) || containing[0].element : null
  }

  // By the selector while it still points at the same words; else by the words, among elements of the same kind;
  // else by the selector alone, when the element was edited in place. Otherwise the comment has lost its spot.
  function elementOfAnchor(anchor) {
    const atSelector = elementAtSelector(anchor.selector)
    const byPath = atSelector && (commentTargetOf(atSelector) || atSelector)
    if (byPath && stillMatches(byPath, anchor)) return byPath
    const hasWords = Boolean(anchor.quote || anchor.textQuote)
    const byWords = hasWords ? candidatesOf(tagOfSelector(anchor.selector)).find(candidate => stillMatches(candidate, anchor)) : null
    if (byWords) return commentTargetOf(byWords) || byWords
    if (byPath) return byPath
    return anchor.selector ? null : blockAtPageSpot(anchor)
  }

  function elementOfPlace(place) {
    const byPath = elementAtSelector(place.path)
    const matchesText = element => normalize(ownTextOf(element)).startsWith(place.text.slice(0, MATCH_LENGTH))
    if (byPath && matchesText(byPath)) return byPath
    const entry = blockIndex.all().find(candidate => candidate.text.startsWith(place.text.slice(0, MATCH_LENGTH)))
    return entry ? entry.element : byPath
  }

  // ---------- the layers drawn over the page ----------
  const OVERLAY_STYLE = [
    ':host { --ink: #111111; --paper: #ffffff; --muted: #6d6b67; --action: #111111; --success-solid: #15803d; --success-on-solid: #ffffff; --success-tint: rgba(21, 128, 61, .14); --warning-solid: #b54708; --warning-on-solid: #ffffff; --warning-tint: rgba(181, 71, 8, .14); --danger-solid: #b42318; --danger-on-solid: #ffffff; --danger-text: #b42318; --dim: rgba(17, 17, 17, .06); --font-body: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }',
    '* { box-sizing: border-box; }',
    '.outline { position: absolute; pointer-events: none; outline: 2px solid var(--action); outline-offset: 3px; box-shadow: 0 0 0 200vmax var(--dim); opacity: 0; transition: opacity 140ms ease; }',
    '.outline[data-on] { opacity: 1; transition: none; }',
    '.outline[data-steady] { box-shadow: none; }',
    '.chip { position: fixed; left: 0; top: 0; pointer-events: none; padding: 2px 8px; background: var(--ink); color: var(--paper); font: 500 12px/20px var(--font-body); white-space: nowrap; opacity: 0; }',
    '.chip[data-on] { opacity: 1; }',
    '.pin { position: absolute; display: grid; min-width: ' + PIN_SIZE + 'px; height: ' + PIN_SIZE + 'px; padding: 0; border: 0; border-radius: 0; background: none; cursor: pointer; pointer-events: auto; opacity: 0; transform: translateY(4px); transition: opacity 220ms cubic-bezier(.25, 1, .5, 1), transform 220ms cubic-bezier(.25, 1, .5, 1); }',
    '.pin[data-shown] { opacity: 1; transform: none; }',
    // A finger needs more than the 22px a pin is drawn at.
    '@media (pointer: coarse) { .pin::after { content: ""; position: absolute; top: 50%; left: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); } }',
    '.pin > span { grid-area: 1 / 1; display: grid; place-items: center; min-width: ' + PIN_SIZE + 'px; height: ' + PIN_SIZE + 'px; padding: 0 4px; border-radius: 999px; box-shadow: 0 2px 6px rgba(0, 0, 0, .18); font: 600 12px/1 var(--font-body); font-variant-numeric: tabular-nums; transition: opacity 220ms ease, transform 220ms cubic-bezier(.25, 1, .5, 1); }',
    '.number { background: var(--ink); color: var(--paper); }',
    '.pin[data-state="agent"] .number { background: var(--warning-solid); color: var(--warning-on-solid); }',
    '.done { background: var(--success-solid); color: var(--success-on-solid); opacity: 0; transform: scale(.6); }',
    '.done svg { width: 14px; height: 14px; }',
    '.pin[data-state="resolved"] .number { opacity: 0; transform: scale(.6); }',
    '.pin[data-state="resolved"] .done { opacity: 1; transform: none; }',
    '.pin[data-active] > span { box-shadow: 0 0 0 2px var(--paper), 0 0 0 3.5px var(--action); }',
    '.pin:focus-visible { outline: none; }',
    '.pin:focus-visible > span { box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--action); }',
    // Tints are solid colours over the page's text: multiplied on a light page and screened on a dark one, the text
    // stays as dark, or as light, as it was.
    '.wash { position: absolute; pointer-events: none; background: var(--success-tint); outline: 1.5px solid var(--success-solid); mix-blend-mode: multiply; opacity: 0; }',
    '.mark { position: absolute; pointer-events: none; mix-blend-mode: multiply; }',
    ':host([data-theme="dark"]) :is(.wash, .mark) { mix-blend-mode: screen; }',
    '.mark[data-kind="changed"] { background: var(--warning-tint); box-shadow: inset 2px 0 0 var(--warning-solid); }',
    '.mark[data-kind="added"] { background: var(--success-tint); box-shadow: inset 2px 0 0 var(--success-solid); }',
    '.mark b, .removed b { position: absolute; left: var(--label-x, -30px); padding: 0 4px; font: 500 12px/20px var(--font-body); }',
    '.mark b { top: 0; background: var(--warning-solid); color: var(--warning-on-solid); }',
    '.mark[data-kind="added"] b { background: var(--success-solid); color: var(--success-on-solid); }',
    '.removed { position: absolute; height: 0; border-top: 1.5px dashed var(--danger-solid); }',
    '.removed b { top: -10px; background: var(--danger-solid); color: var(--danger-on-solid); }',
    '.removed span { position: absolute; left: 0; top: 4px; max-width: 100%; padding: 0 6px; font: 400 12px/20px var(--font-body); color: var(--danger-text); background: var(--paper); text-decoration: line-through; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: auto; }',
    '.select-button { position: absolute; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--ink); border-radius: 8px; background: var(--ink); color: var(--paper); font: 500 12px/1 var(--font-body); cursor: pointer; pointer-events: auto; box-shadow: 0 4px 12px rgba(0, 0, 0, .16); opacity: 0; visibility: hidden; transform: translateY(4px); transition: opacity 140ms ease, transform 140ms cubic-bezier(.16, 1, .3, 1), visibility 0s linear 140ms; }',
    '.select-button[data-shown] { opacity: 1; visibility: visible; transform: none; transition: opacity 140ms ease, transform 140ms cubic-bezier(.16, 1, .3, 1); }',
    '.select-button:focus-visible { outline: 2px solid var(--action); outline-offset: 2px; }',
    '.select-button svg { width: 14px; height: 14px; }',
    '@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }',
    ':host([data-reduced-motion]) * { transition: none !important; }',
  ].join('\n')

  // Two layers, each as wide as the window and clipped to it, so nothing drawn here makes the page scroll sideways.
  // Pins, outlines and the selection button sit above everything; version marks and the wash sit in the page's own
  // stacking order, which lets them blend with its text instead of covering it.
  function overlayHost(name, stacking, markup) {
    const host = document.createElement('div')
    host.setAttribute('data-open-artifact-ui', name)
    host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;overflow-x:clip;overflow-y:visible;' + stacking
    host.attachShadow({ mode: 'open' }).innerHTML = '<style>' + OVERLAY_STYLE + '</style>' + markup
    return host
  }

  const marksHost = overlayHost('marks', 'pointer-events:none;', '<div class="marks"></div><div class="washes"></div>')
  const layerHost = overlayHost('pins', 'z-index:2147483000;',
    '<div class="outline"></div><div class="chip" aria-hidden="true"></div>' +
    '<div class="pins" role="group"></div>' +
    '<button class="select-button" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter" aria-hidden="true"><path d="M3.5 4.5h17v12h-11l-6 4z"/></svg><span></span></button>')
  const overlayHosts = [marksHost, layerHost]
  const shadow = layerHost.shadowRoot
  const outline = shadow.querySelector('.outline')
  const chip = shadow.querySelector('.chip')
  const markLayer = marksHost.shadowRoot.querySelector('.marks')
  const washLayer = marksHost.shadowRoot.querySelector('.washes')
  const pinLayer = shadow.querySelector('.pins')
  const selectButton = shadow.querySelector('.select-button')
  function wordOverlay() {
    pinLayer.setAttribute('aria-label', words.pins)
    selectButton.setAttribute('aria-label', words.commentSelection)
    selectButton.querySelector('span').textContent = words.comment
  }
  wordOverlay()
  const quoteHighlightStyle = document.createElement('style')
  quoteHighlightStyle.setAttribute('data-open-artifact-ui', '')

  const state = { commentable: false, commenting: false, reducedMotion: false, pins: [], diff: null }
  let hovered = null
  let focused = null
  let pendingSelection = null

  const place = (element, box, inflate) => {
    element.style.left = box.left - inflate + 'px'
    element.style.top = box.top - inflate + 'px'
    element.style.width = box.width + inflate * 2 + 'px'
    element.style.height = box.height + inflate * 2 + 'px'
  }

  function showOutline(element, steady) {
    if (!element) return outline.removeAttribute('data-on')
    place(outline, documentRectOf(element), 0)
    outline.toggleAttribute('data-steady', steady)
    outline.setAttribute('data-on', '')
  }

  function hideHover() {
    hovered = null
    chip.removeAttribute('data-on')
    if (!focused) showOutline(null)
  }

  // ---------- pins ----------
  function rectMeasurer() {
    const rects = new Map()
    return element => {
      if (!rects.has(element)) rects.set(element, documentRectOf(element))
      return rects.get(element)
    }
  }

  // Text, pictures and controls a pin must not cover; the block it marks, and what contains it, do not count.
  function obstaclesAround(target, candidates, measure) {
    const siblings = target.parentElement ? Array.from(target.parentElement.children) : []
    const isElsewhere = element => element !== target && !element.contains(target) && !target.contains(element)
    return candidates.concat(siblings).filter(isElsewhere).map(measure)
  }

  // The end of the block's last line, where text usually stops short of the right edge.
  function afterLastLineOf(target, step) {
    const range = document.createRange()
    range.selectNodeContents(target)
    const lineBoxes = range.getClientRects()
    const lastLine = lineBoxes[lineBoxes.length - 1]
    if (!lastLine) return null
    return { left: lastLine.right + scrollX + PIN_GAP + step, top: lastLine.top + scrollY + (lastLine.height - PIN_SIZE) / 2, width: PIN_SIZE, height: PIN_SIZE }
  }

  // In order: beside the block's first line when the page has room on its right; just above its top-right corner
  // when there is a gap; after its last line when that line ends short; straddling the corner only when nothing
  // else is free. A pin never covers the text it points at if the page leaves it any room.
  function pinPositionOf(target, box, stackIndex, obstacles) {
    const pageRight = scrollX + document.documentElement.clientWidth - PIN_GAP
    const blockRight = box.left + box.width
    const step = stackIndex * (PIN_SIZE + PIN_GAP)
    const isClear = spot => !obstacles.some(obstacle => overlaps(obstacle, spot))
    const beside = { left: blockRight + PIN_GAP + step, top: box.top, width: PIN_SIZE, height: PIN_SIZE }
    if (beside.left + PIN_SIZE <= pageRight && isClear(beside)) return beside
    const rightEdge = Math.min(blockRight, pageRight)
    const above = { left: Math.max(scrollX + PIN_GAP, rightEdge - PIN_SIZE - step), top: Math.max(PIN_GAP, box.top - PIN_SIZE - 2), width: PIN_SIZE, height: PIN_SIZE }
    if (isClear(above)) return above
    const afterText = afterLastLineOf(target, step)
    if (afterText && afterText.left + PIN_SIZE <= Math.min(blockRight, pageRight) && isClear(afterText)) return afterText
    return { left: above.left, top: Math.max(PIN_GAP, box.top - PIN_SIZE / 2), width: PIN_SIZE, height: PIN_SIZE }
  }

  function newPinButton(commentId) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pin'
    button.dataset.commentId = commentId
    button.innerHTML = '<span class="number"></span><span class="done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>'
    button.addEventListener('click', event => {
      event.stopPropagation()
      tellViewer('pin-selected', { commentId: button.dataset.commentId })
    })
    pinLayer.append(button)
    requestAnimationFrame(() => requestAnimationFrame(() => button.setAttribute('data-shown', '')))
    return button
  }

  function dressPin(button, pin) {
    button.querySelector('.number').textContent = String(pin.number)
    button.dataset.state = pin.state
    button.toggleAttribute('data-active', Boolean(pin.active))
    button.setAttribute('aria-label', (pin.state === 'resolved' ? words.resolvedPin : words.pin).replace('{number}', pin.number))
  }

  function removePin(button) {
    button.removeAttribute('data-shown')
    setTimeout(() => button.remove(), reducedMotion() ? 0 : PIN_LEAVE_MS)
  }

  function renderPins() {
    const placed = []
    const orphaned = []
    const tops = {}
    const existing = new Map(Array.from(pinLayer.children).map(button => [button.dataset.commentId, button]))
    const pinsOnTarget = new Map()
    const measure = rectMeasurer()
    const candidates = blockIndex.all().map(entry => entry.element).concat(Array.from(document.body.querySelectorAll(OBSTACLES)))
    for (const pin of state.pins) {
      const target = elementOfAnchor(pin.anchor)
      if (!target) {
        orphaned.push(pin.commentId)
        continue
      }
      const button = existing.get(pin.commentId) || newPinButton(pin.commentId)
      existing.delete(pin.commentId)
      dressPin(button, pin)
      const stackIndex = pinsOnTarget.get(target) || 0
      pinsOnTarget.set(target, stackIndex + 1)
      const position = pinPositionOf(target, measure(target), stackIndex, obstaclesAround(target, candidates, measure))
      button.style.left = position.left + 'px'
      button.style.top = position.top + 'px'
      placed.push(pin.commentId)
      tops[pin.commentId] = Math.round(position.top)
    }
    for (const leftover of existing.values()) removePin(leftover)
    return { placed, orphaned, tops }
  }

  function rangeOfQuote(anchor) {
    const container = elementOfAnchor(anchor)
    if (!container) return null
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf(anchor.quote.exact)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + anchor.quote.exact.length)
      return range
    }
    return null
  }

  // The selected words of the comment being written, or of the active comment, stay marked without touching the page's DOM.
  function renderQuoteHighlight() {
    if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function') return
    CSS.highlights.delete('open-artifact-quote')
    const activeQuoted = state.pins.find(pin => pin.active && pin.anchor.quote)
    const range = pendingSelection || (activeQuoted ? rangeOfQuote(activeQuoted.anchor) : null)
    if (range) CSS.highlights.set('open-artifact-quote', new Highlight(range))
  }

  // ---------- what changed between versions ----------
  function labelOffsetOf(element, box) {
    const edge = documentRectOf(element.closest('table') || element).left
    const roomOnLeft = edge - scrollX
    return roomOnLeft >= 30 ? edge - box.left - 30 : edge - box.left
  }

  function addMark(path, kind, before) {
    const element = elementAtSelector(path)
    if (!element) return
    const mark = document.createElement('div')
    mark.className = 'mark'
    mark.dataset.kind = kind
    mark.innerHTML = '<b></b>'
    mark.querySelector('b').textContent = words.marks[kind]
    if (before) mark.title = words.was + before
    const box = documentRectOf(element)
    place(mark, box, element.closest('table') ? 0 : 4)
    mark.style.setProperty('--label-x', labelOffsetOf(element, box) + 'px')
    markLayer.append(mark)
  }

  function addRemovedLine(removal) {
    const before = removal.afterPath ? elementAtSelector(removal.afterPath) : null
    const container = before ? before.closest('table') || before : null
    const row = before ? documentRectOf(before.closest('tr') || before) : null
    const box = container ? documentRectOf(container) : { left: 32, top: 8, width: 600, height: 0 }
    const line = document.createElement('div')
    line.className = 'removed'
    line.innerHTML = '<b></b><span></span>'
    line.querySelector('b').textContent = words.marks.removed
    line.querySelector('span').textContent = removal.text
    line.title = words.removed + removal.text
    line.style.left = box.left + 'px'
    line.style.top = (row ? row.top + row.height : box.top) + 6 + 'px'
    line.style.width = box.width + 'px'
    line.style.setProperty('--label-x', (box.left - scrollX >= 30 ? -30 : 0) + 'px')
    markLayer.append(line)
  }

  function renderDiff() {
    markLayer.replaceChildren()
    if (!state.diff) return
    for (const change of state.diff.changed) addMark(change.path, 'changed', change.before)
    for (const path of state.diff.added) addMark(path, 'added', null)
    for (const removal of state.diff.removed) addRemovedLine(removal)
  }

  function wash(paths) {
    const reduce = reducedMotion()
    for (const element of paths.map(elementAtSelector).filter(Boolean)) {
      const box = document.createElement('div')
      box.className = 'wash'
      place(box, documentRectOf(element), 4)
      washLayer.append(box)
      const keyframes = reduce ? [{ opacity: 1 }, { opacity: 1 }] : [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }]
      const animation = box.animate(keyframes, { duration: reduce ? 1600 : 2000, easing: 'cubic-bezier(.25, 1, .5, 1)' })
      animation.onfinish = () => box.remove()
    }
  }

  function scrollToElement(element) {
    element.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'instant' : 'smooth' })
  }

  function isOnScreen(element) {
    const box = element.getBoundingClientRect()
    return box.top >= 0 && box.bottom <= innerHeight
  }

  // ---------- reports to the viewer ----------
  function topVisibleBlock() {
    for (const entry of blockIndex.all()) {
      const box = entry.element.getBoundingClientRect()
      if (box.bottom > 0) return { path: entry.path, text: entry.text.slice(0, EXCERPT_LENGTH), offset: Math.round(box.top) }
    }
    return null
  }

  // What the comment being written is about: the selected words when there are some, else the element.
  function focusedBoxOf() {
    if (pendingSelection) return pendingSelection.getBoundingClientRect()
    return focused ? focused.getBoundingClientRect() : null
  }

  let viewportReportQueued = false
  function reportViewport() {
    if (viewportReportQueued) return
    viewportReportQueued = true
    requestAnimationFrame(() => {
      viewportReportQueued = false
      const focusedBox = focusedBoxOf()
      tellViewer('viewport', { top: topVisibleBlock(), focused: focusedBox ? viewportRectOf(focusedBox) : null })
    })
  }

  let layoutQueued = false
  function layout() {
    if (layoutQueued || !layerHost.isConnected) return
    layoutQueued = true
    requestAnimationFrame(() => {
      layoutQueued = false
      const pinPlacement = renderPins()
      renderDiff()
      renderQuoteHighlight()
      if (focused) showOutline(focused, true)
      else if (hovered) showOutline(hovered, false)
      tellViewer('pins-placed', pinPlacement)
      reportViewport()
    })
  }

  function pick(target, source) {
    focused = target
    hideHover()
    showOutline(target, true)
    tellViewer('target-picked', { source, anchor: anchorOf(target, null), rect: viewportRectOf(target.getBoundingClientRect()), label: labelOf(target), excerpt: excerptOf(target) })
  }

  // ---------- comment mode: the outline and its label follow the pointer; a click picks ----------
  function followPointer(event) {
    if (!state.commenting || focused) return
    const target = commentTargetOf(event.target)
    hovered = target
    if (!target) return hideHover()
    showOutline(target, false)
    chip.textContent = wordsOfLabel(labelOf(target))
    const chipLeft = Math.min(event.clientX + 14, innerWidth - chip.offsetWidth - 8)
    const nearBottom = event.clientY + 44 > innerHeight
    chip.style.transform = 'translate(' + Math.max(8, chipLeft) + 'px, ' + (nearBottom ? event.clientY - 30 : event.clientY + 20) + 'px)'
    chip.setAttribute('data-on', '')
  }

  let suppressNextClick = false
  function pickOnClick(event) {
    if (suppressNextClick) {
      suppressNextClick = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!state.commenting || event.composedPath().includes(layerHost)) return
    event.preventDefault()
    event.stopPropagation()
    const target = commentTargetOf(event.target)
    if (target) pick(target, 'click')
  }

  // ---------- on a phone, a long press anywhere picks ----------
  const longPress = { timer: 0, start: null }
  function startLongPress(event) {
    // A phone sends no click after a long press, so the click it would have swallowed is never coming.
    suppressNextClick = false
    const canPress = state.commentable && !state.commenting && event.pointerType === 'touch'
    if (!canPress) return
    const target = commentTargetOf(event.target)
    clearTimeout(longPress.timer)
    if (!target) return
    longPress.start = { x: event.clientX, y: event.clientY }
    longPress.timer = setTimeout(() => {
      suppressNextClick = true
      if (navigator.vibrate) navigator.vibrate(10)
      getSelection().removeAllRanges()
      pick(target, 'long-press')
    }, LONG_PRESS_MS)
  }

  function cancelLongPressOnMove(event) {
    if (longPress.start && Math.hypot(event.clientX - longPress.start.x, event.clientY - longPress.start.y) > LONG_PRESS_SLOP_PX) clearTimeout(longPress.timer)
  }

  function endLongPress() {
    clearTimeout(longPress.timer)
    longPress.start = null
  }

  // ---------- selected words get a comment button ----------
  function selectedRange() {
    const selection = getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!normalize(range.toString())) return null
    const container = range.commonAncestorContainer
    const element = container instanceof Element ? container : container.parentElement
    const insideField = !element || element.closest('input, textarea, [contenteditable]')
    return insideField ? null : range
  }

  function placeSelectButton() {
    const range = state.commentable && !state.commenting ? selectedRange() : null
    if (!range) return selectButton.removeAttribute('data-shown')
    const lineBoxes = range.getClientRects()
    const lastLine = lineBoxes[lineBoxes.length - 1] || range.getBoundingClientRect()
    const fitsAbove = lastLine.top - 34 >= 4
    selectButton.style.left = Math.min(lastLine.right + scrollX + 6, document.documentElement.clientWidth + scrollX - 80) + 'px'
    selectButton.style.top = (fitsAbove ? lastLine.top - 34 : lastLine.bottom + 6) + scrollY + 'px'
    selectButton.setAttribute('data-shown', '')
  }

  function quoteOf(range, block) {
    const selected = range.toString()
    const blockText = block.textContent
    const at = blockText.indexOf(selected)
    const prefix = at > 0 ? blockText.slice(Math.max(0, at - QUOTE_CONTEXT_LENGTH), at) : ''
    const suffix = at >= 0 ? blockText.slice(at + selected.length, at + selected.length + QUOTE_CONTEXT_LENGTH) : ''
    return { exact: normalize(selected).slice(0, MAX_QUOTE_LENGTH), prefix: normalize(prefix), suffix: normalize(suffix) }
  }

  function pickSelection(event) {
    event.stopPropagation()
    const range = selectedRange()
    const block = range ? commentTargetOf(range.startContainer) : null
    if (!block) return
    const quote = quoteOf(range, block)
    pendingSelection = range.cloneRange()
    focused = block
    selectButton.removeAttribute('data-shown')
    renderQuoteHighlight()
    getSelection().removeAllRanges()
    tellViewer('target-picked', { source: 'selection', anchor: anchorOf(block, quote), rect: viewportRectOf(range.getBoundingClientRect()), label: { kind: 'selection', text: '' }, excerpt: clip(quote.exact, EXCERPT_LENGTH) })
  }

  // ---------- keys the viewer owns ----------
  function forwardKey(event) {
    const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')
    const modified = event.metaKey || event.ctrlKey || event.altKey
    if (event.repeat || event.isComposing || modified || typing || !FORWARDED_KEYS.has(event.key)) return
    tellViewer('key', { key: event.key })
  }

  // ---------- messages from the viewer ----------
  viewerMessages.set('sync', () => {
    if (document.readyState === 'complete') reportReady()
  })
  viewerMessages.set('language', message => {
    words = MESSAGES[Object.hasOwn(MESSAGES, message.locale) ? message.locale : ${JSON.stringify(DEFAULT_LOCALE)}]
    wordOverlay()
    layout()
  })
  viewerMessages.set('theme', message => {
    const theme = message.theme === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    for (const host of overlayHosts) host.dataset.theme = theme
    state.reducedMotion = Boolean(message.reducedMotion)
    for (const host of overlayHosts) host.toggleAttribute('data-reduced-motion', state.reducedMotion)
    const tokens = message.tokens || {}
    for (const name of THEME_TOKENS) {
      if (typeof tokens[name] !== 'string') continue
      for (const host of overlayHosts) host.style.setProperty('--' + name, tokens[name])
    }
    const quoteColor = typeof tokens['warning-tint'] === 'string' ? tokens['warning-tint'] : 'rgba(181, 71, 8, .22)'
    quoteHighlightStyle.textContent = '::highlight(open-artifact-quote) { background-color: ' + quoteColor + '; color: inherit; }'
    layout()
  })
  viewerMessages.set('mode', message => {
    state.commentable = Boolean(message.commentable)
    state.commenting = state.commentable && Boolean(message.commenting)
    document.documentElement.style.cursor = state.commenting ? 'crosshair' : ''
    if (state.commenting) {
      getSelection().removeAllRanges()
      selectButton.removeAttribute('data-shown')
    } else hideHover()
  })
  viewerMessages.set('pins', message => {
    state.pins = Array.isArray(message.pins) ? message.pins : []
    layout()
  })
  viewerMessages.set('focus', message => {
    focused = message.anchor ? elementOfAnchor(message.anchor) : null
    if (!focused) pendingSelection = null
    renderQuoteHighlight()
    showOutline(focused, true)
    reportViewport()
  })
  viewerMessages.set('scroll-to', message => {
    const element = message.anchor ? elementOfAnchor(message.anchor) : null
    if (element) scrollToElement(element)
  })
  viewerMessages.set('restore-place', message => {
    const element = message.place ? elementOfPlace(message.place) : null
    if (element) scrollTo({ top: element.getBoundingClientRect().top + scrollY - message.place.offset, behavior: 'instant' })
    tellViewer('scrolled', {})
  })
  viewerMessages.set('wash', message => {
    const paths = Array.isArray(message.paths) ? message.paths : []
    const first = paths.map(elementAtSelector).find(Boolean)
    const scrollFirst = Boolean(message.scroll) && first && !isOnScreen(first)
    if (scrollFirst) scrollToElement(first)
    setTimeout(() => wash(paths), scrollFirst && !reducedMotion() ? SCROLL_WASH_DELAY_MS : 0)
  })
  viewerMessages.set('compare', message => {
    state.diff = message.diff || null
    renderDiff()
  })
  viewerMessages.set('compare-step', message => {
    const element = elementAtSelector(message.path)
    if (!element) return
    scrollToElement(element)
    setTimeout(() => wash([message.path]), reducedMotion() ? 0 : STEP_WASH_DELAY_MS)
  })

  // ---------- start ----------
  function watchPage() {
    document.documentElement.append(marksHost, layerHost)
    document.head.append(quoteHighlightStyle)
    document.addEventListener('pointermove', followPointer)
    document.addEventListener('pointermove', cancelLongPressOnMove)
    document.addEventListener('pointerdown', startLongPress)
    document.addEventListener('pointerup', endLongPress)
    document.addEventListener('pointercancel', endLongPress)
    document.addEventListener('contextmenu', event => { if (suppressNextClick || longPress.start) event.preventDefault() })
    document.addEventListener('click', pickOnClick, true)
    document.documentElement.addEventListener('pointerleave', () => { if (!focused) hideHover() })
    document.addEventListener('keydown', forwardKey)
    let selectionTimer = 0
    document.addEventListener('selectionchange', () => {
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(placeSelectButton, SELECTION_SETTLE_MS)
    })
    selectButton.addEventListener('pointerdown', event => event.preventDefault())
    selectButton.addEventListener('click', pickSelection)
    addEventListener('scroll', () => {
      reportViewport()
      if (selectButton.hasAttribute('data-shown')) placeSelectButton()
    }, { passive: true })
    addEventListener('resize', layout)
    // Images loading, fonts swapping and scripts adding content move elements; pins and marks follow them.
    new MutationObserver(() => {
      blockIndex.forget()
      layout()
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
    if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(document.body)
    if (document.fonts) document.fonts.ready.then(layout)
    layout()
  }

  function reportReady() {
    blockIndex.forget()
    tellViewer('ready', { blocks: blockIndex.blocks() })
    layout()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPage)
  else watchPage()
  if (document.readyState === 'complete') reportReady()
  else addEventListener('load', reportReady)
})()
`
  }
}
