import { describe, expect, it } from 'vitest'
import { AccessTokenSecret } from '@open-artifact/core'
import { MailerConfigError, Mailers } from '../src/auth/mailer.ts'
import { APP_ORIGIN, TestApp } from './test-app.ts'

const app = new TestApp()

describe('signing in', () => {
  it('signs a person in through the emailed link and puts them in a workspace', async () => {
    const founderCookie = await app.signIn('lin@example.com')
    const colleagueCookie = await app.signIn('zhou@example.com')

    const founder = await app.json<{ user: { name: string; email: string }; workspace: { name: string; role: string } }>('/api/me', { cookie: founderCookie })
    const colleague = await app.json<{ workspace: { name: string; role: string } }>('/api/me', { cookie: colleagueCookie })

    expect(founder.body.user).toEqual(expect.objectContaining({ name: 'lin', email: 'lin@example.com' }))
    expect(founder.body.workspace).toMatchObject({ name: '我的团队', role: 'admin' })
    expect(colleague.body.workspace).toMatchObject({ name: '我的团队', role: 'member' })
  })

  it('lets a person choose their display name', async () => {
    const cookie = await app.signIn('chen@example.com')

    const renameResponse = await app.request('/api/me', { method: 'PATCH', cookie, body: { name: '陈默' } })
    const me = await app.json<{ user: { name: string } }>('/api/me', { cookie })

    expect(renameResponse.status).toBe(200)
    expect(me.body.user.name).toBe('陈默')
  })

  it('answers 401 without a session or token, and sends pages to the login page', async () => {
    const apiResponse = await app.request('/api/artifacts')
    const homeResponse = await app.request('/')

    expect(apiResponse.status).toBe(401)
    expect(homeResponse.status).toBe(302)
    expect(homeResponse.headers.get('Location')).toBe(`${APP_ORIGIN}/login?next=%2F`)
  })

  it('names what went wrong with a stable code and the field it concerns, beside the English message', async () => {
    const cookie = await app.signIn('lin@example.com')

    const blankName = await app.json<{ code: string; field: string; error: string }>('/api/me', { method: 'PATCH', cookie, body: { name: '   ' } })
    const longName = await app.json<{ code: string; field: string; maxLength: number }>('/api/me', { method: 'PATCH', cookie, body: { name: 'x'.repeat(61) } })
    const signedOut = await app.json<{ code: string }>('/api/me')
    const unknownRoute = await app.json<{ code: string }>('/api/nothing-here', { cookie })

    expect(blankName).toMatchObject({ status: 400, body: { code: 'field_required', field: 'name', error: 'name must be 1 to 60 characters' } })
    expect(longName).toMatchObject({ status: 400, body: { code: 'field_too_long', field: 'name', maxLength: 60 } })
    expect(signedOut).toMatchObject({ status: 401, body: { code: 'unauthenticated' } })
    expect(unknownRoute).toMatchObject({ status: 404, body: { code: 'not_found' } })
  })

  it('refuses a write that carries the session cookie but comes from another site', async () => {
    const cookie = await app.signIn('lin@example.com')

    const crossSiteWrite = await app.request('/api/tokens', { method: 'POST', cookie, origin: 'https://evil.example', body: { name: 'stolen', expiresInDays: 30 } })
    const missingOrigin = await app.request('/api/tokens', { method: 'POST', cookie, origin: null, body: { name: 'stolen', expiresInDays: 30 } })

    expect([crossSiteWrite.status, missingOrigin.status]).toEqual([403, 403])
  })
})

