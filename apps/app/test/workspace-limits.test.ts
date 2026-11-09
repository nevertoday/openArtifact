import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const GIB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000
const app = new TestApp()

interface Me {
  user: { userId: string }
  workspace: { workspaceId: string }
}

/** Signs a new person in alone, so the workspace they publish into is their own personal one, empty. */
async function newPublisher(name: string): Promise<{ cookie: string; userId: string; workspaceId: string }> {
  const cookie = await app.signInAlone(`${name}@example.com`)
  const { body } = await app.json<Me>('/api/me', { cookie })
  return { cookie, userId: body.user.userId, workspaceId: body.workspace.workspaceId }
}

/** Stands in for artifacts published long ago: rows only, no files in R2. */
async function addStoredArtifacts(workspaceId: string, authorId: string, count: number, options: { bytesEach?: number; removedAt?: number } = {}): Promise<void> {
  const prefix = crypto.randomUUID().slice(0, 8)
  await env.DB.prepare(
    `WITH RECURSIVE filler(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM filler WHERE n < ?1)
     INSERT INTO artifacts (id, short_id, workspace_id, author_id, title, visibility, current_version, current_upload_id, created_at, updated_at, removed_at, removed_by, removed_as_admin)
     SELECT ?2 || '-' || n, '', ?3, ?4, 'filler', 'private', 1, 'upload', 0, 0, ?5, CASE WHEN ?5 IS NULL THEN NULL ELSE ?4 END, CASE WHEN ?5 IS NULL THEN NULL ELSE 0 END FROM filler`,
  )
    .bind(count, prefix, workspaceId, authorId, options.removedAt ?? null)
    .run()
  await env.DB.prepare(`INSERT INTO artifact_versions (artifact_id, version, upload_id, author_id, created_at) SELECT id, 1, 'upload', author_id, 0 FROM artifacts WHERE id LIKE ?1 || '-%'`).bind(prefix).run()
  await env.DB.prepare(`INSERT INTO artifact_files (artifact_id, upload_id, path, content_type, size_bytes) SELECT id, 'upload', 'index.html', 'text/html', ?2 FROM artifacts WHERE id LIKE ?1 || '-%'`)
    .bind(prefix, options.bytesEach ?? 100)
    .run()
}

function publish(caller: { cookie?: string; token?: string }, page: string) {
  return app.json<{ artifactId?: string; code?: string; error?: string }>('/api/artifacts', { ...caller, method: 'POST', body: { title: 'Notes', files: [{ path: 'index.html', content: page }] } })
}

function publishVersion(caller: { cookie?: string; token?: string }, artifactId: string, baseVersion: number, page: string) {
  return app.json<{ version?: number; code?: string; error?: string }>(`/api/artifacts/${artifactId}`, { ...caller, method: 'PUT', body: { baseVersion, files: [{ path: 'index.html', content: page }] } })
}

async function artifactCount(workspaceId: string): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS count FROM artifacts WHERE workspace_id = ?').bind(workspaceId).first<number>('count')) ?? 0
}

