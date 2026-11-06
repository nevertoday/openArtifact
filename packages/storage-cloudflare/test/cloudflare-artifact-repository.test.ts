import { env } from 'cloudflare:workers'
import type { ArtifactFile } from '@open-artifact/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { CloudflareArtifactRepository } from '../src/index.ts'

const workspaceId = 'workspace-design-team'
const authorId = 'user-author'
const reviewerId = 'user-reviewer'

function htmlPage(text: string): ArtifactFile {
  return { path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode(`<h1>${text}</h1>`) }
}

function pageText(file: ArtifactFile | undefined): string {
  return new TextDecoder().decode(file?.body)
}

async function storedObjectCount(artifactId: string): Promise<number> {
  const listing = await env.FILES.list({ prefix: `artifacts/${artifactId}/` })
  return listing.objects.length
}

async function versionCount(artifactId: string): Promise<number | null> {
  return env.DB.prepare('SELECT COUNT(*) AS versions FROM artifact_versions WHERE artifact_id = ?').bind(artifactId).first<number>('versions')
}

describe('CloudflareArtifactRepository', () => {
  const artifactRepository = new CloudflareArtifactRepository(env.DB, env.FILES)

  beforeEach(async () => {
    await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').bind(workspaceId, 'Design team', Date.now()).run()
  })

  async function createDesignDoc() {
    return artifactRepository.create({
      workspaceId,
      authorId,
      title: 'Design doc',
      visibility: 'workspace',
      publishedVia: 'Claude Code',
      note: null,
      files: [htmlPage('draft'), { path: 'assets/app.css', contentType: 'text/css', body: new TextEncoder().encode('h1{}') }],
    })
  }

  it('reads back the first version with every file', async () => {
    const designDoc = await createDesignDoc()

    const currentVersion = await artifactRepository.readCurrentVersion(designDoc.artifactId)

    expect(currentVersion?.version).toBe(1)
    expect(currentVersion?.files.map(file => file.path)).toEqual(['assets/app.css', 'index.html'])
    expect(pageText(currentVersion?.files.find(file => file.path === 'index.html'))).toBe('<h1>draft</h1>')
  })

  it('publishes a new version on top of the current one', async () => {
    const designDoc = await createDesignDoc()

    const publishResult = await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('revised')] })

    expect(publishResult).toEqual({ status: 'published', version: 2 })
    const currentVersion = await artifactRepository.readCurrentVersion(designDoc.artifactId)
    expect(currentVersion?.version).toBe(2)
    expect(currentVersion?.files.map(pageText)).toEqual(['<h1>revised</h1>'])
  })

  it('rejects a publish based on a stale version and leaves no trace of it', async () => {
    const designDoc = await createDesignDoc()
    await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('revised')] })
    const objectsBeforeStalePublish = await storedObjectCount(designDoc.artifactId)

    const publishResult = await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('stale edit')] })

    expect(publishResult).toEqual({ status: 'conflict', currentVersion: 2 })
    expect(await versionCount(designDoc.artifactId)).toBe(2)
    expect(await storedObjectCount(designDoc.artifactId)).toBe(objectsBeforeStalePublish)
    const currentVersion = await artifactRepository.readCurrentVersion(designDoc.artifactId)
    expect(currentVersion?.files.map(pageText)).toEqual(['<h1>revised</h1>'])
  })

  it('rejects a publish based on a version that does not exist yet without recording it', async () => {
    const designDoc = await createDesignDoc()

    const publishResult = await artifactRepository.publishOnTopOf(designDoc.artifactId, 5, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('from the future')] })

    expect(publishResult).toEqual({ status: 'conflict', currentVersion: 1 })
    expect(await versionCount(designDoc.artifactId)).toBe(1)
  })

  it('lets exactly one of two concurrent publishes on the same version win', async () => {
    const designDoc = await createDesignDoc()

    const publishResults = await Promise.all([
      artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('author edit')] }),
      artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('reviewer edit')] }),
    ])

    const statuses = publishResults.map(publishResult => publishResult.status).sort()
    expect(statuses).toEqual(['conflict', 'published'])
    expect(await versionCount(designDoc.artifactId)).toBe(2)
  })

  it('reads one file of an older version after newer versions are published', async () => {
    const designDoc = await createDesignDoc()
    await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('revised')] })

    const firstVersionPage = await artifactRepository.readVersionFile(designDoc.artifactId, 1, 'index.html')
    const missingFile = await artifactRepository.readVersionFile(designDoc.artifactId, 2, 'assets/app.css')

    expect(pageText(firstVersionPage ?? undefined)).toBe('<h1>draft</h1>')
    expect(firstVersionPage?.contentType).toBe('text/html')
    expect(missingFile).toBeNull()
  })

  it('summarizes artifacts, most recently updated first', async () => {
    const olderDoc = await createDesignDoc()
    const newerDoc = await createDesignDoc()
    // updated_at has millisecond resolution; the wait keeps the two timestamps apart.
    await scheduler.wait(5)
    await artifactRepository.publishOnTopOf(olderDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('revised')] })

    const workspaceArtifacts = await artifactRepository.listRecentlyUpdated(workspaceId)
    const olderDocSummary = await artifactRepository.findSummary(olderDoc.artifactId)

    const olderDocPosition = workspaceArtifacts.findIndex(summary => summary.artifactId === olderDoc.artifactId)
    const newerDocPosition = workspaceArtifacts.findIndex(summary => summary.artifactId === newerDoc.artifactId)
    expect(olderDocPosition).toBeLessThan(newerDocPosition)
    expect(olderDocSummary).toMatchObject({ title: 'Design doc', authorId, version: 2, workspaceId, publishedVia: null })
    expect(olderDocSummary?.sharing).toEqual({ visibility: 'workspace', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false })
  })

  it('keeps every version with who published it and through which agent', async () => {
    const designDoc = await createDesignDoc()
    await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: 'Codex', origin: { kind: 'published' }, note: null, files: [htmlPage('revised')] })

    const versionHistory = await artifactRepository.listVersions(designDoc.artifactId)
    const firstVersion = await artifactRepository.readVersion(designDoc.artifactId, 1)
    const summary = await artifactRepository.findSummary(designDoc.artifactId)

    expect(versionHistory.map(({ version, authorId: versionAuthor, publishedVia }) => ({ version, versionAuthor, publishedVia }))).toEqual([
      { version: 2, versionAuthor: reviewerId, publishedVia: 'Codex' },
      { version: 1, versionAuthor: authorId, publishedVia: 'Claude Code' },
    ])
    expect(firstVersion?.files.map(file => file.path)).toEqual(['assets/app.css', 'index.html'])
    expect(summary?.publishedVia).toBe('Codex')
  })

  it('reports an unknown artifact as not found and keeps no uploaded files', async () => {
    const unknownArtifactId = 'artifact-that-does-not-exist'

    const publishResult = await artifactRepository.publishOnTopOf(unknownArtifactId, 1, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, files: [htmlPage('orphan')] })

    expect(publishResult).toEqual({ status: 'not_found' })
    expect(await storedObjectCount(unknownArtifactId)).toBe(0)
    expect(await artifactRepository.readCurrentVersion(unknownArtifactId)).toBeNull()
  })
})
