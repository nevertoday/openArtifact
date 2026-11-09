import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { purgePastRestoring } from '../src/purge.ts'
import { TestApp } from './test-app.ts'

const MIB = 1024 ** 2
const DAY = 24 * 60 * 60 * 1000
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
    expect(overTheCap.body.error).toContain("this page's shared data would then be more than the 2000 documents or 5 MB one page may keep; nothing was saved")
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
  it('has its own 50 MB, shown apart from files on the settings page, and refuses past it while files can still be published', async () => {
    const author = await newAuthor('data-usage')
    const [filler, nearlyFull, poll] = [await openPage(author.cookie, 'Filler'), await openPage(author.cookie, 'Nearly full'), await openPage(author.cookie, 'Poll')]
    await addDocuments(filler, 49, MIB)
    await addDocuments(nearlyFull, 1, MIB - 40 * 1024)

    const settings = await (await app.request('/settings/workspace', { cookie: author.cookie })).text()
    const fits = await put(poll, 'small', { a: 1 })
    const refused = await put(poll, 'more', { text: 'x'.repeat(50 * 1024) })
    const filesStillFit = await app.json<{ code?: string }>('/api/artifacts', { method: 'POST', cookie: author.cookie, body: { title: 'More', files: [{ path: 'index.html', content: 'x' }] } })

    expect(settings.match(/data-usage="files"[\s\S]*?<\/div>\s*<\/div>/)?.[0]).toContain('0.1 MB / 1 GB')
    expect(settings.match(/data-usage="shared-data"[\s\S]*?<\/div>\s*<\/div>/)?.[0]).toContain('50 MB / 50 MB')
    expect(fits.status).toBe(200)
    expect(refused.status).toBe(413)
    expect(refused.body.code).toBe('shared_data_full')
    expect(refused.body.error).toContain("the shared data of this workspace's pages would then be more than the 50 MB one workspace may keep; nothing was saved")
    expect(filesStillFit.status).toBe(201)
  })

  it('goes back to nothing as documents are deleted, an artifact is deleted forever or purged, and the workspace is purged', async () => {
    const author = await newAuthor('data-freed')
    const sharedDataOf = (workspaceId: string) => app.repositories.sharedData.workspaceBytes(workspaceId)
    const deploymentBytes = () => env.DB.prepare('SELECT bytes FROM deployment_shared_usage').first<number>('bytes')
    const deploymentBefore = await deploymentBytes()
    const created = await app.request('/api/workspaces', { method: 'POST', cookie: author.cookie, body: { name: 'Data team' } })
    const teamId = ((await created.json()) as { workspace: { workspaceId: string } }).workspace.workspaceId
    const [personalCookie, teamCookie] = [`${author.cookie}; oa_workspace=${author.workspaceId}`, `${author.cookie}; oa_workspace=${teamId}`]
    const [kept, deletedForever, purged] = [await openPage(personalCookie, 'Kept'), await openPage(personalCookie, 'Deleted forever'), await openPage(personalCookie, 'Purged')]
    const inTeam = (await app.publish({ cookie: teamCookie }, 'Team page')).artifactId
    for (const artifactId of [kept, deletedForever, purged]) await put(artifactId, 'vote', { choice: 'A' }, { cookie: personalCookie })
    await put(inTeam, 'vote', { choice: 'A' }, { cookie: teamCookie })
    const whileStored = [await sharedDataOf(author.workspaceId), await sharedDataOf(teamId)]

    await app.request(`/api/artifacts/${kept}/data/votes/vote`, { method: 'DELETE', cookie: personalCookie })
    for (const artifactId of [deletedForever, purged]) await app.request(`/api/artifacts/${artifactId}`, { method: 'DELETE', cookie: personalCookie })
    await app.request(`/api/artifacts/${deletedForever}/purge`, { method: 'POST', cookie: personalCookie })
    await env.DB.prepare('UPDATE artifacts SET removed_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, purged).run()
    await app.request('/api/workspace', { method: 'DELETE', cookie: teamCookie })
    await env.DB.prepare('UPDATE workspaces SET deleted_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, teamId).run()
    await purgePastRestoring(app.repositories, Date.now())
    await purgePastRestoring(app.repositories, Date.now())

    expect(whileStored.every(bytes => bytes > 0)).toBe(true)
    expect(await sharedDataOf(author.workspaceId)).toBe(0)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE id = ?').bind(teamId).first<number>('count')).toBe(0)
    expect(await sharedDataOf(teamId)).toBe(0)
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM artifact_shared_usage WHERE artifact_id IN (?, ?, ?, ?)').bind(kept, deletedForever, purged, inTeam).first<number>('count')).toBe(0)
    expect(await deploymentBytes()).toBe(deploymentBefore)
  })
})

describe('shared data from visitors who are not signed in', () => {
  it('takes at most 60 changes a minute from one network, an IPv6 /64 counting as one, and does not count people signed in against it', async () => {
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

describe('shared data from people signed in', () => {
  it('takes at most 300 changes a minute from one person, wherever they write from, and counts each person apart', async () => {
    const [busy, other] = [await newAuthor('busy-person'), await newAuthor('other-person')]
    const artifactId = await openPage(busy.cookie, 'Busy tracker')

    const statuses: number[] = []
    for (let index = 0; index < 301; index++) statuses.push((await put(artifactId, `v${index % 5}`, { index }, { cookie: busy.cookie, senderAddress: `198.51.100.${index % 200}` })).status)
    const deleteBySamePerson = await app.request(`/api/artifacts/${artifactId}/data/votes/v0`, { method: 'DELETE', cookie: busy.cookie })
    const otherPerson = await put(artifactId, 'other', { ok: true }, { cookie: other.cookie })
    const visitor = await put(artifactId, 'visitor', { ok: true }, { senderAddress: '198.51.100.7' })

    expect(statuses.slice(0, 300).every(status => status === 200)).toBe(true)
    expect(statuses[300]).toBe(429)
    expect(deleteBySamePerson.status).toBe(429)
    expect(otherPerson.status).toBe(200)
    expect(visitor.status).toBe(200)
  })
})
