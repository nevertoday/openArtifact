import { createScheduledController } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../src/env.ts'
import worker from '../src/index.ts'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let adminCookie = ''
let authorCookie = ''
let memberCookie = ''
let authorToken = ''

const DAY = 24 * 60 * 60 * 1000

interface ListedArtifact {
  artifactId: string
  title: string
  removal: { removedAt: number; removedBy: { name: string }; removedAsAdmin: boolean; purgeAt: number } | null
}

interface AuditEventJson {
  action: string
  actor: { name: string }
  targetId: string
  detail: Record<string, unknown>
}

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
  authorCookie = await app.signIn('author@example.com')
  memberCookie = await app.signIn('member@example.com')
  authorToken = await app.createToken(authorCookie)
})

async function listedTitles(cookie: string, query = ''): Promise<string[]> {
  const { body } = await app.json<{ artifacts: ListedArtifact[] }>(`/api/artifacts${query}`, { cookie })
  return body.artifacts.map(artifact => artifact.title)
}

async function removedArtifacts(cookie: string): Promise<ListedArtifact[]> {
  const { body } = await app.json<{ artifacts: ListedArtifact[] }>('/api/artifacts?removed=true', { cookie })
  return body.artifacts
}

async function auditEvents(): Promise<AuditEventJson[]> {
  const { body } = await app.json<{ events: AuditEventJson[] }>('/api/workspace/audit', { cookie: adminCookie })
  return body.events
}

describe('removing an artifact', () => {
  it('hides it from everyone at once and lets its author restore it within 30 days', async () => {
    const published = await app.publish({ token: authorToken }, 'Wrong page')
    await app.request(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', cookie: memberCookie, body: { body: 'typo' } })

    const removal = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: authorCookie })
    const afterRemoval = await Promise.all([
      app.request(`/api/artifacts/${published.artifactId}`, { cookie: authorCookie }),
      app.request(published.path, { cookie: memberCookie }),
      app.request(`/api/artifacts/${published.artifactId}/comments`, { cookie: authorCookie }),
      app.request(`/api/artifacts/${published.artifactId}/data`, { cookie: memberCookie }),
      app.request(`/api/artifacts/${published.artifactId}/versions`, { cookie: authorCookie }),
    ])
    const restorable = (await removedArtifacts(authorCookie)).find(artifact => artifact.artifactId === published.artifactId)
    const listedWhileRemoved = [await listedTitles(authorCookie), await listedTitles(memberCookie)]

    const restore = await app.request(`/api/artifacts/${published.artifactId}/restore`, { method: 'POST', cookie: authorCookie })
    const afterRestore = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })

    expect(removal.status).toBe(200)
    expect(afterRemoval.map(response => response.status)).toEqual([404, 404, 404, 404, 404])
    expect(listedWhileRemoved.flat()).not.toContain('Wrong page')
    expect(restorable?.removal).toMatchObject({ removedBy: { name: 'author' }, removedAsAdmin: false })
    expect((restorable?.removal?.purgeAt ?? 0) - (restorable?.removal?.removedAt ?? 0)).toBe(30 * DAY)
    expect(restore.status).toBe(200)
    expect(afterRestore.status).toBe(200)
    expect(await removedArtifacts(authorCookie)).toEqual([])
  })

  it('lets only the author or an admin remove it', async () => {
    const published = await app.publish({ token: authorToken }, 'Team page')

    const memberRemoval = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: memberCookie })
    const memberRestore = await app.request(`/api/artifacts/${published.artifactId}/restore`, { method: 'POST', cookie: memberCookie })

    expect(memberRemoval.status).toBe(403)
    expect(memberRestore.status).toBe(403)
  })

  it('lets an agent with a full token remove and restore its person\'s artifact', async () => {
    const fullToken = await app.createToken(authorCookie, 'full')
    const published = await app.publish({ token: authorToken }, 'Agent draft')

    const publishTokenRemoval = await app.json<{ error: string }>(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', token: authorToken })
    const removal = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', token: fullToken })
    const publishTokenRestore = await app.request(`/api/artifacts/${published.artifactId}/restore`, { method: 'POST', token: authorToken })
    const restore = await app.request(`/api/artifacts/${published.artifactId}/restore`, { method: 'POST', token: fullToken })

    expect(publishTokenRemoval.status).toBe(403)
    expect(publishTokenRemoval.body.error).toContain('this token may only publish')
    expect([removal.status, publishTokenRestore.status, restore.status]).toEqual([200, 403, 200])
  })

  it('answers 404 for an artifact that was already removed', async () => {
    const published = await app.publish({ token: authorToken }, 'Twice removed')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: authorCookie })

    const secondRemoval = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: authorCookie })

    expect(secondRemoval.status).toBe(404)
  })
})

