import { api } from './common.js'

const SHARED_DATA_NAME = /^[A-Za-z0-9_-]{1,64}$/
const READ_OPERATIONS = new Set(['viewer', 'list'])

/**
 * The artifact page cannot hold credentials, so its SDK asks this page to read and write shared data, and this
 * page calls the API for the viewer. The answer goes back through whoever owns the frame.
 */
export class SharedDataProxy {
  constructor(viewerConfig) {
    this.viewerConfig = viewerConfig
    this.artifactPath = `/api/artifacts/${encodeURIComponent(viewerConfig.artifactId)}`
  }

  /**
   * Performs one request from the page and returns the fields of the response to post back. A page loaded only to
   * be measured may read but not write, so loading it twice never writes twice.
   */
  async answer(request, { readOnly = false } = {}) {
    try {
      if (readOnly && !READ_OPERATIONS.has(request.operation)) throw Object.assign(new Error('This copy of the page is read-only'), { status: 403 })
      return { ok: true, result: await this.#perform(request) }
    } catch (error) {
      return { ok: false, error: error.message, status: error.status ?? 500 }
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
}
