import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const MIB = 1024 ** 2
const app = new TestApp()

interface Me {
  user: { userId: string }
  workspace: { workspaceId: string }
}

async function newAuthor(name: string): Promise<{ cookie: string; userId: string; workspaceId: string }> {
  const cookie = await app.signInAlone(`${name}@example.com`)
  const { body } = await app.json<Me>('/api/me', { cookie })
  return { cookie, userId: body.user.userId, workspaceId: body.workspace.workspaceId }
}

/** A public page anyone with the link may write shared data to. */
async function openPage(cookie: string, title: string): Promise<string> {
  const { artifactId } = await app.publish({ cookie }, title)
  await app.request(`/api/artifacts/${artifactId}/sharing`, { method: 'PUT', cookie, body: { visibility: 'public_link', anonymousWriteEnabled: true } })
  return artifactId
}

function put(artifactId: string, documentId: string, data: unknown, options: { cookie?: string; senderAddress?: string } = {}) {
  return app.json<{ code?: string; error?: string }>(`/api/artifacts/${artifactId}/data/votes/${documentId}`, {
    method: 'PUT',
    body: { data },
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.senderAddress ? { headers: { 'CF-Connecting-IP': options.senderAddress } } : {}),
  })
}

/** Stands in for data visitors wrote earlier: `count` documents of about `bytesEach` bytes of JSON each. */
async function addDocuments(artifactId: string, count: number, bytesEach = 12): Promise<void> {
  await env.DB.prepare(
    `WITH RECURSIVE filler(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM filler WHERE n < ?1)
     INSERT INTO shared_documents (artifact_id, collection, id, data, created_at, updated_at)
     SELECT ?2, 'filler', 'f' || n, '"' || hex(zeroblob(?3)) || '"', 0, 0 FROM filler`,
  )
    .bind(count, artifactId, Math.max(0, Math.floor((bytesEach - 2) / 2)))
    .run()
}

describe('shared data per page', () => {
  it('keeps at most 2,000 documents, refusing the next with nothing saved, while existing ones can still change', async () => {
    const author = await newAuthor('many-votes')
    const artifactId = await openPage(author.cookie, 'Poll')
    await addDocuments(artifactId, 1999)

    const lastPlace = await put(artifactId, 'last', { choice: 'A' })
    const overTheCap = await put(artifactId, 'one-more', { choice: 'B' })
    const changed = await put(artifactId, 'last', { choice: 'B' })
    const stored = await env.DB.prepare('SELECT COUNT(*) AS count FROM shared_documents WHERE artifact_id = ?').bind(artifactId).first<number>('count')

    expect([lastPlace.status, overTheCap.status, changed.status]).toEqual([200, 413, 200])
    expect(overTheCap.body.code).toBe('shared_data_full')
    expect(overTheCap.body.error).toContain('2000 documents or 5 MB one page may keep; nothing was saved')
    expect(stored).toBe(2000)
  })

  it('keeps at most 5 MB of data', async () => {
    const author = await newAuthor('big-votes')
    const artifactId = await openPage(author.cookie, 'Big poll')
    await addDocuments(artifactId, 5, MIB - 8)

    const fits = await put(artifactId, 'small', { a: 1 })
    const tooMuch = await put(artifactId, 'bigger', { text: 'x'.repeat(40) })

    expect(fits.status).toBe(200)
    expect(tooMuch.body.code).toBe('shared_data_full')
  })
})

describe('shared data in the workspace', () => {
  it('counts in the workspace\'s storage, shows on its settings page, and is refused once the workspace is full', async () => {
    const author = await newAuthor('data-usage')
    const artifactId = await openPage(author.cookie, 'Tracker')
    await addDocuments(artifactId, 3, MIB)

    const settings = await (await app.request('/settings/workspace', { cookie: author.cookie })).text()
    await env.DB.prepare(`INSERT INTO artifact_files (artifact_id, upload_id, path, content_type, size_bytes) SELECT id, current_upload_id, 'big.bin', 'application/octet-stream', ?2 FROM artifacts WHERE id = ?1`)
      .bind(artifactId, 1024 ** 3 - 3 * MIB)
      .run()
    const refused = await put(artifactId, 'vote', { choice: 'A' })
    const publishRefused = await app.json<{ code: string }>('/api/artifacts', { method: 'POST', cookie: author.cookie, body: { title: 'More', files: [{ path: 'index.html', content: 'x' }] } })

    expect(settings.match(/data-usage="storage"[\s\S]*?<\/div>\s*<\/div>/)?.[0]).toContain('3 MB / 1 GB')
    expect(settings).toContain('其中 3 MB 是页面为访客保存的数据')
    expect(refused.status).toBe(413)
    expect(refused.body.code).toBe('workspace_quota_reached')
    expect(refused.body.error).toContain("its pages' shared data included")
    expect(publishRefused.body.code).toBe('workspace_quota_reached')
  })
})

describe('shared data from visitors who are not signed in', () => {
  it('takes at most 60 changes a minute from one network, an IPv6 /64 counting as one, and does not limit people signed in', async () => {
    const author = await newAuthor('busy-page')
    const artifactId = await openPage(author.cookie, 'Busy page')

    const statuses: number[] = []
    for (let index = 0; index < 61; index++) statuses.push((await put(artifactId, `v${index % 5}`, { index }, { senderAddress: `2001:db8:60:1::${(index + 1).toString(16)}` })).status)
    const deleteFromSameNetwork = await app.request(`/api/artifacts/${artifactId}/data/votes/v0`, { method: 'DELETE', headers: { 'CF-Connecting-IP': '2001:db8:60:1::ffff' } })
    const signedInFromSameNetwork = await put(artifactId, 'author', { ok: true }, { cookie: author.cookie, senderAddress: '2001:db8:60:1::1' })
    const otherNetwork = await put(artifactId, 'v0', { ok: true }, { senderAddress: '2001:db8:60:2::1' })

    expect(statuses.slice(0, 60).every(status => status === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
    expect(deleteFromSameNetwork.status).toBe(429)
    expect(signedInFromSameNetwork.status).toBe(200)
    expect(otherNetwork.status).toBe(200)
  })
})
