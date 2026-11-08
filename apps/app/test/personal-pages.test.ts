import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let linCookie = ''
let zhouCookie = ''
let linAgentToken = ''
let linFullToken = ''

beforeAll(async () => {
  linCookie = await app.signIn('lin@example.com')
  zhouCookie = await app.signIn('zhou@example.com')
  linAgentToken = await app.createToken(linCookie)
  linFullToken = await app.createToken(linCookie, 'full', 'Claude Code · full')
})

interface SharingJson {
  publicLink: { listed: boolean; personalPageUrl: string | null }
}

async function publishPublic(title: string, page = `<main><p>${title} 这一篇讲的是一件完整的事情，值得读完。</p></main>`) {
  const published = await app.publish({ cookie: linCookie }, title, page)
  await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: null })
  return published
}

function setSharing(artifactId: string, body: Record<string, unknown>, cookie = linCookie) {
  return app.json<SharingJson & { code?: string }>(`/api/artifacts/${artifactId}/sharing`, { method: 'PUT', cookie, body })
}

async function personalPageOf(cookie?: string): Promise<{ status: number; markup: string; robots: string | null; path: string }> {
  const ownPage = await app.request('/@me', { cookie: linCookie })
  const path = ownPage.headers.get('Location') ?? ''
  const response = await app.request(path, cookie ? { cookie } : {})
  return { status: response.status, markup: await response.text(), robots: response.headers.get('X-Robots-Tag'), path }
}

