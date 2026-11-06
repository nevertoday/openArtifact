import { beforeAll, describe, expect, it } from 'vitest'
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
      app.request(`/a/${published.artifactId}`, { cookie: memberCookie }),
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

  it('lets an agent remove and restore its person\'s artifact with a token', async () => {
    const published = await app.publish({ token: authorToken }, 'Agent draft')

    const removal = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', token: authorToken })
    const restore = await app.request(`/api/artifacts/${published.artifactId}/restore`, { method: 'POST', token: authorToken })

    expect([removal.status, restore.status]).toEqual([200, 200])
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
    await app.request(`/api/artifacts/${published.artifactId}/grants`, { method: 'PUT', cookie: authorCookie, body: { email: 'admin@example.com', role: 'editor' } })
    await app.request(`/api/artifacts/${published.artifactId}/grants`, { method: 'PUT', cookie: authorCookie, body: { email: 'member@example.com', role: 'commenter' } })

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
