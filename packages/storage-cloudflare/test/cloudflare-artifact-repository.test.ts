import { env } from 'cloudflare:workers'
import { ArtifactRemoval, type ArtifactFile } from '@open-artifact/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { CloudflareArtifactRepository, CloudflareShareCardImages } from '../src/index.ts'

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

/** The bucket, counting the files stored in it. */
function countingUploads(): { bucket: R2Bucket; uploads: () => number } {
  let uploads = 0
  const bucket = new Proxy(env.FILES, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (property !== 'put') return typeof value === 'function' ? value.bind(target) : value
      return (...args: Parameters<R2Bucket['put']>) => {
        uploads++
        return target.put(...args)
      }
    },
  })
  return { bucket, uploads: () => uploads }
}

async function versionCount(artifactId: string): Promise<number | null> {
  return env.DB.prepare('SELECT COUNT(*) AS versions FROM artifact_versions WHERE artifact_id = ?').bind(artifactId).first<number>('versions')
}

describe('CloudflareArtifactRepository', () => {
  const artifactRepository = new CloudflareArtifactRepository(env.DB, env.FILES)

  beforeEach(async () => {
    await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').bind(workspaceId, 'Design team', Date.now()).run()
  })

  function designDocBy(repository: CloudflareArtifactRepository) {
    return repository.create({
      workspaceId,
      authorId,
      title: 'Design doc',
      slug: 'design-doc',
      visibility: 'workspace',
      publicLinkExpiresAt: null,
      publishedVia: 'Claude Code',
      note: null,
      excerpt: null,
      listed: false,
      summary: null,
      shareText: null,
      files: [htmlPage('draft'), { path: 'assets/app.css', contentType: 'text/css', body: new TextEncoder().encode('h1{}') }],
    })
  }

  function createDesignDoc() {
    return designDocBy(artifactRepository)
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

    const publishResult = await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('revised')] })

    expect(publishResult).toEqual({ status: 'published', version: 2 })
    const currentVersion = await artifactRepository.readCurrentVersion(designDoc.artifactId)
    expect(currentVersion?.version).toBe(2)
    expect(currentVersion?.files.map(pageText)).toEqual(['<h1>revised</h1>'])
  })

  it('rejects a publish based on a stale version before storing any of its files', async () => {
    const designDoc = await createDesignDoc()
    await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('revised')] })
    const objectsBeforeStalePublish = await storedObjectCount(designDoc.artifactId)
    const { bucket, uploads } = countingUploads()

    const publishResult = await new CloudflareArtifactRepository(env.DB, bucket).publishOnTopOf(designDoc.artifactId, 1, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('stale edit')] })

    expect(publishResult).toEqual({ status: 'conflict', currentVersion: 2, uploaded: false })
    expect(uploads()).toBe(0)
    expect(await versionCount(designDoc.artifactId)).toBe(2)
    expect(await storedObjectCount(designDoc.artifactId)).toBe(objectsBeforeStalePublish)
    const currentVersion = await artifactRepository.readCurrentVersion(designDoc.artifactId)
    expect(currentVersion?.files.map(pageText)).toEqual(['<h1>revised</h1>'])
  })

  it('rejects a publish based on a version that does not exist yet without recording it', async () => {
    const designDoc = await createDesignDoc()

    const publishResult = await artifactRepository.publishOnTopOf(designDoc.artifactId, 5, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('from the future')] })

    expect(publishResult).toEqual({ status: 'conflict', currentVersion: 1, uploaded: false })
    expect(await versionCount(designDoc.artifactId)).toBe(1)
  })

  it('lets exactly one of two concurrent publishes on the same version win', async () => {
    const designDoc = await createDesignDoc()

    const publishResults = await Promise.all([
      artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('author edit')] }),
      artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('reviewer edit')] }),
    ])

    const statuses = publishResults.map(publishResult => publishResult.status).sort()
    expect(statuses).toEqual(['conflict', 'published'])
    expect(publishResults.find(publishResult => publishResult.status === 'conflict')).toEqual({ status: 'conflict', currentVersion: 2, uploaded: true })
    expect(await versionCount(designDoc.artifactId)).toBe(2)
  })

  it('reads one file of an older version after newer versions are published', async () => {
    const designDoc = await createDesignDoc()
    await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('revised')] })

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
    await artifactRepository.publishOnTopOf(olderDoc.artifactId, 1, { authorId: reviewerId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('revised')] })

    const workspaceArtifacts = await artifactRepository.listRecentlyUpdated(workspaceId)
    const olderDocSummary = await artifactRepository.findSummary(olderDoc.artifactId)

    const olderDocPosition = workspaceArtifacts.findIndex(summary => summary.artifactId === olderDoc.artifactId)
    const newerDocPosition = workspaceArtifacts.findIndex(summary => summary.artifactId === newerDoc.artifactId)
    expect(olderDocPosition).toBeLessThan(newerDocPosition)
    expect(olderDocSummary).toMatchObject({ title: 'Design doc', authorId, version: 2, workspaceId, publishedVia: null })
    expect(olderDocSummary?.sharing).toEqual({ visibility: 'workspace', publicLinkExpiresAt: null, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: false })
  })

  it('keeps every version with who published it and through which agent', async () => {
    const designDoc = await createDesignDoc()
    await artifactRepository.publishOnTopOf(designDoc.artifactId, 1, { authorId: reviewerId, publishedVia: 'Codex', origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('revised')] })

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

  it('finds an artifact by the short id in its address, and renames its title and words together', async () => {
    const designDoc = await createDesignDoc()

    await artifactRepository.rename(designDoc.artifactId, { title: 'Launch plan', slug: 'launch-plan' })
    const found = await artifactRepository.findSummaryByShortId(designDoc.shortId)

    expect(designDoc.shortId).toMatch(/^[0-9a-z]{12}$/)
    expect(found).toMatchObject({ artifactId: designDoc.artifactId, shortId: designDoc.shortId, title: 'Launch plan', slug: 'launch-plan' })
    expect(await artifactRepository.findSummaryByShortId('zzzzzzzzzzzz')).toBeNull()
  })

  it('gives a short id to rows inserted without one, as the previous app does while a deploy is under way', async () => {
    const insertTheOldWay = (id: string) =>
      env.DB.prepare("INSERT INTO artifacts (id, workspace_id, author_id, title, visibility, current_version, current_upload_id, created_at, updated_at) VALUES (?, ?, ?, 'Old way', 'workspace', 1, 'upload', 0, 0)").bind(id, workspaceId, authorId).run()
    const firstId = `old-${crypto.randomUUID()}`
    const secondId = `old-${crypto.randomUUID()}`

    await insertTheOldWay(firstId)
    await insertTheOldWay(secondId)
    const shortIds = await Promise.all([firstId, secondId].map(async id => (await env.DB.prepare('SELECT short_id FROM artifacts WHERE id = ?').bind(id).first<{ short_id: string }>())?.short_id))

    expect(shortIds[0]).toMatch(/^[0-9a-z]{12}$/)
    expect(shortIds[1]).toMatch(/^[0-9a-z]{12}$/)
    expect(shortIds[0]).not.toBe(shortIds[1])
  })

  it('draws another short id when the first one is taken', async () => {
    const takenShortId = (await createDesignDoc()).shortId
    const freshShortId = `t${crypto.randomUUID().replaceAll('-', '').slice(0, 11)}`
    const draws = [takenShortId, freshShortId]
    const clashingRepository = new CloudflareArtifactRepository(env.DB, env.FILES, () => draws.shift() ?? 'unexpected-draw')

    const created = await designDocBy(clashingRepository)

    expect(created.shortId).toBe(freshShortId)
    expect((await artifactRepository.findSummaryByShortId(takenShortId))?.artifactId).not.toBe(created.artifactId)
  })

  it('gives up after a few short ids that are all taken', async () => {
    const takenShortId = (await createDesignDoc()).shortId
    const alwaysTakenRepository = new CloudflareArtifactRepository(env.DB, env.FILES, () => takenShortId)

    await expect(designDocBy(alwaysTakenRepository)).rejects.toThrow('could not be saved')
  })

  it('reports an unknown artifact as not found and keeps no uploaded files', async () => {
    const unknownArtifactId = 'artifact-that-does-not-exist'

    const publishResult = await artifactRepository.publishOnTopOf(unknownArtifactId, 1, { authorId, publishedVia: null, origin: { kind: 'published' }, note: null, excerpt: null, files: [htmlPage('orphan')] })

    expect(publishResult).toEqual({ status: 'not_found' })
    expect(await storedObjectCount(unknownArtifactId)).toBe(0)
    expect(await artifactRepository.readCurrentVersion(unknownArtifactId)).toBeNull()
  })

  it('keeps the words an author wrote for sharing on X, and lets them go back to none', async () => {
    const designDoc = await createDesignDoc()

    await artifactRepository.setShareText(designDoc.artifactId, '读完这篇就知道怎么做了')
    const written = await artifactRepository.findSummary(designDoc.artifactId)
    await artifactRepository.setShareText(designDoc.artifactId, null)
    const cleared = await artifactRepository.findSummary(designDoc.artifactId)

    expect(written?.shareText).toBe('读完这篇就知道怎么做了')
    expect(cleared?.shareText).toBeNull()
  })

  it('keeps each drawn share card, and deletes an artifact\'s cards when it is purged', async () => {
    const shareCardImages = new CloudflareShareCardImages(env.FILES)
    const designDoc = await createDesignDoc()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

    const beforeDrawing = await shareCardImages.read(designDoc.artifactId, '1.1')
    await shareCardImages.write(designDoc.artifactId, '1.1', png)
    const drawn = await shareCardImages.read(designDoc.artifactId, '1.1')
    await artifactRepository.remove(designDoc.artifactId, new ArtifactRemoval(1, authorId, false))
    await artifactRepository.purgeRemovedBefore(2, 100)

    expect(beforeDrawing).toBeNull()
    expect(drawn).toEqual(png)
    expect(await shareCardImages.read(designDoc.artifactId, '1.1')).toBeNull()
  })
  it('hides the artifacts of a deleted workspace, files included, and purges them with the workspace after the window', async () => {
    const goneWorkspaceId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').bind(goneWorkspaceId, 'Gone team', Date.now()).run()
    const goneDoc = await artifactRepository.create({
      workspaceId: goneWorkspaceId,
      authorId,
      title: 'Gone doc',
      slug: 'gone-doc',
      visibility: 'public_link',
      publicLinkExpiresAt: null,
      publishedVia: null,
      note: null,
      excerpt: null,
      listed: true,
      summary: null,
      shareText: null,
      files: [htmlPage('gone')],
    })
    const keptDoc = await createDesignDoc()
    await env.DB.prepare('UPDATE workspaces SET deleted_at = 1 WHERE id = ?').bind(goneWorkspaceId).run()

    expect(await artifactRepository.findSummary(goneDoc.artifactId)).toBeNull()
    expect(await artifactRepository.readVersionFile(goneDoc.artifactId, 1, 'index.html')).toBeNull()
    expect(await artifactRepository.listListedBy(authorId)).not.toContainEqual(expect.objectContaining({ artifactId: goneDoc.artifactId }))

    await artifactRepository.purgeRemovedBefore(2, 100)

    expect(await storedObjectCount(goneDoc.artifactId)).toBe(0)
    expect(await versionCount(goneDoc.artifactId)).toBe(0)
    expect(await artifactRepository.findSummary(keptDoc.artifactId)).not.toBeNull()
  })

  it('purges at most the given number of artifacts in one call, and the rest in the next', async () => {
    const first = await createDesignDoc()
    const second = await createDesignDoc()
    await artifactRepository.remove(first.artifactId, new ArtifactRemoval(1, authorId, false))
    await artifactRepository.remove(second.artifactId, new ArtifactRemoval(1, authorId, false))
    const remainingAfter = async () => (await Promise.all([first, second].map(doc => versionCount(doc.artifactId)))).filter(count => (count ?? 0) > 0).length

    await artifactRepository.purgeRemovedBefore(2, 1)
    const afterOneCall = await remainingAfter()
    await artifactRepository.purgeRemovedBefore(2, 1)

    expect(afterOneCall).toBe(1)
    expect(await remainingAfter()).toBe(0)
  })
})