describe('personal API tokens', () => {
  it('names a long agent client without cutting a word in half', async () => {
    const cookie = await app.signIn('lin@example.com')
    const { body } = await app.json<{ token: string }>('/api/tokens', { method: 'POST', cookie, body: { name: 'long client', expiresInDays: 30 } })

    const published = await app.publish({ token: body.token, agentClient: 'Acme Research Assistant for Quarterly Planning Reviews' }, 'Long client name')
    const read = await app.json<{ publishedVia: string }>(`/api/artifacts/${published.artifactId}`, { cookie })

    expect(read.body.publishedVia).toBe('Acme Research Assistant for Quarterly…')
  })


  it('shows the token once, stores only what it needs, and lets an agent act as its person', async () => {
    const cookie = await app.signIn('lin@example.com')
    const created = await app.json<{ token: string; name: string; expiresAt: number }>('/api/tokens', { method: 'POST', cookie, body: { name: 'Claude Code · laptop', expiresInDays: 30 } })

    const published = await app.publish({ token: created.body.token, agentClient: 'Claude Code' }, 'Design doc')
    const listed = await app.json<{ tokens: { name: string; lastUsedAt: number | null }[] }>('/api/tokens', { cookie })
    const read = await app.json<{ publishedVia: string; author: { name: string } }>(`/api/artifacts/${published.artifactId}`, { cookie })

    expect(created.status).toBe(201)
    expect(created.body.token).toMatch(/^oa_pat_/)
    expect(created.body.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000)
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token)
    expect(listed.body.tokens.find(token => token.name === 'Claude Code · laptop')?.lastUsedAt).not.toBeNull()
    expect(read.body).toMatchObject({ publishedVia: 'Claude Code', author: { name: 'lin' } })
  })

  it('names direct API calls "API" when the agent does not say who it is', async () => {
    const cookie = await app.signIn('lin@example.com')
    const token = await app.createToken(cookie)

    const published = await app.publish({ token }, 'Script output')
    const read = await app.json<{ publishedVia: string }>(`/api/artifacts/${published.artifactId}`, { token })

    expect(read.body.publishedVia).toBe('API')
  })

  it('keeps token management out of reach of a token', async () => {
    const cookie = await app.signIn('lin@example.com')
    const token = await app.createToken(cookie)

    const mintWithToken = await app.request('/api/tokens', { method: 'POST', token, body: { name: 'escalate', expiresInDays: 30 } })

    expect(mintWithToken.status).toBe(403)
  })

  it('stops a revoked token at once, and only its owner can revoke it', async () => {
    const ownerCookie = await app.signIn('lin@example.com')
    const strangerCookie = await app.signIn('zhou@example.com')
    const created = await app.json<{ token: string; tokenId: string }>('/api/tokens', { method: 'POST', cookie: ownerCookie, body: { name: 'CI', expiresInDays: null } })

    const strangerRevoke = await app.request(`/api/tokens/${created.body.tokenId}`, { method: 'DELETE', cookie: strangerCookie })
    const ownerRevoke = await app.request(`/api/tokens/${created.body.tokenId}`, { method: 'DELETE', cookie: ownerCookie })
    const afterRevoke = await app.request('/api/artifacts', { token: created.body.token })

    expect([strangerRevoke.status, ownerRevoke.status, afterRevoke.status]).toEqual([404, 204, 401])
  })

  it('tells an agent whether its token was revoked, has expired or was never valid', async () => {
    const cookie = await app.signIn('lin@example.com')
    const revoked = await app.json<{ tokenId: string; token: string; userId: string; workspaceId: string }>('/api/tokens', { method: 'POST', cookie, body: { name: 'old laptop', expiresInDays: 30 } })
    await app.request(`/api/tokens/${revoked.body.tokenId}`, { method: 'DELETE', cookie })
    const me = await app.json<{ user: { userId: string }; workspace: { workspaceId: string } }>('/api/me', { cookie })
    const expiredToken = AccessTokenSecret.generate()
    await app.repositories.accessTokens.create({ userId: me.body.user.userId, workspaceId: me.body.workspace.workspaceId, name: 'expired', tokenHash: await AccessTokenSecret.hashOf(expiredToken), scope: 'publish', expiresAt: Date.now() - 1 })

    const answers = await Promise.all([revoked.body.token, expiredToken, 'oa_pat_neverissued', 'garbage'].map(token => app.json<{ code: string; error: string }>('/api/artifacts', { token })))

    expect(answers.map(answer => answer.status)).toEqual([401, 401, 401, 401])
    expect(answers.map(answer => answer.body.code)).toEqual(['token_revoked', 'token_expired', 'token_invalid', 'token_invalid'])
    expect(answers[0]?.body.error).toContain('revoked')
  })

  it('deletes a token from the list once it no longer works, and never deletes a working one in one step', async () => {
    const cookie = await app.signIn('lin@example.com')
    const created = await app.json<{ tokenId: string }>('/api/tokens', { method: 'POST', cookie, body: { name: 'to forget', expiresInDays: 30 } })
    const tokenPath = `/api/tokens/${created.body.tokenId}`

    const firstDelete = await app.request(tokenPath, { method: 'DELETE', cookie })
    const stillListed = (await app.json<{ tokens: { tokenId: string; revokedAt: number | null }[] }>('/api/tokens', { cookie })).body.tokens.find(token => token.tokenId === created.body.tokenId)
    const secondDelete = await app.request(tokenPath, { method: 'DELETE', cookie })
    const listedAfter = (await app.json<{ tokens: { tokenId: string }[] }>('/api/tokens', { cookie })).body.tokens.map(token => token.tokenId)
    const thirdDelete = await app.json<{ code: string }>(tokenPath, { method: 'DELETE', cookie })

    expect(firstDelete.status).toBe(204)
    expect(stillListed?.revokedAt).not.toBeNull()
    expect(secondDelete.status).toBe(204)
    expect(listedAfter).not.toContain(created.body.tokenId)
    expect(thirdDelete).toMatchObject({ status: 404, body: { code: 'not_found' } })
  })

  it('refuses a revoked token even where anyone may read, instead of treating it as anonymous', async () => {
    const cookie = await app.signIn('lin@example.com')
    const created = await app.json<{ tokenId: string; token: string }>('/api/tokens', { method: 'POST', cookie, body: { name: 'gone', expiresInDays: 30 } })
    const published = await app.publish({ cookie }, 'Open to anyone', '<h1>x</h1>', 'public_link')
    await app.request(`/api/tokens/${created.body.tokenId}`, { method: 'DELETE', cookie })

    const read = await app.json<{ code: string }>(`/api/artifacts/${published.artifactId}`, { token: created.body.token })

    expect(read).toMatchObject({ status: 401, body: { code: 'token_revoked' } })
  })

  it('gives a new token the publish scope unless full access is chosen', async () => {
    const cookie = await app.signIn('lin@example.com')

    const defaulted = await app.json<{ scope: string }>('/api/tokens', { method: 'POST', cookie, body: { name: 'Default', expiresInDays: 30 } })
    const full = await app.json<{ scope: string }>('/api/tokens', { method: 'POST', cookie, body: { name: 'Full', expiresInDays: 30, scope: 'full' } })
    const unknown = await app.request('/api/tokens', { method: 'POST', cookie, body: { name: 'Admin', expiresInDays: 30, scope: 'admin' } })
    const listed = await app.json<{ tokens: { name: string; scope: string }[] }>('/api/tokens', { cookie })

    expect([defaulted.body.scope, full.body.scope, unknown.status]).toEqual(['publish', 'full', 400])
    expect(listed.body.tokens.find(token => token.name === 'Full')?.scope).toBe('full')
  })

  it('lets a publish token publish, comment and use shared data, but not change sharing', async () => {
    const cookie = await app.signIn('lin@example.com')
    const publishToken = await app.createToken(cookie, 'publish')
    const published = await app.publish({ token: publishToken }, 'Scoped work')
    const artifactPath = `/api/artifacts/${published.artifactId}`

    const update = await app.request(artifactPath, { method: 'PUT', token: publishToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: 'v2' }] } })
    const comment = await app.request(`${artifactPath}/comments`, { method: 'POST', token: publishToken, body: { body: 'done' } })
    const sharedData = await app.request(`${artifactPath}/data/notes/first`, { method: 'PUT', token: publishToken, body: { data: { text: 'hi' } } })
    const readSharing = await app.json<{ error: string }>(`${artifactPath}/sharing`, { token: publishToken })
    const changeSharing = await app.json<{ error: string }>(`${artifactPath}/sharing`, { method: 'PUT', token: publishToken, body: { visibility: 'public_link' } })
    const listed = await app.json<{ permissions: { canManageSharing: boolean } }>(artifactPath, { token: publishToken })

    expect([update.status, comment.status, sharedData.status]).toEqual([200, 201, 200])
    expect([readSharing.status, changeSharing.status]).toEqual([403, 403])
    expect(changeSharing.body.error).toContain('this token may only publish')
    expect(changeSharing.body.error).toContain('full access')
    expect(listed.body.permissions.canManageSharing).toBe(false)
  })

  it('lets a full token change sharing as its person could', async () => {
    const cookie = await app.signIn('lin@example.com')
    const fullToken = await app.createToken(cookie, 'full')
    const published = await app.publish({ token: fullToken }, 'Full access work')

    const changeSharing = await app.request(`/api/artifacts/${published.artifactId}/sharing`, { method: 'PUT', token: fullToken, body: { visibility: 'private' } })

    expect(changeSharing.status).toBe(200)
  })

  it('tells a publish token that is not the author plainly that it lacks permission, not scope', async () => {
    const authorCookie = await app.signIn('lin@example.com')
    const colleagueCookie = await app.signIn('zhou@example.com')
    const published = await app.publish({ cookie: authorCookie, origin: APP_ORIGIN }, 'Not yours')

    const colleagueAttempt = await app.json<{ error: string }>(`/api/artifacts/${published.artifactId}/sharing`, { method: 'PUT', token: await app.createToken(colleagueCookie, 'publish'), body: { visibility: 'private' } })

    expect(colleagueAttempt.status).toBe(403)
    expect(colleagueAttempt.body.error).not.toContain('this token may only publish')
  })

  it('rejects a token lifetime it does not offer', async () => {
    const cookie = await app.signIn('lin@example.com')

    const tooLong = await app.request('/api/tokens', { method: 'POST', cookie, body: { name: 'forever-ish', expiresInDays: 5000 } })

    expect(tooLong.status).toBe(400)
  })
})

