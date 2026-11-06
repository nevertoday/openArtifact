import { beforeAll, describe, expect, it } from 'vitest'
import { APP_ORIGIN, TestApp } from './test-app.ts'

const app = new TestApp()
let authorCookie = ''
let reviewerCookie = ''
let agentToken = ''

beforeAll(async () => {
  authorCookie = await app.signIn('lin@example.com')
  reviewerCookie = await app.signIn('zhou@example.com')
  agentToken = await app.createToken(authorCookie)
})

async function pageText(path: string, cookie?: string): Promise<string> {
  const response = await app.request(path, cookie ? { cookie } : {})
  expect(response.status).toBe(200)
  return response.text()
}

describe('login page', () => {
  it('offers email sign-in and only the providers the deployment configured', async () => {
    const loginMarkup = await pageText('/login?next=/settings/agents')

    expect(loginMarkup).toContain('发送登录链接')
    expect(loginMarkup).toContain('data-next-path="/settings/agents"')
    expect(loginMarkup).not.toContain('data-provider-id')
  })

  it.each(['//evil.example/steal', '/\t/evil.example', '/\\evil.example', 'https://evil.example/'])('never redirects off the site after sign-in (next=%s)', async nextPath => {
    const loginMarkup = await pageText(`/login?next=${encodeURIComponent(nextPath)}`)
    const signedInRedirect = await app.request(`/login?next=${encodeURIComponent(nextPath)}`, { cookie: authorCookie })

    expect(loginMarkup).toContain('data-next-path="/"')
    expect(signedInRedirect.headers.get('Location')).toBe(`${APP_ORIGIN}/`)
  })

  it('sends a signed-in person straight on', async () => {
    const response = await app.request('/login?next=/settings/profile', { cookie: authorCookie })

    expect(response.headers.get('Location')).toBe(`${APP_ORIGIN}/settings/profile`)
  })
})

