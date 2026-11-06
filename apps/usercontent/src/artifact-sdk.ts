export const SDK_PATH = '/_sdk/open-artifact.js'

/**
 * The script injected into every artifact page. It holds no credentials: each call is a message to the
 * Open Artifact page around the frame, which checks permissions and calls the API for the viewer.
 * It also draws the comment pins and lets the viewer pick a spot to comment on.
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
    if (message.type === 'open-artifact:pick-anchor') return commentPins.pickSpot()
    if (message.type === 'open-artifact:cancel-pick') return commentPins.stopPicking()
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

  // Pins sit at fractions of the page's size, so they stay on the same spot at any width.
  const commentPins = {
    layer: null,
    pins: [],
    pageSize() {
      const root = document.documentElement
      return { width: Math.max(root.scrollWidth, root.clientWidth), height: Math.max(root.scrollHeight, root.clientHeight) }
    },
    show(pins) {
      this.pins = Array.isArray(pins) ? pins : []
      this.render()
    },
    render() {
      if (this.layer) this.layer.remove()
      if (this.pins.length === 0 || !document.body) return
      const { width, height } = this.pageSize()
      this.layer = document.createElement('div')
      this.layer.setAttribute('aria-label', 'comment pins')
      this.layer.style.cssText = 'position:absolute;left:0;top:0;width:' + width + 'px;height:' + height + 'px;pointer-events:none;z-index:2147483000'
      for (const pin of this.pins) {
        const marker = document.createElement('button')
        marker.type = 'button'
        marker.textContent = String(pin.number)
        marker.title = 'Comment ' + pin.number
        const background = pin.forAgent ? '#f0b860' : '#1d5bd8'
        const color = pin.forAgent ? '#16202c' : '#ffffff'
        marker.style.cssText = 'position:absolute;left:' + (pin.x * width - 13) + 'px;top:' + (pin.y * height - 13) + 'px;width:26px;height:26px;border-radius:50% 50% 50% 4px;border:2px solid #ffffff;background:' + background + ';color:' + color + ';font:700 12px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto;box-shadow:0 2px 6px rgba(15,20,27,.3);padding:0'
        marker.addEventListener('click', () => window.parent.postMessage({ type: 'open-artifact:pin-selected', commentId: pin.commentId }, APP_ORIGIN))
        this.layer.append(marker)
      }
      document.body.append(this.layer)
    },
    pickingOverlay: null,
    stopPicking() {
      if (this.pickingOverlay) this.pickingOverlay.remove()
      this.pickingOverlay = null
    },
    pickSpot() {
      this.stopPicking()
      const { width, height } = this.pageSize()
      const overlay = document.createElement('div')
      this.pickingOverlay = overlay
      overlay.style.cssText = 'position:absolute;left:0;top:0;width:' + width + 'px;height:' + height + 'px;cursor:crosshair;z-index:2147483001;background:rgba(29,91,216,.06)'
      const finish = message => {
        this.stopPicking()
        window.removeEventListener('keydown', cancelOnEscape)
        window.parent.postMessage(message, APP_ORIGIN)
      }
      const cancelOnEscape = event => { if (event.key === 'Escape') finish({ type: 'open-artifact:anchor-cancelled' }) }
      overlay.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        finish({ type: 'open-artifact:anchor-picked', anchor: { x: event.pageX / width, y: event.pageY / height } })
      })
      window.addEventListener('keydown', cancelOnEscape)
      document.body.append(overlay)
    },
  }
  window.addEventListener('resize', () => commentPins.render())

  window.openArtifact = Object.freeze({
    viewer: () => request('viewer', {}),
    db: Object.freeze({ collection }),
  })
})()
`
  }
}
