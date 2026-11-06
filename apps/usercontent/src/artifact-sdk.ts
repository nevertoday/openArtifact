export const SDK_PATH = '/_sdk/open-artifact.js'

/*
 * Messages between the Open Artifact page (parent) and the artifact frame. The frame accepts messages only from
 * the parent window at APP_ORIGIN and posts only to APP_ORIGIN.
 *
 * Parent to frame:
 *   open-artifact:response        { requestId, ok, result?, error?, status? }  answer to a request from the page
 *   open-artifact:pins            { pins: [{ commentId, number, forAgent, x, y, selector? }] }  draw comment pins
 *   open-artifact:pick-anchor     start picking a spot: the element under the pointer is outlined
 *   open-artifact:cancel-pick     stop picking
 *   open-artifact:measure-anchor  { selector }  ask where an element is now; answered with anchor-measured
 *   open-artifact:track-scroll    { enabled }  while a comment popover is open, report scrolling with frame-scrolled
 *
 * Frame to parent:
 *   open-artifact:request         { requestId, operation, ... }  shared data and viewer calls from the page
 *   open-artifact:anchor-picked   { anchor: { x, y, version, selector, textQuote }, placement: { rect, scroll } }
 *   open-artifact:anchor-cancelled  the person pressed Escape while picking
 *   open-artifact:pin-selected    { commentId }
 *   open-artifact:anchor-measured { selector, rect, scroll }  rect is null when the selector matches nothing
 *   open-artifact:frame-scrolled  { scroll, viewport }  at most every 50 ms
 *
 * x and y are fractions of the page's width and height. A rect { top, left, width, height } is relative to the
 * frame's viewport; scroll { x, y } is the frame's scroll offset; viewport { width, height } its size.
 */

/**
 * The script injected into every artifact page. It holds no credentials: each call is a message to the
 * Open Artifact page around the frame, which checks permissions and calls the API for the viewer.
 * It also draws the comment pins and lets the viewer pick an element to comment on.
 */
