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
    await app.request(`/api/artifacts/${reviewerDoc.artifactId}/grants`, { method: 'PUT', cookie: reviewerCookie, body: { email: 'lin@example.com', role: 'commenter' } })

    const mineMarkup = await pageText('/?filter=mine', authorCookie)
    const sharedMarkup = await pageText('/?filter=shared', authorCookie)

    expect(mineMarkup).not.toContain('Reviewer only')
    expect(sharedMarkup).toContain('Reviewer only')
  })
})

describe('viewer page', () => {
  it('shows an older version with a way back, and keeps viewer data out of reach of markup injection', async () => {
    const published = await app.publish({ token: agentToken }, '</script><script>alert(1)</script>', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const oldVersionMarkup = await pageText(`/a/${published.artifactId}?v=1`, authorCookie)
    const configJson = oldVersionMarkup.match(/<script type="application\/json" id="viewer-config">(.*?)<\/script>/s)?.[1] ?? ''

    expect(oldVersionMarkup).toContain('你在看 <strong class="xxd-mono">v1</strong>')
    expect(oldVersionMarkup).toContain('data-restore-version="1"')
    expect(JSON.parse(configJson)).toMatchObject({ shownVersion: 1, currentVersion: 2, title: '</script><script>alert(1)</script>' })
    expect(oldVersionMarkup).not.toContain('<script>alert(1)</script>')
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
  })
})
