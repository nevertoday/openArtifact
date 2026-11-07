import type { ArtifactFile } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'

export interface ArtifactFileJson {
  path: string
  contentType: string
  encoding: 'utf8' | 'base64'
  content: string
}

const MAX_PATH_LENGTH = 512
const MAX_FILES_PER_VERSION = 500
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ENTRY_PAGE_PATH = 'index.html'
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
}
const TEXT_CONTENT_TYPES = ['text/', 'application/json', 'image/svg+xml']

/** Converts the files of an API request or response to and from the stored form. */
export class ArtifactFileJson {
  /** A version is the complete set of its files, so every upload must include the entry page. */
  static filesFrom(filesJson: unknown): ArtifactFile[] {
    const isNonEmptyList = Array.isArray(filesJson) && filesJson.length > 0
    if (!isNonEmptyList) throw HttpError.badRequest('files must be a non-empty array')
    if (filesJson.length > MAX_FILES_PER_VERSION) throw HttpError.badRequest(`a version may have at most ${MAX_FILES_PER_VERSION} files`)
    const files = filesJson.map(fileJson => ArtifactFileJson.#fileFrom(fileJson))
    const paths = files.map(file => file.path)
    const hasDuplicatePath = new Set(paths).size !== paths.length
    if (hasDuplicatePath) throw HttpError.badRequest('each file path may appear only once')
    if (!paths.includes(ENTRY_PAGE_PATH)) throw HttpError.badRequest(`files must include ${ENTRY_PAGE_PATH}`)
    return files
  }

  static toJson(file: ArtifactFile): ArtifactFileJson {
    const isText = TEXT_CONTENT_TYPES.some(textType => file.contentType.startsWith(textType))
    if (isText) return { path: file.path, contentType: file.contentType, encoding: 'utf8', content: new TextDecoder().decode(file.body) }
    return { path: file.path, contentType: file.contentType, encoding: 'base64', content: ArtifactFileJson.#base64Of(file.body) }
  }

  static #fileFrom(fileJson: unknown): ArtifactFile {
    if (typeof fileJson !== 'object' || fileJson === null) throw HttpError.badRequest('each file must be an object')
    const { path, content, encoding, contentType } = fileJson as Record<string, unknown>
    const validPath = ArtifactFileJson.#validPath(path)
    if (typeof content !== 'string') throw HttpError.badRequest(`${validPath}: content must be a string`)
    const body = ArtifactFileJson.#bodyOf(validPath, content, encoding)
    if (body.byteLength > MAX_FILE_BYTES) throw HttpError.tooLarge(`${validPath}: a file may be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`)
    return { path: validPath, contentType: ArtifactFileJson.#contentTypeOf(validPath, contentType), body }
  }

  // R2 keys are opaque, but a path that leaves its folder would mislead every relative link in the page.
  static #validPath(path: unknown): string {
    if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
      throw HttpError.badRequest(`file path must be 1 to ${MAX_PATH_LENGTH} characters`)
    }
    const segments = path.split('/')
    const hasUnsafeSegment = segments.some(segment => segment === '' || segment === '.' || segment === '..')
    if (hasUnsafeSegment || path.includes('\\')) throw HttpError.badRequest(`${path}: use a relative path without "." or ".." segments`)
    return path
  }

  static #contentTypeOf(path: string, declaredContentType: unknown): string {
    if (typeof declaredContentType === 'string' && declaredContentType.length > 0) return declaredContentType
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream'
  }

  static #bodyOf(path: string, content: string, encoding: unknown): Uint8Array {
    switch (encoding ?? 'utf8') {
      case 'utf8':
        return new TextEncoder().encode(content)
      case 'base64':
        try {
          return Uint8Array.from(atob(content), character => character.charCodeAt(0))
        } catch (error) {
          throw HttpError.badRequest(`${path}: content is not valid base64`, { cause: error })
        }
      default:
        throw HttpError.badRequest(`${path}: encoding must be "utf8" or "base64"`)
    }
  }

  static #base64Of(body: Uint8Array): string {
    let binary = ''
    for (const byte of body) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
}