describe('an admin taking an artifact down', () => {
  it('takes down a private artifact without ever reading it, and only an admin brings it back', async () => {
    const leaked = await app.publish({ token: authorToken }, 'Leaked salaries', '<h1>secret</h1>', 'private')

    const adminReadBefore = await app.request(`/api/artifacts/${leaked.artifactId}`, { cookie: adminCookie })
    const takedown = await app.json<{ removal: { removedAsAdmin: boolean } }>(`/api/artifacts/${leaked.artifactId}`, { method: 'DELETE', cookie: adminCookie })
    const authorRestore = await app.request(`/api/artifacts/${leaked.artifactId}/restore`, { method: 'POST', cookie: authorCookie })
    const authorRemovedList = await removedArtifacts(authorCookie)
    const adminRemovedList = await removedArtifacts(adminCookie)
    const adminRestore = await app.request(`/api/artifacts/${leaked.artifactId}/restore`, { method: 'POST', cookie: adminCookie })
    const adminReadAfter = await app.request(`/api/artifacts/${leaked.artifactId}`, { cookie: adminCookie })

    expect(adminReadBefore.status).toBe(404)
    expect(takedown.status).toBe(200)
    expect(takedown.body.removal.removedAsAdmin).toBe(true)
    expect(JSON.stringify(takedown.body)).not.toContain('secret')
    expect(authorRestore.status).toBe(404)
    expect(authorRemovedList.map(artifact => artifact.title)).not.toContain('Leaked salaries')
    expect(adminRemovedList.map(artifact => artifact.title)).toContain('Leaked salaries')
    expect(adminRestore.status).toBe(200)
    expect(adminReadAfter.status).toBe(404)
    expect(await listedTitles(authorCookie)).toContain('Leaked salaries')
  })

  it('lists every artifact of the workspace for an admin as metadata only, private ones without a link', async () => {
    const privateNotes = await app.publish({ token: authorToken }, 'Private plan', '<h1>do not read</h1>', 'private')
    await app.publish({ token: authorToken }, 'Shared plan')

    const adminListing = await app.json<{ artifacts: { artifactId: string; title: string; author: { name: string }; url: string | null; files?: unknown }[] }>('/api/workspace/artifacts', { cookie: adminCookie })
    const memberListing = await app.request('/api/workspace/artifacts', { cookie: memberCookie })
    const tokenListing = await app.request('/api/workspace/artifacts', { token: authorToken })
    const listedPrivate = adminListing.body.artifacts.find(artifact => artifact.artifactId === privateNotes.artifactId)

    expect(adminListing.status).toBe(200)
    expect(listedPrivate).toMatchObject({ title: 'Private plan', author: { name: 'author' }, url: null })
    expect(adminListing.body.artifacts.find(artifact => artifact.title === 'Shared plan')?.url).toContain('/a/')
    expect(JSON.stringify(adminListing.body)).not.toContain('do not read')
    expect(memberListing.status).toBe(403)
    expect(tokenListing.status).toBe(403)
  })
})

describe('renaming an artifact', () => {
  it('lets the author and an editor rename it, and refuses a commenter', async () => {
    const published = await app.publish({ token: authorToken }, 'Draft title', '<h1>x</h1>', 'specified')
    await app.grant(authorCookie, published.artifactId, 'admin@example.com', 'editor')
    await app.grant(authorCookie, published.artifactId, 'member@example.com', 'commenter')

    const authorRename = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', token: authorToken, body: { title: '  Q3 plan  ' } })
    const editorRename = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: adminCookie, body: { title: 'Q3 plan, final' } })
    const commenterRename = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: memberCookie, body: { title: 'Hijacked' } })
    const tooLong = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: authorCookie, body: { title: 'x'.repeat(201) } })
    const read = await app.json<{ title: string }>(`/api/artifacts/${published.artifactId}`, { cookie: authorCookie })

    expect([authorRename.status, editorRename.status, commenterRename.status, tooLong.status]).toEqual([200, 200, 403, 400])
    expect(read.body.title).toBe('Q3 plan, final')
  })

  it('renames along with a new version when update carries a title, and keeps the title when it does not', async () => {
    const published = await app.publish({ token: authorToken }, 'Old name')

    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: authorToken, body: { baseVersion: 1, title: 'New name', files: [{ path: 'index.html', content: 'v2' }] } })
    const renamed = await app.json<{ title: string; version: number }>(`/api/artifacts/${published.artifactId}`, { token: authorToken })
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: authorToken, body: { baseVersion: 2, files: [{ path: 'index.html', content: 'v3' }] } })
    const kept = await app.json<{ title: string }>(`/api/artifacts/${published.artifactId}`, { token: authorToken })

    expect(renamed.body).toMatchObject({ title: 'New name', version: 2 })
    expect(kept.body.title).toBe('New name')
  })
})