describe('home page', () => {
  it('lists artifacts with author and agent, filters them, and escapes titles', async () => {
    const hostileTitle = '<img src=x onerror=alert(1)>'
    const designDoc = await app.publish({ token: agentToken, agentClient: 'Claude Code' }, 'Design doc')
    await app.publish({ token: agentToken, agentClient: 'Codex' }, hostileTitle)
    await app.request(`/api/artifacts/${designDoc.artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body: { body: 'fix the diagram', forAgent: true } })

    const homeMarkup = await pageText('/', authorCookie)
    const waitingMarkup = await pageText('/?filter=waiting', authorCookie)
    const codexMarkup = await pageText('/?agent=Codex', authorCookie)
    const searchMarkup = await pageText('/?q=design', authorCookie)

    expect(homeMarkup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(homeMarkup).not.toContain(hostileTitle)
    expect(homeMarkup).toContain('1 条评论待 agent 处理')
    expect(homeMarkup).toContain('Claude Code')
    expect(waitingMarkup).toContain('Design doc')
    expect(waitingMarkup).not.toContain('onerror')
    expect(codexMarkup).not.toContain('Design doc')
    expect(searchMarkup).toContain('Design doc')
    expect(searchMarkup).not.toContain('onerror')
  })

  it('shows live previews from the usercontent origin, isolated from the app', async () => {
    const homeResponse = await app.request('/', { cookie: authorCookie })
    const homeMarkup = await homeResponse.text()

    expect(homeMarkup).toMatch(/<iframe class="artifact-cover__preview" src="http:\/\/usercontent\.test\/s\/[^"]+index\.html\?preview" sandbox="allow-scripts"/)
    expect(homeResponse.headers.get('Content-Security-Policy')).toContain('frame-src http://usercontent.test')
  })

  it('separates what I published from what was shared with me', async () => {
    const reviewerToken = await app.createToken(reviewerCookie)
    const reviewerDoc = await app.publish({ token: reviewerToken }, 'Reviewer only', '<h1>x</h1>', 'specified')
    await app.grant(reviewerCookie, reviewerDoc.artifactId, 'lin@example.com', 'commenter')

    const mineMarkup = await pageText('/?filter=mine', authorCookie)
    const sharedMarkup = await pageText('/?filter=shared', authorCookie)

    expect(mineMarkup).not.toContain('Reviewer only')
    expect(sharedMarkup).toContain('Reviewer only')
  })
})

describe('viewer page', () => {
  it('shows who published an older version, how to see the latest and how to overwrite with it, and keeps viewer data out of reach of markup injection', async () => {
    const published = await app.publish({ token: agentToken }, '</script><script>alert(1)</script>', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const oldVersionMarkup = await pageText(`/a/${published.artifactId}?v=1`, authorCookie)
    const configJson = oldVersionMarkup.match(/<script type="application\/json" id="viewer-config">(.*?)<\/script>/s)?.[1] ?? ''

    expect(oldVersionMarkup).toContain('你在看 <strong class="xxd-mono">v1</strong>（刚刚，lin 发布），最新是 <span class="xxd-mono">v2</span>。')
    expect(oldVersionMarkup).toContain(`<a class="xxd-link" href="/a/${published.artifactId}">看最新版</a>`)
    expect(oldVersionMarkup).toMatch(/<button [^>]*data-overwrite-with-version="1"[^>]*>用 v1 覆盖当前<\/button>/)
    expect(JSON.parse(configJson)).toMatchObject({ shownVersion: 1, currentVersion: 2, title: '</script><script>alert(1)</script>' })
    expect(oldVersionMarkup).not.toContain('<script>alert(1)</script>')
  })

  it('offers overwriting with an older version only to people who can edit', async () => {
    const published = await app.publish({ token: agentToken }, 'Read only for zhou', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const reviewerMarkup = await pageText(`/a/${published.artifactId}?v=1`, reviewerCookie)

    expect(reviewerMarkup).toContain('看最新版')
    expect(reviewerMarkup).not.toContain('data-overwrite-with-version')
  })
})

describe('full-screen view', () => {
  it('opens in a new tab through an app address that checks access on every visit', async () => {
    const published = await app.publish({ token: agentToken }, 'Private draft', '<h1>draft</h1>', 'private')
    const fullViewPath = `/a/${published.artifactId}/full`

    const viewerMarkup = await pageText(`/a/${published.artifactId}`, authorCookie)
    const authorResponse = await app.request(fullViewPath, { cookie: authorCookie })
    const authorMarkup = await authorResponse.text()
    const reviewerResponse = await app.request(fullViewPath, { cookie: reviewerCookie })
    const anonymousResponse = await app.request(fullViewPath)

    expect(viewerMarkup).toContain(`href="${fullViewPath}"`)
    expect(viewerMarkup).not.toMatch(/<a [^>]*href="http:\/\/usercontent\.test/)
    expect(authorResponse.status).toBe(200)
    expect(authorMarkup).toMatch(new RegExp(`<iframe [^>]*src="http://usercontent\\.test/s/[^"]+/${published.artifactId}/v1/index\\.html"`))
    expect(authorResponse.headers.get('Content-Security-Policy')).toContain('frame-src http://usercontent.test')
    expect(reviewerResponse.status).toBe(404)
    expect(anonymousResponse.status).toBe(302)
    expect(anonymousResponse.headers.get('Location')).toBe(`${APP_ORIGIN}/login?next=${encodeURIComponent(fullViewPath)}`)
  })

  it('keeps the version the person was looking at', async () => {
    const published = await app.publish({ token: agentToken }, 'Two versions', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const oldVersionViewer = await pageText(`/a/${published.artifactId}?v=1`, authorCookie)
    const oldVersionFullView = await pageText(`/a/${published.artifactId}/full?v=1`, authorCookie)

    expect(oldVersionViewer).toContain(`href="/a/${published.artifactId}/full?v=1"`)
    expect(oldVersionFullView).toContain(`/${published.artifactId}/v1/index.html`)
  })
})

describe('content security policy', () => {
  it('runs only our own scripts and lets only pages that show artifacts frame the usercontent origin', async () => {
    const published = await app.publish({ token: agentToken }, 'Policy check')

    const viewerPolicy = (await app.request(`/a/${published.artifactId}`, { cookie: authorCookie })).headers.get('Content-Security-Policy') ?? ''
    const settingsPolicy = (await app.request('/settings/agents', { cookie: authorCookie })).headers.get('Content-Security-Policy') ?? ''

    expect(viewerPolicy).toContain("script-src 'self'")
    expect(viewerPolicy).toContain('frame-src http://usercontent.test')
    expect(settingsPolicy).toContain("frame-src 'none'")
    expect(settingsPolicy).toContain("frame-ancestors 'none'")
  })
})

describe('settings', () => {
  it('shows MCP setup with this instance address, tokens and the guide pack', async () => {
    const settingsMarkup = await pageText('/settings/agents', authorCookie)

    expect(settingsMarkup).toContain('claude mcp add --transport http open-artifact http://mcp.test/mcp')
    expect(settingsMarkup).toContain('Claude Code · laptop')
    expect(settingsMarkup).toContain('AGENTS.md 片段')
  })

  it('offers a new token publish-only access by default, with full access as a deliberate choice', async () => {
    const settingsMarkup = await pageText('/settings/agents', authorCookie)
    const settingsConfig = settingsMarkup.match(/<script type="application\/json" id="settings-config">(.*?)<\/script>/s)?.[1] ?? ''

    expect(settingsMarkup).toMatch(/<input type="radio" class="xxd-radio" name="scope" id="token-scope-publish" value="publish" checked>/)
    expect(settingsMarkup).toMatch(/name="scope" id="token-scope-full" value="full">/)
    expect(JSON.parse(settingsConfig).accessTokens[0]).toHaveProperty('scope', 'publish')
  })

  it('lists members and lets only an admin change workspace settings', async () => {
    const membersMarkup = await pageText('/settings/members', reviewerCookie)
    const reviewerWorkspaceMarkup = await pageText('/settings/workspace', reviewerCookie)

    expect(membersMarkup).toContain('lin@example.com')
    expect(membersMarkup).toContain('管理员')
    expect(reviewerWorkspaceMarkup).toContain('只有管理员可以修改')
  })

  it('serves the agent guide as llms.txt, with this instance in it', async () => {
    const llmsTxt = await pageText('/llms.txt')

    expect(llmsTxt).toContain(`${APP_ORIGIN}/api/artifacts`)
    expect(llmsTxt).toContain('window.openArtifact.db')
    expect(llmsTxt).toContain('{ baseVersion, note, files, title? }')
    expect(llmsTxt).toContain(`DELETE ${APP_ORIGIN}/api/artifacts/{id}`)
    expect(llmsTxt).toContain(`POST ${APP_ORIGIN}/api/artifacts/{id}/restore`)
  })
})
