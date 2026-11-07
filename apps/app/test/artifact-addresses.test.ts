import { ArtifactPath } from '@open-artifact/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { APP_ORIGIN, TestApp } from './test-app.ts'

const app = new TestApp()
let authorCookie = ''
let memberCookie = ''
let authorToken = ''

beforeAll(async () => {
  authorCookie = await app.signIn('address-author@example.com')
  memberCookie = await app.signIn('address-member@example.com')
  authorToken = await app.createToken(authorCookie, 'full')
})

interface Published {
  artifactId: string
  shortId: string
  slug: string
  version: number
  url: string
}

async function publish(body: Record<string, unknown>): Promise<Published> {
  const { status, body: published } = await app.json<Published>('/api/artifacts', { method: 'POST', token: authorToken, body: { files: [{ path: 'index.html', content: '<h1>v1</h1>' }], ...body } })
  if (status !== 201) throw new Error(`publish failed with ${status}`)
  return published
}

function pathOf(published: Pick<Published, 'url'>): string {
  return new URL(published.url).pathname
}

describe('the address of a published artifact', () => {
  it('reads like the English words of its title followed by its short id', async () => {
    const published = await publish({ title: 'UI 细节对比：Open Artifact × 小小东' })

    expect(published.shortId).toMatch(/^[0-9a-z]{12}$/)
    expect(published.slug).toBe('ui-open-artifact')
    expect(published.url).toBe(`${APP_ORIGIN}/a/ui-open-artifact-${published.shortId}`)
  })

  it('takes the words the agent chose over the title, and is the short id alone when there are none', async () => {
    const chosen = await publish({ title: '季度销售复盘', slug: 'Quarterly Sales Review' })
    const wordless = await publish({ title: '季度销售复盘' })

    expect(chosen.url).toBe(`${APP_ORIGIN}/a/quarterly-sales-review-${chosen.shortId}`)
    expect(wordless.url).toBe(`${APP_ORIGIN}/a/${wordless.shortId}`)
  })

  it('opens the viewer at that address, which links to its own pages and keeps the address out of referrers', async () => {
    const published = await publish({ title: 'Pricing page', slug: 'pricing-page' })

    const viewer = await app.request(pathOf(published), { cookie: memberCookie })
    const markup = await viewer.text()

    expect(viewer.status).toBe(200)
    expect(markup).toContain('artifact-frame')
    expect(markup).toContain(`href="${pathOf(published)}/full"`)
    expect(markup).toContain(`"path":"${pathOf(published)}"`)
    expect(viewer.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('lists it under the same address', async () => {
    const published = await publish({ title: 'Listed address', slug: 'listed-address' })

    const listing = await app.json<{ artifacts: { artifactId: string; url: string | null }[] }>('/api/artifacts', { cookie: memberCookie })

    expect(listing.body.artifacts.find(artifact => artifact.artifactId === published.artifactId)?.url).toBe(published.url)
  })
})

describe('links that are not the canonical address', () => {
  it('sends a member from an old artifact-id link to the canonical address, keeping the page and the version', async () => {
    const published = await publish({ title: 'Launch plan', slug: 'launch-plan' })
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: authorToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const oldViewer = await app.request(`/a/${published.artifactId}?v=1`, { cookie: memberCookie })
    const oldFullView = await app.request(`/a/${published.artifactId}/full?v=1`, { cookie: memberCookie })

    expect(oldViewer.status).toBe(301)
    expect(oldViewer.headers.get('Location')).toBe(`/a/launch-plan-${published.shortId}?v=1`)
    expect(oldViewer.headers.get('Cache-Control')).toBe('no-store')
    expect(oldFullView.status).toBe(301)
    expect(oldFullView.headers.get('Location')).toBe(`/a/launch-plan-${published.shortId}/full?v=1`)
  })

  it('sends wrong words or the bare short id to the canonical address', async () => {
    const published = await publish({ title: 'Roadmap', slug: 'roadmap' })

    const wrongWords = await app.request(`/a/old-words-${published.shortId}`, { cookie: memberCookie })
    const bareShortId = await app.request(`/a/${published.shortId.toUpperCase()}`, { cookie: memberCookie })

    expect([wrongWords.status, bareShortId.status]).toEqual([301, 301])
    expect(wrongWords.headers.get('Location')).toBe(pathOf(published))
    expect(bareShortId.headers.get('Location')).toBe(pathOf(published))
  })

  it('answers a short id that names nothing as an unknown artifact', async () => {
    const unknown = await app.request('/a/some-words-zzzzzzzzzzzz', { cookie: memberCookie })

    expect(unknown.status).toBe(404)
  })

  it('answers a signed-out visitor with an old link exactly as before, without the words', async () => {
    const published = await publish({ title: 'Salary bands', slug: 'salary-bands' })
    const oldPath = `/a/${published.artifactId}`

    const signedOut = await app.request(oldPath)

    expect(signedOut.status).toBe(302)
    expect(signedOut.headers.get('Location')).toBe(`${APP_ORIGIN}/login?next=${encodeURIComponent(oldPath)}`)
  })

  it('answers a member without access, or someone outside the workspace, without redirecting or naming the artifact', async () => {
    const privatePage = await publish({ title: 'Reorg draft', slug: 'reorg-draft', visibility: 'private' })
    await env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('workspace-addresses-elsewhere', 'Elsewhere', ?)").bind(Date.now()).run()
    const elsewhere = await app.repositories.artifacts.create({ workspaceId: 'workspace-addresses-elsewhere', authorId: 'user-elsewhere', title: 'Acquisition target', slug: 'acquisition-target', visibility: 'workspace', publicLinkExpiresAt: null, publishedVia: null, note: null, excerpt: null, listed: false, summary: null, files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })

    const memberWithoutAccess = await app.request(`/a/${privatePage.artifactId}`, { cookie: memberCookie })
    const outsider = await app.request(`/a/${elsewhere.artifactId}`, { cookie: memberCookie })
    const outsiderWithWords = await app.request(ArtifactPath.of({ slug: 'acquisition-target', shortId: elsewhere.shortId }), { cookie: memberCookie })

    expect(memberWithoutAccess.status).toBe(403)
    expect(await memberWithoutAccess.text()).not.toMatch(/reorg|Reorg draft/)
    expect([outsider.status, outsiderWithWords.status]).toEqual([404, 404])
    expect(await outsider.text()).not.toMatch(/acquisition|Acquisition target/)
  })

  it('asks for a public link\'s password at the old address and redirects only once it is entered', async () => {
    const published = await publish({ title: 'Board deck', slug: 'board-deck', visibility: 'public_link', publicLinkExpiresAt: null })
    await app.request(`/api/artifacts/${published.artifactId}/sharing`, { method: 'PUT', token: authorToken, body: { publicLinkPassword: 'board-2026' } })
    const oldPath = `/a/${published.artifactId}`

    const prompt = await app.request(oldPath)
    const promptMarkup = await prompt.text()
    const unlock = await app.request(`${oldPath}/unlock`, { method: 'POST', form: { password: 'board-2026' } })
    const unlockCookie = (unlock.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
    const unlocked = await app.request(oldPath, { cookie: unlockCookie })

    expect(prompt.status).toBe(200)
    expect(promptMarkup).toContain(`action="${oldPath}/unlock"`)
    expect(promptMarkup).not.toContain('board-deck')
    expect(unlock.headers.get('Location')).toBe(oldPath)
    expect(unlocked.status).toBe(301)
    expect(unlocked.headers.get('Location')).toBe(pathOf(published))
  })
})

describe('changing the words of an address', () => {
  it('keeps the words when only the title changes, so links already sent still read right', async () => {
    const published = await publish({ title: 'Hiring plan', slug: 'hiring-plan' })

    const renamed = await app.json<{ title: string; slug: string; url: string }>(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: authorCookie, body: { title: 'Hiring plan 2027' } })

    expect(renamed.body).toMatchObject({ title: 'Hiring plan 2027', slug: 'hiring-plan', url: published.url })
  })

  it('changes the words when the agent passes new ones, and the old address leads to the new one', async () => {
    const published = await publish({ title: 'Offsite', slug: 'offsite' })

    const updated = await app.json<Published>(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: authorToken, body: { baseVersion: 1, slug: 'team-offsite-agenda', files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const oldAddress = await app.request(pathOf(published), { cookie: memberCookie })

    expect(updated.body).toMatchObject({ version: 2, shortId: published.shortId, slug: 'team-offsite-agenda', url: `${APP_ORIGIN}/a/team-offsite-agenda-${published.shortId}` })
    expect(oldAddress.headers.get('Location')).toBe(pathOf(updated.body))
  })

  it('gives an artifact without words the ones of its new title', async () => {
    const published = await publish({ title: '周报' })

    const renamed = await app.json<{ slug: string; url: string }>(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: authorCookie, body: { title: 'Weekly report 周报' } })

    expect(renamed.body.slug).toBe('weekly-report')
    expect(renamed.body.url).toBe(`${APP_ORIGIN}/a/weekly-report-${published.shortId}`)
  })

  it('ignores words that leave nothing once normalized', async () => {
    const published = await publish({ title: 'Budget', slug: 'budget' })

    const renamed = await app.json<{ slug: string }>(`/api/artifacts/${published.artifactId}`, { method: 'PATCH', cookie: authorCookie, body: { slug: '预算' } })

    expect(renamed.body.slug).toBe('budget')
  })
})