describe('artifacts per workspace', () => {
  it('holds up to 1,000 active artifacts, refuses the next with nothing written, and counts a removed one no longer', async () => {
    const publisher = await newPublisher('thousand')
    const token = await app.createToken(publisher.cookie)
    await addStoredArtifacts(publisher.workspaceId, publisher.userId, 998)
    const kept = await app.publish({ cookie: publisher.cookie }, 'Kept')

    const thousandth = await publish({ token }, '<h1>last one</h1>')
    const overByAgent = await publish({ token }, '<h1>one too many</h1>')
    const overOnTheWeb = await publish({ cookie: publisher.cookie }, '<h1>one too many</h1>')
    const countAfterRefusals = await artifactCount(publisher.workspaceId)
    const newVersion = await publishVersion({ token }, kept.artifactId, 1, '<h1>kept, edited</h1>')
    await app.request(`/api/artifacts/${kept.artifactId}`, { method: 'DELETE', cookie: publisher.cookie })
    const afterRemoving = await publish({ token }, '<h1>fits again</h1>')

    expect([thousandth.status, overByAgent.status, overOnTheWeb.status, newVersion.status, afterRemoving.status]).toEqual([201, 403, 403, 200, 201])
    expect(overByAgent.body.code).toBe('workspace_quota_reached')
    expect(overByAgent.body.error).toContain('already has 1000 artifacts, its limit of 1000; nothing was published')
    expect(overByAgent.body.error).toContain('a removed artifact stops counting at once')
    expect(overOnTheWeb.body.code).toBe('workspace_quota_reached')
    expect(countAfterRefusals).toBe(1000)
  })

  it('refuses to restore a removed artifact into a workspace that is full', async () => {
    const publisher = await newPublisher('restorer')
    const removed = await app.publish({ cookie: publisher.cookie }, 'Removed earlier')
    await app.request(`/api/artifacts/${removed.artifactId}`, { method: 'DELETE', cookie: publisher.cookie })
    await addStoredArtifacts(publisher.workspaceId, publisher.userId, 1000)

    const refused = await app.json<{ code: string; error: string }>(`/api/artifacts/${removed.artifactId}/restore`, { method: 'POST', cookie: publisher.cookie })
    const stillRemoved = await app.repositories.artifacts.findSummary(removed.artifactId)

    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ code: 'workspace_quota_reached' })
    expect(refused.body.error).toContain('nothing was restored')
    expect(stillRemoved?.removal).not.toBeNull()
  })
})

describe('storage per workspace', () => {
  it('refuses files that would take the workspace past 1 GiB, counting removed artifacts until they are purged', async () => {
    const publisher = await newPublisher('storage')
    const token = await app.createToken(publisher.cookie)
    const page = await app.publish({ token }, 'Growing page', 'x'.repeat(10))
    const removedAt = Date.now() - 31 * DAY_MS
    await addStoredArtifacts(publisher.workspaceId, publisher.userId, 1, { bytesEach: GIB - 100, removedAt })

    const tooBig = await publish({ token }, 'y'.repeat(100))
    const tooBigVersion = await publishVersion({ cookie: publisher.cookie }, page.artifactId, 1, 'y'.repeat(100))
    const fits = await publishVersion({ token }, page.artifactId, 1, 'z'.repeat(80))
    const restoreOverLimit = await app.json<{ code: string }>(`/api/artifacts/${page.artifactId}/versions/2/restore`, { method: 'POST', cookie: publisher.cookie, body: { baseVersion: 2 } })
    await app.repositories.artifacts.purgeRemovedBefore(Date.now() - 30 * DAY_MS, 10)
    const afterPurge = await publish({ token }, 'y'.repeat(100))

    expect([tooBig.status, tooBigVersion.status, fits.status, restoreOverLimit.status, afterPurge.status]).toEqual([413, 413, 200, 413, 201])
    expect(tooBig.body.code).toBe('workspace_quota_reached')
    expect(tooBig.body.error).toContain('of the 1.00 GiB it may store')
    expect(tooBig.body.error).toContain("a removed artifact's files count until it is purged")
    expect(tooBigVersion.body.code).toBe('workspace_quota_reached')
    expect(restoreOverLimit.body.code).toBe('workspace_quota_reached')
  })

  it('shows the workspace what it holds against its limits on the workspace settings page', async () => {
    const publisher = await newPublisher('usage-page')
    await app.publish({ cookie: publisher.cookie }, 'One', 'a'.repeat(1000))
    const removed = await app.publish({ cookie: publisher.cookie }, 'Two', 'b'.repeat(1000))
    await app.request(`/api/artifacts/${removed.artifactId}`, { method: 'DELETE', cookie: publisher.cookie })
    await addStoredArtifacts(publisher.workspaceId, publisher.userId, 1, { bytesEach: 300 * 1024 ** 2 })

    const settings = await (await app.request('/settings/workspace', { cookie: publisher.cookie })).text()

    expect(settings).toContain('2 / 1,000 个')
    expect(settings).toContain('300 MB / 1 GB')
    expect(settings).toMatch(/data-usage="files"[^>]*>/)
    expect(settings.match(/data-usage="shared-data"[\s\S]*?<\/div>\s*<\/div>/)?.[0]).toContain('0 MB / 50 MB')
  })
})