describe('who may sign up', () => {
  it('refuses an email outside the allowed domains before sending any link, without naming the domains', async () => {
    const refused = await app.json<{ message: string; code: string }>('/api/auth/sign-in/magic-link', { method: 'POST', body: { email: 'stranger@other.org', callbackURL: '/' } })

    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ code: 'EMAIL_NOT_ADMITTED', message: '这个邮箱不能登录 Open Artifact。请用公司邮箱，或请管理员邀请你。' })
    expect(refused.body.message).not.toContain('example.com')
    expect(app.mailer.lastTo('stranger@other.org')).toBeUndefined()
  })

  it('lets only the founder sign up when no domains are allowed, while existing people still sign in', async () => {
    const founderOnlyApp = new TestApp({})
    await app.signIn('lin@example.com')

    const newcomer = await founderOnlyApp.request('/api/auth/sign-in/magic-link', { method: 'POST', body: { email: 'newcomer@example.com', callbackURL: '/' } })
    const existingPerson = await founderOnlyApp.signIn('lin@example.com')

    expect(newcomer.status).toBe(403)
    expect(existingPerson).toContain('session_token')
  })

  it('lets any address sign up and join the first workspace when the allowed domains are "*"', async () => {
    const openApp = new TestApp({ allowedEmailDomains: '*' })
    await openApp.signIn('lin@example.com')

    const strangerCookie = await openApp.signIn('stranger@other.org')
    const me = await openApp.json<{ workspace: { role: string } }>('/api/me', { cookie: strangerCookie })

    expect(strangerCookie).toContain('session_token')
    expect(me.body.workspace).toMatchObject({ role: 'member' })
  })
})

