import { api } from './common.js'

const SHARED_DATA_NAME = /^[A-Za-z0-9_-]{1,64}$/

/**
 * The artifact page cannot hold credentials, so its SDK asks this page to read and write shared data.
 * The frame is sandboxed without allow-same-origin, so its messages arrive from the opaque origin "null";
 * the frame's window object is what identifies it.
 */
export class SharedDataProxy {
  constructor(frame, viewerConfig) {
    this.frame = frame
    this.viewerConfig = viewerConfig
    this.artifactPath = `/api/artifacts/${encodeURIComponent(viewerConfig.artifactId)}`
    window.addEventListener('message', event => this.#handle(event))
  }

  async #handle(event) {
    const fromArtifactFrame = event.source === this.frame.contentWindow && event.origin === 'null'
    const request = event.data
    const isSdkRequest = request && request.type === 'open-artifact:request' && typeof request.requestId === 'string'
    if (!fromArtifactFrame || !isSdkRequest) return
    try {
      const result = await this.#perform(request)
      this.#reply(request.requestId, { ok: true, result })
    } catch (error) {
      this.#reply(request.requestId, { ok: false, error: error.message, status: error.status ?? 500 })
    }
  }

  async #perform(request) {
    if (request.operation === 'viewer') return this.viewerConfig.viewer
    // The page is untrusted: a name such as ".." must never turn into a different API path.
    const collectionIsSafe = SHARED_DATA_NAME.test(request.collection ?? '')
    const documentIdIsSafe = request.operation === 'list' || SHARED_DATA_NAME.test(request.documentId ?? '')
    if (!collectionIsSafe || !documentIdIsSafe) throw new Error('collection names and document ids must be 1 to 64 letters, digits, "-" or "_"')
    const collectionPath = `${this.artifactPath}/data/${encodeURIComponent(request.collection ?? '')}`
    const documentPath = `${collectionPath}/${encodeURIComponent(request.documentId ?? '')}`
    switch (request.operation) {
      case 'list':
        return (await api(collectionPath)).documents
      case 'put':
        return (await api(documentPath, { method: 'PUT', body: { data: request.data } })).document
      case 'delete':
        await api(documentPath, { method: 'DELETE' })
        return true
      default:
        throw new Error(`unknown operation ${request.operation}`)
    }
  }

  // The sandboxed frame's origin is opaque, so "*" is the only target that reaches it; the message goes to that one window.
  #reply(requestId, response) {
    this.frame.contentWindow?.postMessage({ type: 'open-artifact:response', requestId, ...response }, '*')
  }
}
