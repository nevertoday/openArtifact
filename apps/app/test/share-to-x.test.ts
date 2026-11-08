import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let cookie = ''
let agentToken = ''

beforeAll(async () => {
  cookie = await app.signIn('share@example.com')
  agentToken = await app.createToken(cookie, 'full', 'Claude Code · share')
})

interface ShareJson {
  readiness: { kind: string; at?: number }
  url: string
  imageUrl: string
  savedText: string | null
  x: { text: string; weightedLength: number; intentUrl: string }
}

const page = (summary: string) => `<html><head><meta name="description" content="${summary}"></head><body><main><p>${summary}</p></main></body></html>`

async function publishByAgent(body: Record<string, unknown>) {
  return app.json<{ artifactId: string; url: string; share: ShareJson; code?: string; error?: string }>('/api/artifacts', {
    method: 'POST',
    token: agentToken,
    agentClient: 'Claude Code',
    body: { files: [{ path: 'index.html', content: page('以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。') }], ...body },
  })
}

describe('sharing an artifact on X', () => {
  it('gives an agent a post ready to open on X when it publishes a listed page', async () => {
    const published = await publishByAgent({ title: 'Claude Code 命令：入门到精通', visibility: 'public_link', listed: true })
    const intent = new URL(published.body.share.x.intentUrl)

    expect(published.status).toBe(201)
    expect(published.body.share.readiness).toEqual({ kind: 'ready' })
    expect(published.body.share.url).toBe(published.body.url)
    expect(published.body.share.imageUrl).toBe(`${published.body.url}/card.png?v=1.1`)
    expect(intent.origin + intent.pathname).toBe('https://x.com/intent/post')
    expect(intent.searchParams.get('url')).toBe(published.body.url)
    expect(intent.searchParams.get('text')).toBe('Claude Code 命令：入门到精通\n\n以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。')
    // Title 28, blank line 2, summary 77, then a space and the link at 23.
    expect(published.body.share.x.weightedLength).toBe(131)
  })

  it('tells an agent why a link cannot go out yet', async () => {
    const workspaceOnly = await publishByAgent({ title: '内部周报' })
    const unlisted = await publishByAgent({ title: '临时链接', visibility: 'public_link' })

    expect(workspaceOnly.body.share.readiness).toEqual({ kind: 'not_public' })
    expect(unlisted.body.share.readiness).toEqual({ kind: 'not_listed' })
  })

  it('keeps words an agent or author wrote, and refuses words that do not fit in a post', async () => {
    const written = await publishByAgent({ title: '短文', visibility: 'public_link', listed: true, shareText: '一句话说清这篇讲什么' })
    const tooLong = await publishByAgent({ title: '太长', shareText: '字'.repeat(130) })
    const artifactPath = `/api/artifacts/${written.body.artifactId}`
    const rewritten = await app.json<{ share: ShareJson }>(artifactPath, { method: 'PATCH', cookie, body: { shareText: '换一种说法' } })
    const cleared = await app.json<{ share: ShareJson }>(artifactPath, { method: 'PATCH', cookie, body: { shareText: null } })
    const updated = await app.json<{ share: ShareJson }>(artifactPath, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: page('新版') }], shareText: '第二版的一句话' } })

    expect(written.body.share.x.text).toBe('一句话说清这篇讲什么')
    expect(written.body.share.savedText).toBe('一句话说清这篇讲什么')
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.code).toBe('share_text_too_long')
    expect(tooLong.body.error).toContain('weighs 284')
    expect(rewritten.body.share.x.text).toBe('换一种说法')
    expect(cleared.body.share.savedText).toBeNull()
    expect(cleared.body.share.x.text).toBe('短文\n\n以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。')
    expect(updated.body.share.x.text).toBe('第二版的一句话')
    expect(updated.body.share.imageUrl).toMatch(/\/card\.png\?v=2\.1$/)
  })

  it('shows the author in the share dialog whether the link may go out, and why not', async () => {
    const published = await publishByAgent({ title: '要分享的文章', visibility: 'public_link', listed: true, publicLinkExpiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000 })
    const sharingPath = `/api/artifacts/${published.body.artifactId}/sharing`

    const expiring = await app.json<{ share: ShareJson }>(sharingPath, { cookie })
    const fixed = await app.json<{ share: ShareJson }>(sharingPath, { method: 'PUT', cookie, body: { visibility: 'public_link', listed: true, publicLinkExpiresAt: null, publicLinkPassword: null } })
    const withPassword = await app.json<{ share: ShareJson }>(sharingPath, { method: 'PUT', cookie, body: { listed: false, publicLinkPassword: 'secret-123' } })

    expect(expiring.body.share.readiness.kind).toBe('expires')
    expect(fixed.body.share.readiness).toEqual({ kind: 'ready' })
    expect(withPassword.body.share.readiness).toEqual({ kind: 'has_password' })
  })
})

