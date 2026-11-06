import { env } from 'cloudflare:workers'
import { ArtifactRemoval, SigningKey, UsercontentSignature } from '@open-artifact/core'
import { CloudflareArtifactRepository } from '@open-artifact/storage-cloudflare'
import { beforeAll, describe, expect, it } from 'vitest'
import { SDK_PATH } from '../src/artifact-sdk.ts'
import { UsercontentFiles } from '../src/usercontent-files.ts'

const appOrigin = 'http://app.test'
const usercontentOrigin = 'http://usercontent.test'
const artifactRepository = new CloudflareArtifactRepository(env.DB, env.FILES)
const usercontentSignature = new UsercontentSignature(new SigningKey('test-signing-key-that-is-long-enough'))
const usercontentFiles = new UsercontentFiles(artifactRepository, usercontentSignature, appOrigin)
const html = 'text/html; charset=utf-8'

function encoded(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('UsercontentFiles', () => {
  let artifactId = ''

  beforeAll(async () => {
    const createdArtifact = await artifactRepository.create({
      workspaceId: 'local-workspace',
      authorId: 'user-author',
      title: 'Report',
      visibility: 'workspace',
      publishedVia: null,
      note: null,
      files: [
        { path: 'index.html', contentType: html, body: encoded('<html><head><title>v1</title></head><body><h1>v1</h1></body></html>') },
        { path: 'assets/app.css', contentType: 'text/css; charset=utf-8', body: encoded('h1{}') },
      ],
    })
    artifactId = createdArtifact.artifactId
    await artifactRepository.publishOnTopOf(artifactId, 1, { authorId: 'user-author', publishedVia: null, origin: { kind: 'published' }, note: null, files: [{ path: 'index.html', contentType: html, body: encoded('<h1>v2</h1>') }] })
  })

  async function signedPath(version: number, filePath: string, expiresAt = Date.now() + 60_000): Promise<string> {
    return (await usercontentSignature.signedPrefix(artifactId, version, expiresAt)) + filePath
  }

  async function fetchPath(path: string, method = 'GET'): Promise<Response> {
    return usercontentFiles.respond(new Request(`${usercontentOrigin}${path}`, { method }))
  }

  it('serves a file of the signed version with its content type', async () => {
    const stylesheetResponse = await fetchPath(await signedPath(1, 'assets/app.css'))

    expect(stylesheetResponse.status).toBe(200)
    expect(stylesheetResponse.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    expect(await stylesheetResponse.text()).toBe('h1{}')
  })

  it('injects the SDK before the page scripts, also into a page without a head', async () => {
    const firstVersionPage = await (await fetchPath(await signedPath(1, ''))).text()
    const secondVersionPage = await (await fetchPath(await signedPath(2, 'index.html'))).text()

    expect(firstVersionPage).toBe(`<html><head><script src="${SDK_PATH}"></script><title>v1</title></head><body><h1>v1</h1></body></html>`)
    expect(secondVersionPage).toContain(`<script src="${SDK_PATH}"></script>`)
    expect(secondVersionPage).toContain('<h1>v2</h1>')
  })

  it('refuses unsigned, expired and tampered paths', async () => {
    const unsigned = await fetchPath(`/${artifactId}/v1/index.html`)
    const expired = await fetchPath(await signedPath(1, 'index.html', Date.now() - 1))
    const otherVersion = await fetchPath((await signedPath(1, 'index.html')).replace('/v1/', '/v2/'))

    expect([unsigned.status, expired.status, otherVersion.status]).toEqual([403, 403, 403])
  })

  it('lets only the app frame the page and limits where scripts may load from', async () => {
    const pageResponse = await fetchPath(await signedPath(2, 'index.html'))
    const contentSecurityPolicy = pageResponse.headers.get('Content-Security-Policy') ?? ''

    expect(contentSecurityPolicy).toContain(`frame-ancestors ${appOrigin}`)
    expect(contentSecurityPolicy).toContain(`script-src 'unsafe-inline' ${usercontentOrigin} https://cdnjs.cloudflare.com`)
    expect(contentSecurityPolicy).toContain("default-src 'none'")
    expect(contentSecurityPolicy).toContain('sandbox allow-scripts')
    expect(contentSecurityPolicy).not.toContain('allow-same-origin')
    expect(pageResponse.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(pageResponse.headers.get('Cache-Control')).toBe('private, max-age=3600')
  })

  it('serves an SDK that only talks to the app origin', async () => {
    const sdkResponse = await fetchPath(SDK_PATH)
    const sdkScript = await sdkResponse.text()

    expect(sdkResponse.headers.get('Content-Type')).toContain('text/javascript')
    expect(sdkScript).toContain(`const APP_ORIGIN = "${appOrigin}"`)
    expect(sdkScript).toContain('postMessage(')
    expect(sdkScript).not.toContain("'*'")
    expect(sdkScript).toContain("message.type === 'open-artifact:pins'")
    expect(sdkScript).toContain("has('preview')")
  })

  it('stops serving a removed artifact at once, even on a link signed before the removal', async () => {
    const signedBeforeRemoval = await signedPath(2, 'index.html')
    const servedBefore = await fetchPath(signedBeforeRemoval)

    await artifactRepository.remove(artifactId, new ArtifactRemoval(Date.now(), 'user-admin', true))
    const servedAfterRemoval = await fetchPath(signedBeforeRemoval)
    await artifactRepository.restore(artifactId)
    const servedAfterRestore = await fetchPath(signedBeforeRemoval)

    expect([servedBefore.status, servedAfterRemoval.status, servedAfterRestore.status]).toEqual([200, 404, 200])
  })

  it('answers 404 for a file the version does not have, and refuses writes', async () => {
    const removedFile = await fetchPath(await signedPath(2, 'assets/app.css'))
    const malformedEscape = await fetchPath(await signedPath(1, '%E0%A4%A'))
    const writeResponse = await fetchPath(await signedPath(1, 'index.html'), 'PUT')

    expect([removedFile.status, malformedEscape.status, writeResponse.status]).toEqual([404, 404, 405])
  })
})
