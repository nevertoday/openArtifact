import type { ArtifactFile, ArtifactFileSource, UsercontentSignature } from '@open-artifact/core'
import { ArtifactSdk, SDK_PATH } from './artifact-sdk.ts'

const ENTRY_PAGE_PATH = 'index.html'
const ALLOWED_SCRIPT_HOSTS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com']
const SIGNED_URL_CACHE_SECONDS = 3600

/**
 * Serves artifact files read-only on an origin of their own. It never reads cookies: the app proves a
 * viewer's access by signing the path of the version it hands out, and only the app may frame the pages.
 */
export class UsercontentFiles {
  readonly #artifactFiles: ArtifactFileSource
  readonly #usercontentSignature: UsercontentSignature
  readonly #appOrigin: string

  constructor(artifactFiles: ArtifactFileSource, usercontentSignature: UsercontentSignature, appOrigin: string) {
    this.#artifactFiles = artifactFiles
    this.#usercontentSignature = usercontentSignature
    this.#appOrigin = appOrigin
  }

  async respond(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/health') return Response.json({ service: 'open-artifact-usercontent', status: 'ok' })
    const isReadRequest = request.method === 'GET' || request.method === 'HEAD'
    if (!isReadRequest) return new Response('Usercontent is read-only', { status: 405 })
    if (requestUrl.pathname === SDK_PATH) return this.#sdkResponse()
    const signedRequest = await this.#usercontentSignature.verifiedRequest(requestUrl.pathname, Date.now())
    if (!signedRequest) return new Response('This link has expired or is not valid. Reopen the artifact from Open Artifact.', { status: 403 })
    const storedPath = UsercontentFiles.#storedPathOf(signedRequest.filePath)
    if (storedPath === null) return new Response('Not found', { status: 404 })
    const artifactFile = await this.#artifactFiles.readVersionFile(signedRequest.artifactId, signedRequest.version, storedPath)
    if (!artifactFile) return new Response('Not found', { status: 404 })
    return this.#fileResponse(artifactFile, requestUrl.origin, request.method === 'HEAD')
  }

  #fileResponse(artifactFile: ArtifactFile, usercontentOrigin: string, headersOnly: boolean): Response {
    const isPage = artifactFile.contentType.startsWith('text/html')
    const responseBody = isPage ? UsercontentFiles.#withSdk(new TextDecoder().decode(artifactFile.body)) : artifactFile.body
    return new Response(headersOnly ? null : responseBody, {
      headers: {
        'Content-Type': artifactFile.contentType,
        'Content-Security-Policy': this.#contentSecurityPolicy(usercontentOrigin),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': `private, max-age=${SIGNED_URL_CACHE_SECONDS}`,
      },
    })
  }

  #sdkResponse(): Response {
    return new Response(ArtifactSdk.script(this.#appOrigin), {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
    })
  }

  // The sandboxed frame has an opaque origin, so 'self' would not match; the usercontent origin is named instead.
  #contentSecurityPolicy(usercontentOrigin: string): string {
    return [
      "default-src 'none'",
      `script-src 'unsafe-inline' ${usercontentOrigin} ${ALLOWED_SCRIPT_HOSTS.join(' ')}`,
      `style-src 'unsafe-inline' ${usercontentOrigin} https://fonts.googleapis.com`,
      `font-src ${usercontentOrigin} https://fonts.gstatic.com data:`,
      `img-src ${usercontentOrigin} data: blob:`,
      `media-src ${usercontentOrigin} data: blob:`,
      `connect-src ${usercontentOrigin}`,
      `frame-ancestors ${this.#appOrigin}`,
      "base-uri 'none'",
      "form-action 'none'",
      // Applies even when a page is opened in its own tab, so artifacts never share this origin's storage.
      'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads',
    ].join('; ')
  }

  // The SDK loads first, so page scripts can use window.openArtifact right away. Pages written as a bare
  // fragment have no <head>, so the tag goes after the first of <head>, <html> or the doctype that exists.
  static #withSdk(pageText: string): string {
    const sdkTag = `<script src="${SDK_PATH}"></script>`
    const insertionPoint = [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i].map(pattern => pattern.exec(pageText)).find(match => match !== null)
    if (!insertionPoint) return sdkTag + pageText
    const insertAt = insertionPoint.index + insertionPoint[0].length
    return pageText.slice(0, insertAt) + sdkTag + pageText.slice(insertAt)
  }

  static #storedPathOf(filePath: string): string | null {
    let requestedPath: string
    try {
      requestedPath = decodeURIComponent(filePath)
    } catch {
      return null
    }
    const isFolderRequest = requestedPath === '' || requestedPath.endsWith('/')
    return isFolderRequest ? `${requestedPath}${ENTRY_PAGE_PATH}` : requestedPath
  }
}