describe('the card picture X shows', () => {
  const cardPathOf = (url: string) => `${new URL(url).pathname}/card.png`

  it('draws a listed article once, keeps it, and lets X cache it for good', async () => {
    const published = await publishByAgent({ title: 'pstack 使用指南', visibility: 'public_link', listed: true })
    const drawnBefore = app.cardRenderer.drawn.length

    const first = await app.request(`${cardPathOf(published.body.url)}?v=1.1`)
    const firstBytes = await first.arrayBuffer()
    const second = await app.request(`${cardPathOf(published.body.url)}?v=1.1`)
    const withoutVersion = await app.request(cardPathOf(published.body.url))

    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('image/png')
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(await second.arrayBuffer()).toEqual(firstBytes)
    expect(withoutVersion.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(app.cardRenderer.drawn.length - drawnBefore).toBe(1)
    expect(app.cardRenderer.drawn.at(-1)).toMatchObject({ kind: 'article', template: 'paper', title: 'pstack 使用指南', author: 'share', version: 1 })
  })

  it('draws a dark page on the ink card', async () => {
    const darkPage = '<html><head><meta name="theme-color" content="#0b0d10"></head><body><p>深色页面的第一段话写得足够长了。</p></body></html>'
    const styledPage = '<html><head><style>body { background: rgb(20, 22, 26); color: #eee }</style></head><body><p>x</p></body></html>'
    for (const content of [darkPage, styledPage]) {
      const published = await app.json<{ url: string }>('/api/artifacts', { method: 'POST', token: agentToken, body: { title: '深色', visibility: 'public_link', listed: true, files: [{ path: 'index.html', content }] } })
      await app.request(cardPathOf(published.body.url))
      expect(app.cardRenderer.drawn.at(-1)).toMatchObject({ kind: 'article', template: 'ink' })
    }
  })

  it('answers a card of anything not on the personal page exactly as it answers one that never existed', async () => {
    const missing = await app.request('/a/nothing-here-000000000000/card.png')
    const missingBody = await missing.text()
    const listed = (body: Record<string, unknown>) => publishByAgent({ title: '不该露出的标题', visibility: 'public_link', listed: true, ...body })
    const privatePage = await publishByAgent({ title: '不该露出的标题', visibility: 'private' })
    const unlisted = await publishByAgent({ title: '不该露出的标题', visibility: 'public_link' })
    const withPassword = await listed({})
    await app.request(`/api/artifacts/${withPassword.body.artifactId}/sharing`, { method: 'PUT', cookie, body: { listed: false, publicLinkPassword: 'secret-123' } })
    const expired = await listed({})
    const expiredSharing = { visibility: 'public_link', publicLinkExpiresAt: Date.now() - 1, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: true } as const
    await app.repositories.artifactAccess.saveSharing(expired.body.artifactId, expiredSharing, [])
    const removed = await listed({})
    await app.request(`/api/artifacts/${removed.body.artifactId}`, { method: 'DELETE', cookie })

    for (const hidden of [privatePage, unlisted, withPassword, expired, removed]) {
      const response = await app.request(cardPathOf(hidden.body.url), { cookie })
      expect(response.status).toBe(404)
      expect(await response.text()).toBe(missingBody)
      expect([...response.headers]).toEqual([...missing.headers])
    }
    expect(missing.status).toBe(404)
    expect(missingBody).not.toContain('不该露出的标题')
  })

  it('keeps nothing when a drawing fails, and draws again next time', async () => {
    const published = await publishByAgent({ title: '字体加载失败', visibility: 'public_link', listed: true })
    app.cardRenderer.failing = true
    const failed = await app.request(cardPathOf(published.body.url))
    app.cardRenderer.failing = false
    const retried = await app.request(cardPathOf(published.body.url))

    expect(failed.status).toBe(503)
    expect(failed.headers.get('Cache-Control')).toBe('no-store')
    expect(retried.status).toBe(200)
  })

  it('puts a large picture card on a listed article and on the personal page', async () => {
    const published = await publishByAgent({ title: 'Open Artifact 使用指南', visibility: 'public_link', listed: true })
    const articleMarkup = await (await app.request(new URL(published.body.url).pathname, { headers: { 'User-Agent': 'Twitterbot/1.0' } })).text()
    const ownPage = await app.request('/@me', { cookie })
    const profilePath = ownPage.headers.get('Location') ?? ''
    const profileMarkup = await (await app.request(profilePath)).text()
    const profileImage = /<meta property="og:image" content="([^"]+)">/.exec(profileMarkup)?.[1] ?? ''
    const profileCard = await app.request(new URL(profileImage).pathname + new URL(profileImage).search)

    expect(articleMarkup).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(articleMarkup).toContain(`<meta property="og:image" content="${published.body.url}/card.png?v=1.1">`)
    expect(articleMarkup).toContain(`<meta name="twitter:image" content="${published.body.url}/card.png?v=1.1">`)
    expect(articleMarkup).toContain('<meta property="og:image:width" content="1200">')
    expect(articleMarkup).toContain('<meta property="og:image:height" content="630">')
    expect(articleMarkup).toContain('<meta property="og:image:alt" content="Open Artifact 使用指南">')
    expect(profileMarkup).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(profileImage).toMatch(new RegExp(`^http://app\\.test${profilePath}/card\\.png\\?v=[0-9a-f]{16}\\.1$`))
    expect(profileCard.status).toBe(200)
    expect(profileCard.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(app.cardRenderer.drawn.at(-1)).toMatchObject({ kind: 'profile', titles: expect.arrayContaining(['Open Artifact 使用指南']) })
  })
})