/** Stands in for the Cloudflare Email Service binding: keeps what it was asked to send, or refuses with a service error code. */
class EmailServiceStandIn implements SendEmail {
  readonly sent: (EmailMessage | EmailMessageBuilder)[] = []
  #refusalCode: string | undefined

  async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
    if (this.#refusalCode) throw Object.assign(new Error(`sender not allowed for ${JSON.stringify(message)}`), { code: this.#refusalCode })
    this.sent.push(message)
    return { messageId: `message-${this.sent.length}` }
  }

  refuseWith(code: string): void {
    this.#refusalCode = code
  }
}

describe('mail', () => {
  const signInEmail = { to: 'lin@example.com', subject: '登录 Open Artifact', text: 'https://app.test/sign-in' }

  it('fails loudly instead of logging sign-in links when no mail service is configured', async () => {
    await expect(Mailers.fromEnv({}).send(signInEmail)).rejects.toThrow('No mail service is configured')
  })

  it('sends through Cloudflare Email Service from the configured sender', async () => {
    const emailService = new EmailServiceStandIn()

    await Mailers.fromEnv({ MAILER: 'cloudflare', EMAIL: emailService, MAIL_FROM: 'Open Artifact <noreply@example.com>' }).send(signInEmail)
    await Mailers.fromEnv({ MAILER: 'cloudflare', EMAIL: emailService, MAIL_FROM: 'noreply@example.com' }).send(signInEmail)

    expect(emailService.sent).toEqual([
      { from: { name: 'Open Artifact', email: 'noreply@example.com' }, to: 'lin@example.com', subject: '登录 Open Artifact', text: 'https://app.test/sign-in' },
      { from: 'noreply@example.com', to: 'lin@example.com', subject: '登录 Open Artifact', text: 'https://app.test/sign-in' },
    ])
  })

  it('reports the service error code without the recipient and keeps the original error', async () => {
    const emailService = new EmailServiceStandIn()
    emailService.refuseWith('E_SENDER_NOT_VERIFIED')
    const mailer = Mailers.fromEnv({ MAILER: 'cloudflare', EMAIL: emailService, MAIL_FROM: 'noreply@example.com' })

    const failure = await mailer.send(signInEmail).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Cloudflare Email Service did not send the message: E_SENDER_NOT_VERIFIED')
    expect((failure as Error).cause).toEqual(expect.objectContaining({ code: 'E_SENDER_NOT_VERIFIED' }))
  })

  it('refuses a mail configuration that could never send, before any sign-in', () => {
    const emailService = new EmailServiceStandIn()

    expect(() => Mailers.fromEnv({ MAILER: 'cloudflare', MAIL_FROM: 'noreply@example.com' })).toThrow(MailerConfigError)
    expect(() => Mailers.fromEnv({ MAILER: 'cloudflare', EMAIL: emailService })).toThrow('MAILER=cloudflare needs MAIL_FROM')
    expect(() => Mailers.fromEnv({ MAILER: 'cloudflare', EMAIL: emailService, MAIL_FROM: 'Open Artifact' })).toThrow('MAIL_FROM must look like')
    expect(() => Mailers.fromEnv({ MAILER: 'sendgrid' })).toThrow('MAILER="sendgrid" is not a mail service')
  })
})