export class ArtifactSdk {
  static script(appOrigin: string): string {
    return `(() => {
  const APP_ORIGIN = ${JSON.stringify(appOrigin)}
  const TIMEOUT_MS = 15000
  const pending = new Map()
  let requestCount = 0

  window.addEventListener('message', event => {
    const message = event.data
    const fromOpenArtifact = event.source === window.parent && event.origin === APP_ORIGIN
    if (!fromOpenArtifact || !message) return
    if (message.type === 'open-artifact:pins') return commentPins.show(message.pins)
    if (message.type === 'open-artifact:pick-anchor') return anchorPicker.start()
    if (message.type === 'open-artifact:cancel-pick') return anchorPicker.stop()
    if (message.type === 'open-artifact:measure-anchor') return pageGeometry.reportElement(String(message.selector || ''))
    if (message.type === 'open-artifact:track-scroll') return pageGeometry.trackScroll(message.enabled === true)
    if (message.type !== 'open-artifact:response') return
    const waiting = pending.get(message.requestId)
    if (!waiting) return
    pending.delete(message.requestId)
    if (message.ok) waiting.resolve(message.result)
    else waiting.reject(Object.assign(new Error(message.error), { status: message.status }))
  })

  // A home-page thumbnail has nobody to answer its requests, so it renders with no viewer and no data.
  const IS_PREVIEW = new URLSearchParams(location.search).has('preview')
  const PREVIEW_ANSWERS = { viewer: null, list: [] }

  function request(operation, fields) {
    if (IS_PREVIEW) return operation in PREVIEW_ANSWERS ? Promise.resolve(PREVIEW_ANSWERS[operation]) : Promise.reject(new Error('This is a preview'))
    if (window.parent === window) return Promise.reject(new Error('Open this page from Open Artifact to use shared data'))
    const requestId = 'r' + Date.now().toString(36) + '-' + (++requestCount)
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      window.parent.postMessage(Object.assign({ type: 'open-artifact:request', requestId, operation }, fields), APP_ORIGIN)
      setTimeout(() => {
        if (pending.delete(requestId)) reject(new Error('Open Artifact did not answer in time'))
      }, TIMEOUT_MS)
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

  function tellParent(message) {
    window.parent.postMessage(message, APP_ORIGIN)
  }

  // Elements the SDK adds to the page carry this attribute, so they are never picked or measured as page content.
  const SDK_UI = 'data-open-artifact-ui'
  const PIN_COLOR = '#1d5bd8'
  const SCROLL_REPORT_MS = 50
  const SHOWN_VERSION = (() => {
    const versionInPath = /\\/v(\\d+)\\//.exec(location.pathname)
    return versionInPath ? Number(versionInPath[1]) : null
  })()

  const pageGeometry = {
    tracking: false,
    reportPending: false,
    scrolledSinceReport: false,
    pageSize() {
      const root = document.documentElement
      return { width: Math.max(root.scrollWidth, root.clientWidth), height: Math.max(root.scrollHeight, root.clientHeight) }
    },
    scroll() {
      return { x: window.scrollX, y: window.scrollY }
    },
    viewportRect(element) {
      const box = element.getBoundingClientRect()
      return { top: box.top, left: box.left, width: box.width, height: box.height }
    },
    // A selector from a comment is untrusted text; one that does not parse matches nothing.
    find(selector) {
      if (!selector) return null
      try {
        const element = document.querySelector(selector)
        return element && !element.closest('[' + SDK_UI + ']') ? element : null
      } catch {
        return null
      }
    },
    reportElement(selector) {
      const element = this.find(selector)
      tellParent({ type: 'open-artifact:anchor-measured', selector, rect: element ? this.viewportRect(element) : null, scroll: this.scroll() })
    },
    trackScroll(enabled) {
      this.tracking = enabled
      if (enabled) this.reportScroll()
    },
    // The first scroll is reported at once, then at most every SCROLL_REPORT_MS; the last position is always sent.
    reportScroll() {
      if (!this.tracking) return
      if (this.reportPending) {
        this.scrolledSinceReport = true
        return
      }
      tellParent({ type: 'open-artifact:frame-scrolled', scroll: this.scroll(), viewport: { width: window.innerWidth, height: window.innerHeight } })
      this.reportPending = true
      setTimeout(() => {
        this.reportPending = false
        if (!this.scrolledSinceReport) return
        this.scrolledSinceReport = false
        this.reportScroll()
      }, SCROLL_REPORT_MS)
    },
  }
  window.addEventListener('scroll', () => pageGeometry.reportScroll(), { passive: true })
  window.addEventListener('resize', () => pageGeometry.reportScroll())

  // A short CSS path to an element: from the nearest ancestor with a unique id, or from body.
  function selectorOf(element) {
    const steps = []
    let current = element
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
        steps.unshift('#' + CSS.escape(current.id))
        return steps.join(' > ')
      }
      const tagName = current.tagName.toLowerCase()
      const siblings = current.parentElement ? Array.from(current.parentElement.children) : []
      const sameTagSiblings = siblings.filter(sibling => sibling.tagName === current.tagName)
      steps.unshift(sameTagSiblings.length > 1 ? tagName + ':nth-of-type(' + (sameTagSiblings.indexOf(current) + 1) + ')' : tagName)
      current = current.parentElement
    }
    steps.unshift('body')
    return steps.join(' > ')
  }

  function textQuoteOf(element) {
    const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim()
    return text ? text.slice(0, 120) : null
  }

  // Pins sit on the element they were placed on while its selector still matches, and at their page fractions otherwise.
  const commentPins = {
    layer: null,
    pins: [],
    renderRequested: false,
    show(pins) {
      this.pins = Array.isArray(pins) ? pins : []
      this.render()
    },
    renderSoon() {
      if (this.renderRequested) return
      this.renderRequested = true
      requestAnimationFrame(() => {
        this.renderRequested = false
        this.render()
      })
    },
    // The click spot is kept while it still falls on the element; otherwise the pin moves to the element's corner.
    positionOf(pin, pageSize) {
      const spot = { left: pin.x * pageSize.width, top: pin.y * pageSize.height }
      const element = pageGeometry.find(pin.selector)
      if (!element) return spot
      const box = element.getBoundingClientRect()
      const left = box.left + window.scrollX
      const top = box.top + window.scrollY
      const spotOnElement = spot.left >= left && spot.left <= left + box.width && spot.top >= top && spot.top <= top + box.height
      if (spotOnElement) return spot
      return { left: left + Math.min(12, box.width / 2), top: top + Math.min(12, box.height / 2) }
    },
    render() {
      if (this.layer) this.layer.remove()
      this.layer = null
      if (this.pins.length === 0 || !document.body) return
      const pageSize = pageGeometry.pageSize()
      const layer = document.createElement('div')
      layer.setAttribute(SDK_UI, '')
      layer.setAttribute('aria-label', 'comment pins')
      layer.style.cssText = 'position:absolute;left:0;top:0;width:' + pageSize.width + 'px;height:' + pageSize.height + 'px;pointer-events:none;z-index:2147483000'
      for (const pin of this.pins) {
        const position = this.positionOf(pin, pageSize)
        const marker = document.createElement('button')
        marker.type = 'button'
        marker.textContent = String(pin.number)
        marker.title = 'Comment ' + pin.number
        const background = pin.forAgent ? '#f0b860' : PIN_COLOR
        const color = pin.forAgent ? '#16202c' : '#ffffff'
        marker.style.cssText = 'position:absolute;left:' + (position.left - 13) + 'px;top:' + (position.top - 13) + 'px;width:26px;height:26px;border-radius:50% 50% 50% 4px;border:2px solid #ffffff;background:' + background + ';color:' + color + ';font:700 12px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto;box-shadow:0 2px 6px rgba(15,20,27,.3);padding:0'
        marker.addEventListener('click', () => tellParent({ type: 'open-artifact:pin-selected', commentId: pin.commentId }))
        layer.append(marker)
      }
      this.layer = layer
      document.body.append(layer)
    },
  }
  window.addEventListener('resize', () => commentPins.renderSoon())
  // Images loading, fonts swapping and scripts adding content move elements; pins follow them. The root is watched
  // as well as body, because a child's margin can collapse through body and move content without resizing it.
  if (typeof ResizeObserver === 'function') {
    const observePage = () => {
      const pageObserver = new ResizeObserver(() => commentPins.renderSoon())
      pageObserver.observe(document.documentElement)
      pageObserver.observe(document.body)
    }
    if (document.body) observePage()
    else document.addEventListener('DOMContentLoaded', observePage)
  }

  // While picking, a transparent sheet over the page catches the click so the page itself does not react,
  // and an outline, drawn apart from the page's own elements so nothing shifts, follows the element under the pointer.
  const anchorPicker = {
    sheet: null,
    outline: null,
    elementAt(clientX, clientY) {
      const candidates = document.elementsFromPoint(clientX, clientY)
      const pageElement = candidates.find(candidate => !candidate.closest('[' + SDK_UI + ']') && candidate !== document.documentElement)
      return pageElement || document.body
    },
    outlineElement(element) {
      const box = element.getBoundingClientRect()
      this.outline.style.left = box.left + window.scrollX + 'px'
      this.outline.style.top = box.top + window.scrollY + 'px'
      this.outline.style.width = box.width + 'px'
      this.outline.style.height = box.height + 'px'
      this.outline.style.display = 'block'
    },
    start() {
      this.stop()
      if (!document.body) return
      const pageSize = pageGeometry.pageSize()
      const sheet = document.createElement('div')
      sheet.setAttribute(SDK_UI, '')
      sheet.style.cssText = 'position:absolute;left:0;top:0;width:' + pageSize.width + 'px;height:' + pageSize.height + 'px;cursor:crosshair;z-index:2147483001;background:transparent'
      const outline = document.createElement('div')
      outline.setAttribute(SDK_UI, '')
      outline.style.cssText = 'position:absolute;display:none;pointer-events:none;box-sizing:border-box;outline:2px solid ' + PIN_COLOR + ';outline-offset:3px;border-radius:2px;z-index:2147483002'
      sheet.addEventListener('mousemove', event => this.outlineElement(this.elementAt(event.clientX, event.clientY)))
      sheet.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        this.pick(this.elementAt(event.clientX, event.clientY), event)
      })
      window.addEventListener('keydown', cancelPickOnEscape)
      this.sheet = sheet
      this.outline = outline
      document.body.append(sheet, outline)
    },
    pick(element, clickEvent) {
      const pageSize = pageGeometry.pageSize()
      const pickedPageItself = element === document.body
      const anchor = {
        x: Math.min(1, Math.max(0, clickEvent.pageX / pageSize.width)),
        y: Math.min(1, Math.max(0, clickEvent.pageY / pageSize.height)),
        version: SHOWN_VERSION,
        selector: pickedPageItself ? null : selectorOf(element),
        textQuote: pickedPageItself ? null : textQuoteOf(element),
      }
      const placement = { rect: pageGeometry.viewportRect(element), scroll: pageGeometry.scroll() }
      this.stop()
      tellParent({ type: 'open-artifact:anchor-picked', anchor, placement })
    },
    stop() {
      if (this.sheet) this.sheet.remove()
      if (this.outline) this.outline.remove()
      this.sheet = null
      this.outline = null
      window.removeEventListener('keydown', cancelPickOnEscape)
    },
  }

  function cancelPickOnEscape(event) {
    if (event.key !== 'Escape') return
    anchorPicker.stop()
    tellParent({ type: 'open-artifact:anchor-cancelled' })
  }

  window.openArtifact = Object.freeze({
    viewer: () => request('viewer', {}),
    db: Object.freeze({ collection }),
  })
})()
`
  }
}