describe('the share buttons', () => {
  const decoded = (markup: string) => markup.replaceAll('&amp;', '&')

  it('sends a reader straight to X with the post written, and gives the author the share panel', async () => {
    const published = await publishByAgent({ title: '别把编译器的活交给 prompt', visibility: 'public_link', listed: true, shareText: '能用编译器保证的，就别交给 prompt' })
    const path = new URL(published.body.url).pathname
    const memberCookie = await app.signIn('share-member@example.com')

    const readersView = decoded(await (await app.request(path)).text())
    const authorsView = await (await app.request(path, { cookie })).text()
    const membersView = await (await app.request(path, { cookie: memberCookie })).text()

    expect(readersView).toContain(`class="xxd-btn viewer-byline__share" data-size="sm" href="${published.body.share.x.intentUrl}" target="_blank"`)
    expect(readersView).toContain('分享到 X')
    expect(readersView).not.toContain('id="share-x-dialog"')
    expect(authorsView).toContain('data-open-share-x')
    expect(authorsView).toContain('id="share-x-dialog"')
    expect(authorsView).toContain('data-share-to-x')
    expect(membersView).not.toContain('viewer-byline__share')
  })

  it('puts X and copy-link on every entry of the personal page and names the titles in the page post', async () => {
    const pageCookie = await app.signIn('share-page@example.com')
    const pageToken = await app.createToken(pageCookie, 'full')
    for (const title of ['第一篇', '第二篇']) {
      await app.request('/api/artifacts', { method: 'POST', token: pageToken, body: { title, visibility: 'public_link', listed: true, files: [{ path: 'index.html', content: `<p>${title}</p>` }] } })
    }
    const pagePath = (await app.request('/@me', { cookie: pageCookie })).headers.get('Location') ?? ''
    const markup = decoded(await (await app.request(pagePath)).text())
    const headerPost = new URL(/class="xxd-btn personal-head__share" data-size="sm" href="([^"]+)"/.exec(markup)?.[1] ?? 'https://x.invalid')
    const entryPosts = [...markup.matchAll(/class="xxd-btn personal-share__action"[^>]*href="([^"]+)"/g)].map(match => new URL(match[1]!).searchParams.get('text'))
    const copiedLinks = [...markup.matchAll(/data-copy="([^"]+)"/g)].map(match => match[1])

    expect(headerPost.searchParams.get('text')).toBe('share-page 在 Open Artifact 上的 2 篇文章：《第二篇》《第一篇》')
    expect(headerPost.searchParams.get('url')).toBe(`http://app.test${pagePath}`)
    expect(entryPosts).toEqual(['第二篇', '第一篇'])
    expect(copiedLinks).toHaveLength(2)
    expect(copiedLinks.every(link => link?.startsWith('http://app.test/a/'))).toBe(true)
  })
})
