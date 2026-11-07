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

  it('says sign-in will lead back to the page the person came from, only when there is one', async () => {
    const fromSharedLink = await pageText('/login?next=/a/some-artifact')
    const plain = await pageText('/login')

    expect(fromSharedLink).toContain('登录后会打开你刚才的页面。')
    expect(plain).not.toContain('登录后会打开你刚才的页面。')
    expect(plain).toContain('输入工作邮箱，我们发一个登录链接，不用密码。')
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
    const waitingMarkup = await pageText('/?filter=waiting_for_my_agent', authorCookie)
    const codexMarkup = await pageText('/?agent=Codex', authorCookie)
    const searchMarkup = await pageText('/?q=design', authorCookie)

    expect(homeMarkup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(homeMarkup).not.toContain(hostileTitle)
    expect(homeMarkup).toContain('1 条未解决评论')
    expect(homeMarkup).toContain('Claude Code')
    expect(waitingMarkup).toContain('Design doc')
    expect(waitingMarkup).not.toContain('onerror')
    expect(codexMarkup).not.toContain('Design doc')
    expect(searchMarkup).toContain('Design doc')
    expect(searchMarkup).not.toContain('onerror')
  })

  it('shows who waits for me and for my agent, on my artifacts and in threads I joined', async () => {
    const reviewerToken = await app.createToken(reviewerCookie)
    const askedAgent = await app.publish({ token: agentToken }, 'Asked agent')
    const askedMe = await app.publish({ token: agentToken }, 'Asked me')
    const answeredMe = await app.publish({ token: reviewerToken }, 'Answered me')
    const settled = await app.publish({ token: agentToken }, 'Settled')
    const comment = async (cookie: string, artifactId: string, body: Record<string, unknown>) =>
      (await app.json<{ comment: { commentId: string } }>(`/api/artifacts/${artifactId}/comments`, { method: 'POST', cookie, body })).body.comment.commentId
    await comment(reviewerCookie, askedAgent.artifactId, { body: '加一张图', forAgent: true })
    await comment(reviewerCookie, askedMe.artifactId, { body: '谁来定价？' })
    await comment(reviewerCookie, askedMe.artifactId, { body: '还有一个问题' })
    const myQuestion = await comment(authorCookie, answeredMe.artifactId, { body: '数据从哪来？' })
    await comment(reviewerCookie, answeredMe.artifactId, { body: '财务系统', parentId: myQuestion })
    const settledQuestion = await comment(reviewerCookie, settled.artifactId, { body: '错别字' })
    await app.request(`/api/comments/${settledQuestion}`, { method: 'PATCH', cookie: authorCookie, body: { resolved: true } })

    const homeMarkup = await pageText('/', authorCookie)
    const forMeMarkup = await pageText('/?filter=waiting_for_me', authorCookie)
    const forMyAgentMarkup = await pageText('/?filter=waiting_for_my_agent', authorCookie)
    const reviewerForMeMarkup = await pageText('/?filter=waiting_for_me', reviewerCookie)

    expect(homeMarkup).toContain('2 条未解决评论</span>')
    expect(homeMarkup).toContain('1 条未解决评论 · 其中 1 条给 agent')
    expect(homeMarkup).toContain('等我处理')
    expect(homeMarkup).toContain('等我的 agent 处理')
    expect(homeMarkup).not.toContain('待 agent 处理')
    expect(homeMarkup).toContain('data-xxd-popover="notification-panel"')
    expect(forMeMarkup).toContain('Asked me')
    expect(forMeMarkup).toContain('Answered me')
    expect(forMeMarkup).not.toContain('Asked agent')
    expect(forMeMarkup).not.toContain('Settled')
    expect(forMyAgentMarkup).toContain('Asked agent')
    expect(forMyAgentMarkup).not.toContain('Asked me')
    expect(reviewerForMeMarkup).not.toContain('Answered me')
  })

  it('finds artifacts by title, author name or agent, and keeps the filter and source while searching', async () => {
    await app.request('/api/me', { method: 'PATCH', cookie: reviewerCookie, body: { name: '周晓' } })
    const reviewerToken = await app.createToken(reviewerCookie)
    await app.publish({ token: reviewerToken, agentClient: 'Gemini CLI' }, 'Quarterly numbers')

    const byAuthor = await pageText(`/?q=${encodeURIComponent('周晓')}`, authorCookie)
    const byAgent = await pageText('/?q=gemini', authorCookie)
    const withinSource = await pageText('/?agent=Gemini%20CLI&q=quarterly', authorCookie)

    expect(byAuthor).toContain('Quarterly numbers')
    expect(byAuthor).toMatch(/搜索「周晓」· \d+ 个/)
    expect(byAgent).toContain('Quarterly numbers')
    expect(withinSource).toContain('<input type="hidden" name="agent" value="Gemini CLI">')
    expect(withinSource).toContain('placeholder="搜索标题、作者或 agent"')
    expect(withinSource).toMatch(/href="\/\?filter=mine&amp;q=quarterly"/)
  })

  it('says why a list is empty and offers the step that fills it, clearing only the search when the search found nothing', async () => {
    const noMatch = await pageText('/?filter=mine&q=zzzz-nothing', authorCookie)
    const nothingShared = await pageText('/?filter=shared', authorCookie)

    expect(noMatch).toContain('没有找到「zzzz-nothing」')
    expect(noMatch).toContain('href="/?filter=mine">清除搜索')
    expect(nothingShared).toContain('还没有人把 artifact 分享给你')
    expect(nothingShared).toContain('<h1 class="xxd-page-header__title">分享给我的</h1>')
  })

  it('keeps long titles to two lines with the full title on hover, and says who published through what', async () => {
    const longTitle = '产品 A 发布计划：从需求评审、设计稿确认、灰度发布到全量上线的完整时间线与每一步的负责人和验收标准'
    await app.publish({ token: agentToken, agentClient: 'Claude Code' }, longTitle)
    await app.publish({ cookie: authorCookie }, 'Written on the web')

    const homeMarkup = await pageText('/', authorCookie)

    expect(homeMarkup).toContain(`<p class="xxd-card__title artifact-card__title" title="${longTitle}">`)
    expect(homeMarkup).toContain('lin 用 Claude Code 发布')
    expect(homeMarkup).toContain('lin 在网页上发布')
  })

  it('offers a skip link to the main content as the first thing on the page', async () => {
    const homeMarkup = await pageText('/', authorCookie)

    expect(homeMarkup).toMatch(/<body class="xxd-page"><a class="xxd-sr-only-focusable" href="#main">跳到内容<\/a>/)
    expect(homeMarkup).toContain('<main class="app-main" id="main"')
  })

  it('says when each artifact changed as a relative time with the full time on hover', async () => {
    await app.publish({ token: agentToken }, 'Timed page')

    const homeMarkup = await pageText('/', authorCookie)

    expect(homeMarkup).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}T[^"]+" title="\d{4}-\d{2}-\d{2} \d{2}:\d{2}" data-relative>刚刚<\/time>/)
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
  const configOf = (markup: string) => JSON.parse(markup.match(/<script type="application\/json" id="viewer-config">(.*?)<\/script>/s)?.[1] ?? '{}')

  it('puts the artifact first with a slim bar, comments on the page, and the page data out of reach of markup injection', async () => {
    const published = await app.publish({ token: agentToken }, '</script><script>alert(1)</script>', '<h1>v1</h1>')

    const authorMarkup = await pageText(`/a/${published.artifactId}`, authorCookie)

    expect(authorMarkup).toMatch(/<button [^>]*aria-pressed="false" aria-keyshortcuts="C"[^>]*data-comment-mode/)
    expect(authorMarkup).toContain('aria-controls="viewer-drawer"')
    expect(authorMarkup).toMatch(/<form class="viewer-composer" role="dialog" aria-label="写评论"/)
    expect(authorMarkup).toContain('placeholder="写评论…"')
    expect(authorMarkup).toContain('这个页面在隔离环境里运行，读不到你的登录信息')
    expect(authorMarkup).toContain('<link rel="stylesheet" href="/static/viewer.css">')
    expect(configOf(authorMarkup)).toMatchObject({ shownVersion: 1, currentVersion: 1, title: '</script><script>alert(1)</script>', permissions: { canComment: true, canEdit: true } })
    expect(authorMarkup).not.toContain('<script>alert(1)</script>')
  })

  it('tells an older version from the latest and offers overwriting the latest only to people who can edit', async () => {
    const published = await app.publish({ token: agentToken }, 'Two versions to choose from', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const authorMarkup = await pageText(`/a/${published.artifactId}?v=1`, authorCookie)
    const reviewerMarkup = await pageText(`/a/${published.artifactId}?v=1`, reviewerCookie)

    expect(authorMarkup).toContain('aria-label="版本 1，选择版本"')
    expect(configOf(authorMarkup)).toMatchObject({ shownVersion: 1, currentVersion: 2, olderVersion: { version: 1, authorName: 'lin' }, permissions: { canEdit: true } })
    expect(configOf(reviewerMarkup)).toMatchObject({ shownVersion: 1, permissions: { canEdit: false } })
  })

  it('shows the latest version when the address asks for one that does not exist, and says so', async () => {
    const published = await app.publish({ token: agentToken }, 'Missing version', '<h1>v1</h1>')

    const markup = await pageText(`/a/${published.artifactId}?v=99`, authorCookie)

    expect(configOf(markup)).toMatchObject({ shownVersion: 1, missingVersion: 99 })
    expect(markup).toMatch(new RegExp(`<iframe [^>]*src="http://usercontent\\.test/s/[^"]+/${published.artifactId}/v1/index\\.html"`))
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
    expect(reviewerResponse.status).toBe(403)
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
    expect(oldVersionFullView).toContain(`href="/a/${published.artifactId}?v=1">`)
    expect(oldVersionFullView).toContain('返回查看页')
  })
})

describe('addresses no page answers', () => {
  it('shows a page with the way home for an unknown address and for a method pages do not take', async () => {
    const unknown = await app.request('/no/such/page', { cookie: authorCookie })
    const wrongMethod = await app.request('/settings/agents', { method: 'DELETE', cookie: authorCookie })

    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('Content-Type')).toContain('text/html')
    expect(await unknown.text()).toMatch(/这个地址不存在[\s\S]*href="\/">回到首页/)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('Allow')).toBe('GET, HEAD')
    expect(await wrongMethod.text()).toContain('这个地址不存在')
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

  it('walks through naming a token, then ready-to-run setup with the token filled in, then a check', async () => {
    const settingsMarkup = await pageText('/settings/agents', authorCookie)
    const tokenSlots = settingsMarkup.match(/data-token-slot/g) ?? []

    expect(settingsMarkup).toContain('1 · 给这个 agent 起个名字')
    expect(settingsMarkup).toContain('<label class="xxd-label" for="token-name">名字</label>')
    expect(settingsMarkup).toContain('<label class="xxd-label" for="token-expiry">有效期</label>')
    expect(settingsMarkup).toContain('这个 token 只显示这一次。离开这个页面后就看不到了。')
    expect(settingsMarkup).toContain('让 agent 发布一个测试页')
    expect(settingsMarkup).not.toContain('oa_pat_…')
    expect(tokenSlots.length).toBeGreaterThanOrEqual(6)
    expect(settingsMarkup).toContain('http_headers = { Authorization = &quot;Bearer <span data-token-slot></span>&quot; }')
    expect(settingsMarkup).not.toContain('bearer_token_env_var')
    expect(settingsMarkup).toContain('其他（HTTP）')
    expect(settingsMarkup).toContain(`${APP_ORIGIN}/llms.txt`)
    expect(settingsMarkup).toContain(`curl -X POST ${APP_ORIGIN}/api/artifacts`)
    expect(settingsMarkup).toContain('-H &quot;X-Open-Artifact-Client: 我的脚本&quot;')
    expect(settingsMarkup).toContain('已有的 token')
  })

  it('lists members and lets only an admin change workspace settings', async () => {
    const membersMarkup = await pageText('/settings/members', reviewerCookie)
    const reviewerWorkspaceMarkup = await pageText('/settings/workspace', reviewerCookie)

    expect(membersMarkup).toContain('lin@example.com')
    expect(membersMarkup).toContain('管理员')
    expect(reviewerWorkspaceMarkup).toContain('只有管理员可以修改')
  })

  it('lists admins first, marks the reader with （你）, and shows every role the same way', async () => {
    const membersMarkup = await pageText('/settings/members', reviewerCookie)
    const rowOrder = [...membersMarkup.matchAll(/data-member-row="[^"]+">\s*<td>.*?<span>([^<（]+)/gs)].map(match => match[1])

    expect(rowOrder[0]).toBe('lin')
    expect(membersMarkup).toMatch(/周晓<span class="xxd-text" data-variant="secondary">（你）<\/span>/)
    expect(membersMarkup).not.toContain('<span class="xxd-badge">管理员</span>')
    expect(membersMarkup).toContain('<th>名字</th>')
  })

  it('nudges a person who has not set a name, until they do', async () => {
    const newcomerCookie = await app.signIn('newcomer@example.com')

    const before = await pageText('/', newcomerCookie)
    await app.request('/api/me', { method: 'PATCH', cookie: newcomerCookie, body: { name: '新同事' } })
    const after = await pageText('/', newcomerCookie)
    const profile = await pageText('/settings/profile', newcomerCookie)

    expect(before).toContain('设置你的名字')
    expect(before).toContain('看到的是「newcomer」')
    expect(after).not.toContain('设置你的名字')
    expect(profile).toContain('value="新同事"')
    expect(profile).toContain('邮箱用来登录，不能修改。')
  })

  it('lists the settings sections in the same order in the account menu and the side navigation', async () => {
    const settingsMarkup = await pageText('/settings/profile', authorCookie)
    const menuOrder = [...settingsMarkup.matchAll(/class="xxd-menu__item" role="menuitem" href="\/settings\/(\w+)"/g)].map(match => match[1])
    const sidebarOrder = [...settingsMarkup.matchAll(/class="xxd-sidebar__item" href="\/settings\/(\w+)"/g)].map(match => match[1])

    expect(menuOrder).toEqual(['profile', 'agents', 'members', 'workspace'])
    expect(sidebarOrder).toEqual(menuOrder)
  })

  it('serves the agent guide as llms.txt, with this instance in it', async () => {
    const llmsTxt = await pageText('/llms.txt')

    expect(llmsTxt).toContain(`${APP_ORIGIN}/api/artifacts`)
    expect(llmsTxt).toContain('window.openArtifact.db')
    expect(llmsTxt).toContain('`publish` (the default)')
    expect(llmsTxt).toContain('expires in 7 days')
    expect(llmsTxt).toContain('{ baseVersion, note, files, title? }')
    expect(llmsTxt).toContain(`DELETE ${APP_ORIGIN}/api/artifacts/{id}`)
    expect(llmsTxt).toContain(`POST ${APP_ORIGIN}/api/artifacts/{id}/restore`)
    expect(llmsTxt).toContain('list_my_comments')
    expect(llmsTxt).toContain(`GET ${APP_ORIGIN}/api/comments?for=me&status=open`)
    expect(llmsTxt).toContain('resolve: true')
    expect(llmsTxt).toContain(`GET ${APP_ORIGIN}/api/artifacts/{id}/data/{collection}`)
  })
})