describe('publishes per person', () => {
  async function addPastPublishes(userId: string, count: number, publishedAt: number): Promise<void> {
    await env.DB.prepare(
      `WITH RECURSIVE past(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM past WHERE n < ?1)
       INSERT INTO publish_log (publisher_id, published_at) SELECT ?2, ?3 FROM past`,
    )
      .bind(count, userId, publishedAt)
      .run()
  }

  it('allows 300 publishes in 24 hours, by the web page and the person\'s tokens together, then refuses with nothing written', async () => {
    const publisher = await newPublisher('prolific')
    const bystander = await newPublisher('bystander')
    const token = await app.createToken(publisher.cookie)
    await addPastPublishes(publisher.userId, 50, Date.now() - 25 * 60 * 60 * 1000)
    await addPastPublishes(publisher.userId, 297, Date.now() - 60 * 60 * 1000)

    const byAgent = await publish({ token }, '<h1>298</h1>')
    const versionOnTheWeb = await publishVersion({ cookie: publisher.cookie }, byAgent.body.artifactId ?? '', 1, '<h1>299</h1>')
    const restoredVersion = await app.json<{ version: number }>(`/api/artifacts/${byAgent.body.artifactId}/versions/1/restore`, { method: 'POST', cookie: publisher.cookie, body: { baseVersion: 2 } })
    const overByAgent = await publish({ token }, '<h1>301</h1>')
    const overOnTheWeb = await publishVersion({ cookie: publisher.cookie }, byAgent.body.artifactId ?? '', 3, '<h1>301</h1>')
    const restoreOver = await app.json<{ code: string }>(`/api/artifacts/${byAgent.body.artifactId}/versions/1/restore`, { method: 'POST', cookie: publisher.cookie, body: { baseVersion: 3 } })
    const bystanderStillPublishes = await publish({ cookie: bystander.cookie }, '<h1>mine</h1>')

    expect([byAgent.status, versionOnTheWeb.status, restoredVersion.status]).toEqual([201, 200, 200])
    expect([overByAgent.status, overOnTheWeb.status, restoreOver.status, bystanderStillPublishes.status]).toEqual([429, 429, 429, 201])
    expect(overByAgent.body.code).toBe('publish_limit_reached')
    expect(overByAgent.body.error).toContain('published 300 times in the last 24 hours')
    expect(overOnTheWeb.body.code).toBe('publish_limit_reached')
    expect(restoreOver.body.code).toBe('publish_limit_reached')
    expect(await artifactCount(publisher.workspaceId)).toBe(1)
    expect((await app.repositories.artifacts.findSummary(byAgent.body.artifactId ?? ''))?.version).toBe(3)
  })

  it('gives the place back when a publish does not land, as on a version conflict', async () => {
    const publisher = await newPublisher('conflicted')
    const page = await publish({ cookie: publisher.cookie }, '<h1>one</h1>')
    await addPastPublishes(publisher.userId, 297, Date.now() - 60 * 60 * 1000)
    await publishVersion({ cookie: publisher.cookie }, page.body.artifactId ?? '', 1, '<h1>two</h1>')

    const conflicts = []
    for (const attempt of [1, 2, 3]) conflicts.push(await publishVersion({ cookie: publisher.cookie }, page.body.artifactId ?? '', 1, `<h1>stale ${attempt}</h1>`))
    const lastPlace = await publishVersion({ cookie: publisher.cookie }, page.body.artifactId ?? '', 2, '<h1>three</h1>')
    const overTheCap = await publishVersion({ cookie: publisher.cookie }, page.body.artifactId ?? '', 3, '<h1>four</h1>')

    expect(conflicts.map(conflict => conflict.status)).toEqual([409, 409, 409])
    expect(lastPlace.status).toBe(200)
    expect(overTheCap.body.code).toBe('publish_limit_reached')
  })

  it('does not take a publish from the day\'s allowance when the workspace is full', async () => {
    const publisher = await newPublisher('full-workspace')
    await addStoredArtifacts(publisher.workspaceId, publisher.userId, 1000)

    const refused = await publish({ cookie: publisher.cookie }, '<h1>no room</h1>')
    const counted = await env.DB.prepare('SELECT COUNT(*) AS count FROM publish_log WHERE publisher_id = ?').bind(publisher.userId).first<number>('count')

    expect(refused.body.code).toBe('workspace_quota_reached')
    expect(counted).toBe(0)
  })
})