describe('listing on a personal page', () => {
  it('lists only a public link without a password, and takes it off when the page closes', async () => {
    const published = await publishPublic('定价页')

    const listed = await setSharing(published.artifactId, { listed: true })
    const withPassword = await setSharing(published.artifactId, { publicLinkPassword: 'secret-123', listed: true })
    const backToWorkspace = await setSharing(published.artifactId, { visibility: 'workspace' })

    expect(listed.body.publicLink).toMatchObject({ listed: true, personalPageUrl: 'http://app.test/@lin' })
    expect(withPassword.status).toBe(400)
    expect(withPassword.body.code).toBe('not_listable')
    expect(backToWorkspace.body.publicLink.listed).toBe(false)
  })

  it('shows strangers the listed pages they may open, as an indexable page with a share card', async () => {
    const listedPage = await publishPublic('规则分层设计')
    const unlistedPage = await publishPublic('只发给一个人的草稿')
    const expiredPage = await publishPublic('过期的活动页')
    await setSharing(listedPage.artifactId, { listed: true })
    await setSharing(expiredPage.artifactId, { listed: true })
    await app.repositories.artifactAccess.saveSharing(expiredPage.artifactId, { visibility: 'public_link', publicLinkExpiresAt: Date.now() - 1, publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false, listed: true }, [])

    const strangersView = await personalPageOf()

    expect(strangersView.path).toBe('/@lin')
    expect(strangersView.status).toBe(200)
    expect(strangersView.markup).toContain('规则分层设计')
    expect(strangersView.markup).toContain('规则分层设计 这一篇讲的是一件完整的事情')
    expect(strangersView.markup).not.toContain('只发给一个人的草稿')
    expect(strangersView.markup).not.toContain('过期的活动页')
    expect(strangersView.robots).toBeNull()
    expect(strangersView.markup).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(strangersView.markup).not.toContain('data-edit-bio')
    expect(unlistedPage.artifactId).not.toBe(listedPage.artifactId)
  })

  it('answers an unknown handle with 404 and sends /@me to sign in when nobody is signed in', async () => {
    expect((await app.request('/@nobody-here')).status).toBe(404)
    expect((await app.request('/@me')).status).toBe(302)
  })

  it('tells search engines to leave a public link alone unless it is listed, and gives a listed one a byline', async () => {
    const first = await publishPublic('第一篇')
    const second = await publishPublic('第二篇')
    const unlisted = await publishPublic('没列出的')
    await setSharing(first.artifactId, { listed: true })
    await setSharing(second.artifactId, { listed: true })

    const listedView = await app.request(second.path)
    const listedMarkup = await listedView.text()
    const unlistedView = await app.request(unlisted.path)
    const memberView = await app.request(second.path, { cookie: zhouCookie })

    expect(listedView.headers.get('X-Robots-Tag')).toBeNull()
    expect(listedMarkup).toContain(`<link rel="canonical" href="http://app.test${second.path}">`)
    expect(listedMarkup).toContain('class="viewer-byline"')
    expect(listedMarkup).toContain('href="/@lin"')
    expect(listedMarkup).toContain('下一篇')
    expect(unlistedView.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(await unlistedView.text()).not.toContain('viewer-byline')
    expect(await memberView.text()).not.toContain('viewer-byline')
  })
})

describe('the owner of a personal page', () => {
  it('writes a line about themselves and pins one listed page as the cover', async () => {
    const cover = await publishPublic('封面文章')
    const notListed = await publishPublic('未列出')
    await setSharing(cover.artifactId, { listed: true })

    const bio = await app.json<{ bio: string }>('/api/me/profile', { method: 'PATCH', cookie: linCookie, body: { bio: '写 agent 怎么把活干对' } })
    const pinned = await app.json<{ pinnedArtifactId: string }>('/api/me/profile', { method: 'PATCH', cookie: linCookie, body: { pinnedArtifactId: cover.artifactId } })
    const pinUnlisted = await app.json<{ code: string }>('/api/me/profile', { method: 'PATCH', cookie: linCookie, body: { pinnedArtifactId: notListed.artifactId } })
    const pinByToken = await app.request('/api/me/profile', { method: 'PATCH', token: linFullToken, body: { bio: 'x' } })
    const ownersView = await personalPageOf(linCookie)
    const strangersView = await personalPageOf()

    expect(bio.body.bio).toBe('写 agent 怎么把活干对')
    expect(pinned.body.pinnedArtifactId).toBe(cover.artifactId)
    expect(pinUnlisted.status).toBe(400)
    expect(pinByToken.status).toBe(403)
    expect(ownersView.markup).toContain('data-edit-bio')
    expect(ownersView.markup).toContain('这是你的主页')
    expect(strangersView.markup).toContain('写 agent 怎么把活干对')
    expect(strangersView.markup).toMatch(/class="personal-cover"[\s\S]*封面文章/)
  })

  it('writes a summary of their own, and can go back to the page’s opening words', async () => {
    const page = await publishPublic('摘要测试', '<nav><p>首页 · 文档 · 关于我们 · 联系方式 · 加入我们</p></nav><main><p>正文的第一段才是这篇文档真正要说的事情。</p></main>')
    await setSharing(page.artifactId, { listed: true })

    const written = await app.json<{ summary: string }>(`/api/artifacts/${page.artifactId}`, { method: 'PATCH', cookie: linCookie, body: { summary: '作者自己写的一句话' } })
    const cleared = await app.json<{ summary: string }>(`/api/artifacts/${page.artifactId}`, { method: 'PATCH', cookie: linCookie, body: { summary: null } })

    expect(written.body.summary).toBe('作者自己写的一句话')
    expect(cleared.body.summary).toBe('正文的第一段才是这篇文档真正要说的事情。')
  })

  it('moves the page to the new name after a rename', async () => {
    const renamerCookie = await app.signIn('renamer@example.com')
    await app.request('/@me', { cookie: renamerCookie })

    await app.request('/api/me', { method: 'PATCH', cookie: renamerCookie, body: { name: 'Chen Yu' } })
    const ownPage = await app.request('/@me', { cookie: renamerCookie })

    expect(ownPage.headers.get('Location')).toBe('/@chen-yu')
    expect((await app.request('/@renamer')).status).toBe(404)
  })
})

describe('an agent listing what it publishes', () => {
  const page = [{ path: 'index.html', content: '<meta name="description" content="页面自己写的介绍"><p>正文</p>' }]

  it('needs a full-access token, and a listed public link does not expire after 7 days', async () => {
    const withPublishToken = await app.json<{ code: string }>('/api/artifacts', { method: 'POST', token: linAgentToken, agentClient: 'Claude Code', body: { title: '周报', visibility: 'public_link', listed: true, files: page } })
    const withFullToken = await app.json<{ artifactId: string; listed: boolean; publicLinkExpiresAt: number | null }>('/api/artifacts', {
      method: 'POST',
      token: linFullToken,
      agentClient: 'Claude Code',
      body: { title: '周报', visibility: 'public_link', listed: true, files: page },
    })
    const notPublic = await app.json<{ code: string }>('/api/artifacts', { method: 'POST', token: linFullToken, body: { title: '周报', listed: true, files: page } })
    const strangersView = await personalPageOf()

    expect(withPublishToken.status).toBe(403)
    expect(withPublishToken.body.code).toBe('outside_token_scope')
    expect(withFullToken.body).toMatchObject({ listed: true, publicLinkExpiresAt: null })
    expect(notPublic.body.code).toBe('not_listable')
    expect(strangersView.markup).toContain('页面自己写的介绍')
  })

  it('gives its own summary with the publish and with a later version', async () => {
    const published = await app.json<{ artifactId: string }>('/api/artifacts', {
      method: 'POST',
      token: linFullToken,
      body: { title: '带摘要', visibility: 'public_link', listed: true, summary: 'agent 写的摘要', files: page },
    })
    const firstSummary = await app.repositories.artifacts.findSummary(published.body.artifactId)
    await app.request(`/api/artifacts/${published.body.artifactId}`, { method: 'PUT', token: linAgentToken, body: { baseVersion: 1, summary: '第二版的摘要', note: '补了一节', files: page } })
    const secondSummary = await app.repositories.artifacts.findSummary(published.body.artifactId)

    expect(firstSummary?.summary).toBe('agent 写的摘要')
    expect(secondSummary?.summary).toBe('第二版的摘要')
    expect(secondSummary?.currentVersionNote).toBe('补了一节')
  })
})
