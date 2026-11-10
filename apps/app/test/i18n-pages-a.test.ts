import { beforeAll, describe, expect, it } from 'vitest'
import { messagesFor } from '../src/i18n/messages.ts'
import { LoginPage } from '../src/pages/login-page.ts'
import { TestApp } from './test-app.ts'

const app = new TestApp()
const english = { 'Accept-Language': 'en' }
const anyChinese = /[一-鿿]/
// The language switch names Chinese in Chinese, and the team and the personal workspaces are stored with Chinese
// names; none of it is page wording.
const withoutOwnNames = (markup: string) => markup.replaceAll('>中文<', '><').replaceAll('我的团队', '').replaceAll(/[a-z]+ 的工作区/g, '')
let authorCookie = ''
let readerCookie = ''

beforeAll(async () => {
  authorCookie = await app.signIn('ada@example.com')
  readerCookie = await app.signIn('grace@example.com')
})

async function englishPage(path: string, cookie?: string): Promise<{ status: number; markup: string }> {
  const response = await app.request(path, { headers: english, ...(cookie ? { cookie } : {}) })
  return { status: response.status, markup: withoutOwnNames(await response.text()) }
}

function setSharing(artifactId: string, body: Record<string, unknown>) {
  return app.json(`/api/artifacts/${artifactId}/sharing`, { method: 'PUT', cookie: authorCookie, body })
}

describe('the server-rendered pages in English', () => {
  it('words the login page, its form errors and an invite-free sign-in in English', async () => {
    const { markup } = await englishPage('/login?next=/settings')

    expect(markup).toContain('<title>Sign in · Open Artifact</title>')
    expect(markup).toContain('The pages your agents make,<br>seen and talked over here.')
    expect(markup).toContain('The page you opened needs you to sign in. It opens as soon as you do.')
    expect(markup).toContain('data-error-not-admitted="This email can&#39;t sign up yet. Ask an admin to invite you."')
    expect(markup).toContain('Send code')
    expect(markup).not.toMatch(anyChinese)
  })

  it('names company SSO without a configured name in the reader\'s language', async () => {
    const companySso = { providerId: 'company-sso', label: null, kind: 'oidc' as const }

    const englishMarkup = await LoginPage.render(messagesFor('en'), [companySso], '/').text()
    const chineseMarkup = await LoginPage.render(messagesFor('zh-CN'), [companySso], '/').text()

    expect(englishMarkup).toContain('>Sign in with company SSO</button>')
    expect(chineseMarkup).toContain('>用 公司 SSO 登录</button>')
  })

  it('words the home page, its filters, cards and empty states in English', async () => {
    const published = await app.publish({ cookie: authorCookie }, 'Launch plan', '<h1>x</h1>', 'private')

    const { markup } = await englishPage('/', authorCookie)
    const mine = await englishPage('/?filter=shared', authorCookie)
    const searched = await englishPage('/?q=nothing-like-this', authorCookie)

    expect(markup).toMatch(/>All(<span class="home-count">\d+<\/span>)?<\/h1>/)
    expect(markup).toContain('Waiting for my agent')
    expect(markup).toContain('published on the web')
    expect(markup).toContain(`href="${published.path}"`)
    expect(markup).toContain('>Private</span>')
    expect(markup).toContain('1 artifact')
    expect(markup).not.toMatch(anyChinese)
    expect(mine.markup).toContain('Nothing has been shared with you yet')
    expect(mine.markup).not.toMatch(anyChinese)
    expect(searched.markup).toContain('Nothing found for “nothing-like-this”')
    expect(searched.markup).not.toMatch(anyChinese)
  })

  it('words the recently deleted list in English', async () => {
    const published = await app.publish({ cookie: authorCookie }, 'Old draft')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'DELETE', cookie: authorCookie })

    const { markup } = await englishPage('/?filter=removed', authorCookie)

    expect(markup).toContain('Recently deleted')
    expect(markup).toMatch(/Deleted by [^<]+ · /)
    expect(markup).toContain('Deleted for good in 30 days')
    expect(markup).toContain('Restore</button>')
    expect(markup).not.toMatch(anyChinese)
  })

  it('words a personal page in English, for its owner and for strangers', async () => {
    const published = await app.publish({ cookie: authorCookie }, 'Field notes', '<main><p>A complete thought, worth reading to the end.</p></main>')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: null })
    await setSharing(published.artifactId, { listed: true })
    const path = (await app.request('/@me', { cookie: authorCookie })).headers.get('Location') ?? ''

    const ownersView = await englishPage(path, authorCookie)
    const strangersView = await englishPage(path)

    expect(ownersView.markup).toContain('This is your page, exactly as others see it.')
    expect(ownersView.markup).toContain('Edit summary')
    expect(strangersView.markup).toContain('1 document')
    expect(strangersView.markup).toContain('Version 1')
    expect(strangersView.markup).toContain('Published with <a href="/">Open Artifact</a>')
    expect(ownersView.markup).not.toMatch(anyChinese)
    expect(strangersView.markup).not.toMatch(anyChinese)
  })

  it('words the message pages in English', async () => {
    const guarded = await app.publish({ cookie: authorCookie }, 'Board pack')
    await setSharing(guarded.artifactId, { visibility: 'public_link', publicLinkPassword: 'board-2026' })
    const specified = await app.publish({ cookie: authorCookie }, 'Only for some', '<h1>x</h1>', 'specified')

    const unknownAddress = await englishPage('/no/such/page')
    const notFound = await englishPage('/a/missing-artifact')
    const password = await englishPage(`/a/${guarded.artifactId}`)
    const noAccess = await englishPage(`/a/${specified.artifactId}`, readerCookie)
    const inviteUnusable = await englishPage('/invite/not-a-real-code')

    expect(unknownAddress.markup).toContain('This address doesn&#39;t exist')
    expect(notFound.markup).toContain('If it was shared with you, sign in first and open it again.')
    expect(password.markup).toContain('This link needs a password')
    expect(noAccess.status).toBe(403)
    expect(noAccess.markup).toContain('Ask the author to share it')
    expect(inviteUnusable.markup).toContain('This invite no longer works')
    for (const page of [unknownAddress, notFound, password, noAccess, inviteUnusable]) expect(page.markup).not.toMatch(anyChinese)
  })
})

describe('the home page’s source filter', () => {
  it('keeps the same address in every language, the web page included, once there is more than one source', async () => {
    const author = await app.signIn('source-filter@example.com')
    await app.request('/api/artifacts', { method: 'POST', cookie: author, body: { title: 'Made on the web page', files: [{ path: 'index.html', content: '<p>web</p>' }] } })
    const agentToken = await app.createToken(author)
    await app.request('/api/artifacts', { method: 'POST', token: agentToken, headers: { 'X-Open-Artifact-Client': 'Codex' }, body: { title: 'Made by an agent', files: [{ path: 'index.html', content: '<p>agent</p>' }] } })

    const chinese = await app.request('/', { cookie: author })
    const english = await app.request('/', { cookie: author, headers: { 'Accept-Language': 'en' } })
    const webSource = /href="(\/\?[^"]*agent=)"/

    expect((await chinese.text()).match(webSource)?.[1]).toBe('/?agent=')
    expect((await english.text()).match(webSource)?.[1]).toBe('/?agent=')
    const filtered = await (await app.request('/?agent=', { cookie: author, headers: { 'Accept-Language': 'en' } })).text()
    expect(filtered).toContain('Made on the web page')
  })
})
