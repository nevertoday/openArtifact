import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
const ENGLISH = { 'Accept-Language': 'en-US,en;q=0.9' }
const CHINESE_TEXT = /[一-鿿]/
let linCookie = ''
let zhouCookie = ''

async function signInWithHeaders(email: string, headers: Record<string, string>): Promise<string> {
  const sent = await app.request('/api/auth/sign-in/magic-link', { method: 'POST', body: { email, callbackURL: '/' }, headers })
  expect(sent.ok).toBe(true)
  const signInLink = app.mailer.lastTo(email)?.text.match(/https?:\/\/\S+/)?.[0] ?? ''
  const verified = await app.routes.respond(new Request(signInLink, { redirect: 'manual', headers }))
  return verified.headers.getSetCookie().map(setCookie => setCookie.split(';')[0]).join('; ')
}

beforeAll(async () => {
  linCookie = await signInWithHeaders('lin@example.com', ENGLISH)
  await app.request('/locale', { method: 'POST', form: { locale: 'en' }, cookie: linCookie })
  zhouCookie = await app.signIn('zhou@example.com')
})

async function comment(cookie: string, artifactId: string, body: Record<string, unknown>): Promise<string> {
  const { status, body: created } = await app.json<{ comment: { commentId: string } }>(`/api/artifacts/${artifactId}/comments`, { method: 'POST', cookie, body })
  expect(status).toBe(201)
  return created.comment.commentId
}

describe('server text in the reader’s language', () => {
  it('names the first workspace in the language of the browser that signed up', async () => {
    const me = await app.json<{ workspace: { name: string } }>('/api/me', { cookie: linCookie })

    expect(me.body.workspace.name).toBe('My team')
  })

  it('mails a person who chose English in English, and a Chinese reader in Chinese', async () => {
    const published = await app.publish({ token: await app.createToken(linCookie), agentClient: 'Claude Code' }, 'Pricing page')

    const question = await comment(zhouCookie, published.artifactId, { body: 'Missing a column' })
    await comment(linCookie, published.artifactId, { body: 'Added it', parentId: question })

    const linMail = app.mailer.lastTo('lin@example.com')
    expect(linMail?.subject).toBe('zhou commented on “Pricing page”')
    expect(linMail?.text).toContain(`Open it: http://app.test${published.path}#comment-${question}`)
    expect(`${linMail?.subject}${linMail?.text}`).not.toMatch(CHINESE_TEXT)
    expect(app.mailer.lastTo('zhou@example.com')?.subject).toBe('lin 在「Pricing page」回复了评论')
    expect(app.mailer.lastTo('zhou@example.com')?.text).toContain('打开查看：')
  })

  it('words in-app notifications when they are read, in the reader’s language', async () => {
    const english = await app.request('/api/notifications', { cookie: linCookie })
    const chinese = await app.json<{ notifications: { text: string }[] }>('/api/notifications', { cookie: zhouCookie })

    const englishText = await english.text()
    expect(englishText).toContain('zhou commented on your “Pricing page”')
    expect(englishText).not.toMatch(CHINESE_TEXT)
    expect(chinese.body.notifications.map(notification => notification.text)).toContain('lin 回复了你在「Pricing page」的评论')
  })

  it('sends the sign-in mail in the language the browser asks for', async () => {
    await app.request('/api/auth/sign-in/magic-link', { method: 'POST', body: { email: 'wang@example.com', callbackURL: '/' }, headers: ENGLISH })
    const english = app.mailer.lastTo('wang@example.com')
    await app.request('/api/auth/sign-in/magic-link', { method: 'POST', body: { email: 'wang@example.com', callbackURL: '/' } })
    const chinese = app.mailer.lastTo('wang@example.com')

    expect(english?.subject).toBe('Sign in to Open Artifact')
    expect(english?.text).toContain('It works for 5 minutes')
    expect(`${english?.subject}${english?.text}`).not.toMatch(CHINESE_TEXT)
    expect(chinese?.subject).toBe('登录 Open Artifact')
  })

  it('invites in both languages, the inviter’s first', async () => {
    const invited = await app.json<{ invites: { url: string }[] }>('/api/workspace/invites/email', { method: 'POST', cookie: linCookie, body: { emails: ['chen@partner.org'] } })
    const mail = app.mailer.lastTo('chen@partner.org')
    const [english = '', chinese = ''] = mail?.text.split('\n\n---\n\n') ?? []

    expect(invited.status).toBe(201)
    expect(mail?.subject).toMatch(/^lin invited you to join My team \/ lin 邀请你加入 My team$/)
    expect(english).toContain('lin invited you to join My team on Open Artifact.')
    expect(english).toContain('It works for 7 days')
    expect(english).toContain(invited.body.invites[0]?.url)
    expect(english).not.toMatch(CHINESE_TEXT)
    expect(chinese).toContain('lin 邀请你加入 Open Artifact 上的 My team。')
    expect(chinese).toContain(invited.body.invites[0]?.url)
  })

  it('answers an agent’s bad token in English, glossing the settings label', async () => {
    const refused = await app.json<{ error: string }>('/api/artifacts', { token: 'oa_pat_not-a-real-token', headers: ENGLISH })

    expect(refused.status).toBe(401)
    expect(refused.body.error).toContain('Settings › Agent access (设置 › Agent 接入)')
  })
})