describe('tokens and workspaces', () => {
  it('limits a token to the workspace it was created for', async () => {
    const { env } = await import('cloudflare:workers')
    const ownerCookie = await app.signIn('lin@example.com')
    const token = await app.createToken(ownerCookie)
    const me = await app.json<{ user: { userId: string } }>('/api/me', { cookie: ownerCookie })
    await env.DB.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').bind('workspace-other', 'Other team', Date.now()).run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('workspace-other', ?, 'member', ?)").bind(me.body.user.userId, Date.now()).run()
    const otherArtifact = await app.repositories.artifacts.create({ workspaceId: 'workspace-other', authorId: 'someone-else', title: 'Other team plan', slug: 'other-team-plan', visibility: 'workspace', publicLinkExpiresAt: null, publishedVia: null, note: null, excerpt: null, listed: false, summary: null, files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })

    const withCookie = await app.request(`/api/artifacts/${otherArtifact.artifactId}`, { cookie: ownerCookie })
    const withToken = await app.request(`/api/artifacts/${otherArtifact.artifactId}`, { token })

    expect(withCookie.status).toBe(200)
    expect(withToken.status).toBe(404)
  })
})

describe('asking for sign-in links', () => {
  const limitedApp = new TestApp({ allowedEmailDomains: 'example.com', productionSignInLimits: true })
  const askForLink = (email: string, senderAddress?: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: 'http://app.test' })
    if (senderAddress) headers.set('CF-Connecting-IP', senderAddress)
    return limitedApp.routes.respond(new Request('http://app.test/api/auth/sign-in/magic-link', { method: 'POST', headers, body: JSON.stringify({ email, callbackURL: '/' }) }))
  }

  it('mails one address at most three links a minute, whatever letter case is used', async () => {
    const answers = await Promise.all(['Flood@example.com', 'flood@example.com', 'FLOOD@example.com'].map(email => askForLink(email)))
    const fourth = await askForLink('flood@example.com')
    const someoneElse = await askForLink('calm@example.com')

    expect(answers.map(answer => answer.status)).toEqual([200, 200, 200])
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('Retry-After')).toBe('60')
    expect(await fourth.json()).toMatchObject({ code: 'rate_limited' })
    expect(someoneElse.status).toBe(200)
  })

  it('stops one sender from asking for links to many addresses', async () => {
    const statuses: number[] = []
    for (let index = 0; index < 21; index++) statuses.push((await askForLink(`sender-${index}@example.com`, '203.0.113.7')).status)

    expect(statuses.slice(0, 20).every(status => status === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
    expect((await askForLink('other-network@example.com', '198.51.100.1')).status).toBe(200)
  })
})