describe('the audit log', () => {
  it('records removing, restoring and renaming, and shows it to admins only', async () => {
    const published = await app.publish({ token: authorToken }, 'Audited page')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: authorCookie, body: { title: 'Audited page v2' } })
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: adminCookie })
    await app.request(`/api/artifacts/${published.artifactId}/restore`, { method: 'POST', cookie: adminCookie })

    const events = (await auditEvents()).filter(event => event.targetId === published.artifactId)
    const memberAudit = await app.request('/api/workspace/audit', { cookie: memberCookie })

    expect(events.map(event => [event.action, event.actor.name, event.detail])).toEqual([
      ['artifact.restored', 'admin', { title: 'Audited page v2' }],
      ['artifact.removed', 'admin', { title: 'Audited page v2', removedAsAdmin: true }],
      ['artifact.renamed', 'author', { from: 'Audited page', to: 'Audited page v2' }],
    ])
    expect(memberAudit.status).toBe(403)
  })
})

describe('purging removed artifacts', () => {
  async function storedRows(artifactId: string): Promise<(number | null)[]> {
    const countOf = (table: string, column: string) => env.DB.prepare(`SELECT COUNT(*) AS rows_found FROM ${table} WHERE ${column} = ?`).bind(artifactId).first<number>('rows_found')
    return Promise.all([
      countOf('artifacts', 'id'),
      countOf('artifact_versions', 'artifact_id'),
      countOf('artifact_files', 'artifact_id'),
      countOf('comments', 'artifact_id'),
      countOf('artifact_grants', 'artifact_id'),
      countOf('shared_documents', 'artifact_id'),
    ])
  }

  async function storedObjectCount(artifactId: string): Promise<number> {
    return (await env.FILES.list({ prefix: `artifacts/${artifactId}/` })).objects.length
  }

  async function removeDaysAgo(artifactId: string, days: number): Promise<void> {
    await app.request(`/api/artifacts/${artifactId}`, { method: 'DELETE', cookie: authorCookie })
    await env.DB.prepare('UPDATE artifacts SET removed_at = ? WHERE id = ?').bind(Date.now() - days * DAY, artifactId).run()
  }

  async function runDailyPurge(): Promise<void> {
    await worker.scheduled(createScheduledController(), env as unknown as AppEnv)
  }

  it('deletes an artifact 30 days after removal with everything stored for it, keeps its audit trail, and can run again', async () => {
    const expired = await app.publish({ token: authorToken }, 'Expired page', '<h1>old</h1>', 'specified')
    await app.request(`/api/artifacts/${expired.artifactId}`, { method: 'PUT', token: authorToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: 'v2' }, { path: 'app.css', content: 'h1{}' }] } })
    await app.grant(authorCookie, expired.artifactId, 'member@example.com', 'commenter')
    await app.request(`/api/artifacts/${expired.artifactId}/comments`, { method: 'POST', cookie: memberCookie, body: { body: 'old news' } })
    await app.request(`/api/artifacts/${expired.artifactId}/data/votes/member`, { method: 'PUT', cookie: memberCookie, body: { data: { choice: 'a' } } })
    const recent = await app.publish({ token: authorToken }, 'Recently removed')
    const storedBeforePurge = await storedRows(expired.artifactId)
    await removeDaysAgo(expired.artifactId, 31)
    await removeDaysAgo(recent.artifactId, 29)

    await runDailyPurge()
    await runDailyPurge()

    expect(storedBeforePurge).toEqual([1, 2, 3, 1, 1, 1])
    expect(await storedRows(expired.artifactId)).toEqual([0, 0, 0, 0, 0, 0])
    expect(await storedObjectCount(expired.artifactId)).toBe(0)
    expect((await auditEvents()).filter(event => event.targetId === expired.artifactId).map(event => event.action)).toEqual(['artifact.removed'])
    expect((await storedRows(recent.artifactId))[0]).toBe(1)
    expect(await storedObjectCount(recent.artifactId)).toBe(1)
    const restorableTitles = (await removedArtifacts(authorCookie)).map(artifact => artifact.title)
    expect(restorableTitles).toContain('Recently removed')
    expect(restorableTitles).not.toContain('Expired page')
  })

  it('refuses to restore an artifact whose 30 days are over, even before the purge ran', async () => {
    const lapsed = await app.publish({ token: authorToken }, 'Lapsed page')
    await removeDaysAgo(lapsed.artifactId, 30)

    const restore = await app.request(`/api/artifacts/${lapsed.artifactId}/restore`, { method: 'POST', cookie: authorCookie })

    expect(restore.status).toBe(404)
  })
})
