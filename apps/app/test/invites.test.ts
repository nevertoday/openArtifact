import { beforeAll, describe, expect, it } from 'vitest'
import { APP_ORIGIN, TestApp } from './test-app.ts'

const app = new TestApp()
let adminCookie = ''

interface InviteJson {
  inviteId: string
  email: string | null
  url: string
  invitedBy: { name: string }
  expiresAt: number
}

interface AuditEventJson {
  action: string
  actor: { name: string }
  detail: Record<string, unknown>
}

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
  await app.request('/api/workspace', { method: 'PATCH', cookie: adminCookie, body: { name: '设计组' } })
})

async function userIdOf(cookie: string): Promise<string> {
  const { body } = await app.json<{ user: { userId: string } }>('/api/me', { cookie })
  return body.user.userId
}

async function createLink(cookie = adminCookie): Promise<InviteJson> {
  const { status, body } = await app.json<{ invite: InviteJson }>('/api/workspace/invites/link', { method: 'POST', cookie })
  if (status !== 201) throw new Error(`creating an invite link failed with ${status}`)
  return body.invite
}

async function inviteByEmail(emails: string[]) {
  return app.json<{ invites: InviteJson[]; alreadyMembers: string[] }>('/api/workspace/invites/email', { method: 'POST', cookie: adminCookie, body: { emails } })
}

/** Opens the invite link as a browser does, and returns the cookie it keeps. */
async function openInviteLink(url: string): Promise<{ markup: string; status: number; browserCookie: string }> {
  const response = await app.request(new URL(url).pathname)
  const browserCookie = response.headers.getSetCookie().map(setCookie => setCookie.split(';')[0]).join('; ')
  return { markup: await response.text(), status: response.status, browserCookie }
}

async function pendingInvites(): Promise<InviteJson[]> {
  const { body } = await app.json<{ invites: InviteJson[] }>('/api/workspace/invites', { cookie: adminCookie })
  return body.invites
}

async function auditEvents(): Promise<AuditEventJson[]> {
  const { body } = await app.json<{ events: AuditEventJson[] }>('/api/workspace/audit', { cookie: adminCookie })
  return body.events
}

describe('an invite link', () => {
  it('lets someone outside the allowed domains join, and lands them on a login page that says who invited them', async () => {
    const link = await createLink()

    const opened = await openInviteLink(link.url)
    const guestCookie = await app.signInAlone('guest@partner.org', opened.browserCookie)
    const guest = await app.json<{ workspace: { name: string; role: string } }>('/api/me', { cookie: guestCookie })
    const linkAfterUse = await pendingInvites()

    expect(link).toMatchObject({ email: null, invitedBy: { name: 'admin' } })
    expect(link.url).toMatch(new RegExp(`^${APP_ORIGIN}/invite/`))
    expect(link.expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
    expect(opened.status).toBe(200)
    expect(opened.markup).toContain('admin 邀请你加入 设计组')
    expect(opened.markup).toContain(`data-next-path="${new URL(link.url).pathname}"`)
    expect(guest.body.workspace).toMatchObject({ name: '设计组', role: 'member' })
    expect(linkAfterUse.map(invite => invite.inviteId)).toContain(link.inviteId)
    expect((await auditEvents())[0]).toMatchObject({ action: 'member.joined', actor: { name: 'guest' }, detail: { via: 'link' } })
  })

  it('sends a signed-in member straight home', async () => {
    const link = await createLink()

    const response = await app.request(new URL(link.url).pathname, { cookie: adminCookie })

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(`${APP_ORIGIN}/`)
  })

  it('stops working once revoked, and says so', async () => {
    const link = await createLink()
    const opened = await openInviteLink(link.url)

    const revocation = await app.request(`/api/workspace/invites/${link.inviteId}`, { method: 'DELETE', cookie: adminCookie })
    const reopened = await openInviteLink(link.url)
    const signUp = await app.json<{ code: string }>('/api/auth/sign-in/send-code', { method: 'POST', cookie: opened.browserCookie, body: { email: 'late@partner.org' } })

    expect(revocation.status).toBe(204)
    expect(reopened.status).toBe(410)
    expect(reopened.markup).toContain('这个邀请已经失效')
    expect(signUp.status).toBe(403)
    expect(signUp.body.code).toBe('EMAIL_NOT_ADMITTED')
    expect((await auditEvents())[0]).toMatchObject({ action: 'invite.revoked', actor: { name: 'admin' }, detail: { email: null } })
  })

  it('does not bring back a person an admin removed', async () => {
    const removedCookie = await app.signIn('removed-by-link@example.com')
    await app.request(`/api/workspace/members/${await userIdOf(removedCookie)}`, { method: 'DELETE', cookie: adminCookie })
    const link = await createLink()

    const opened = await openInviteLink(link.url)
    const freshCookie = await app.signInAlone('removed-by-link@example.com', opened.browserCookie)
    const me = await app.json<{ workspaces: { workspaceId: string }[] }>('/api/me', { cookie: `${freshCookie}; ${opened.browserCookie}` })
    const invitePage = await app.request(new URL(link.url).pathname, { cookie: `${freshCookie}; ${opened.browserCookie}` })

    expect(me.body.workspaces.map(workspace => workspace.workspaceId)).not.toContain(app.teamWorkspaceId)
    expect(invitePage.status).toBe(403)
    expect(await invitePage.text()).toContain('你已被移出这个工作区')
  })
})

describe('an email invite', () => {
  it('mails the address a link, lets that address join without any link, and is spent once used', async () => {
    const invited = await inviteByEmail([' Wu@Partner.org ', 'chen@partner.org'])
    const mail = app.mailer.lastTo('wu@partner.org')

    const wuCookie = await app.signInAlone('wu@partner.org')
    const wu = await app.json<{ workspace: { name: string } }>('/api/me', { cookie: wuCookie })
    const stillPending = await pendingInvites()

    expect(invited.status).toBe(201)
    expect(invited.body.invites.map(invite => invite.email)).toEqual(['wu@partner.org', 'chen@partner.org'])
    expect(mail?.subject).toBe('admin 邀请你加入 设计组 / admin invited you to join 设计组')
    expect(mail?.text).toContain(invited.body.invites[0]?.url)
    expect(wu.body.workspace.name).toBe('设计组')
    expect(stillPending.map(invite => invite.email)).not.toContain('wu@partner.org')
    expect(stillPending.map(invite => invite.email)).toContain('chen@partner.org')
    expect((await auditEvents()).map(auditEvent => auditEvent.action)).toEqual(expect.arrayContaining(['member.joined', 'member.invited']))
  })

  it('brings back a person an admin removed', async () => {
    const returningCookie = await app.signIn('returning@example.com')
    const returningId = await userIdOf(returningCookie)
    await app.request(`/api/workspace/members/${returningId}`, { method: 'DELETE', cookie: adminCookie })

    const invited = await inviteByEmail(['returning@example.com'])
    const freshCookie = await app.signInAlone('returning@example.com')
    const followed = await app.request(new URL(invited.body.invites[0]?.url ?? '').pathname, { cookie: freshCookie })
    const workspaceCookie = followed.headers.getSetCookie().map(setCookie => setCookie.split(';')[0]).join('; ')
    const me = await app.json<{ workspace: { workspaceId: string; role: string } }>('/api/me', { cookie: `${freshCookie}; ${workspaceCookie}` })

    expect(followed.status).toBe(302)
    expect(me.body.workspace).toMatchObject({ workspaceId: app.teamWorkspaceId, role: 'member' })
  })

  it('skips people who are already members, and still invites when the mail cannot be sent', async () => {
    const outOfService = new TestApp()
    outOfService.mailer.goOutOfService()

    const alreadyMember = await inviteByEmail(['admin@example.com', 'new@partner.org'])
    const withoutMail = await outOfService.json<{ invites: InviteJson[] }>('/api/workspace/invites/email', { method: 'POST', cookie: adminCookie, body: { emails: ['nomail@partner.org'] } })

    expect(alreadyMember.body.alreadyMembers).toEqual(['admin@example.com'])
    expect(alreadyMember.body.invites.map(invite => invite.email)).toEqual(['new@partner.org'])
    expect(withoutMail.status).toBe(201)
    expect(withoutMail.body.invites[0]?.email).toBe('nomail@partner.org')
  })

  it('refuses an address that is not an email, and an empty list', async () => {
    const notEmail = await app.request('/api/workspace/invites/email', { method: 'POST', cookie: adminCookie, body: { emails: ['not-an-email'] } })
    const empty = await app.request('/api/workspace/invites/email', { method: 'POST', cookie: adminCookie, body: { emails: [] } })

    expect([notEmail.status, empty.status]).toEqual([400, 400])
  })

  it('tells a signed-in person when the invite is for another address', async () => {
    const [invite] = (await inviteByEmail(['someone-else@partner.org'])).body.invites

    const response = await app.request(new URL(invite?.url ?? '').pathname, { cookie: adminCookie })

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('someone-else@partner.org')
  })
})

describe('who manages invites', () => {
  it('is an admin in the browser only', async () => {
    const memberCookie = await app.signIn('plain-member@example.com')
    const adminToken = await app.createToken(adminCookie)

    const byMember = await app.request('/api/workspace/invites/link', { method: 'POST', cookie: memberCookie })
    const byToken = await app.request('/api/workspace/invites/link', { method: 'POST', token: adminToken })
    const listByMember = await app.request('/api/workspace/invites', { cookie: memberCookie })
    const unknownRevoke = await app.request('/api/workspace/invites/no-such-invite', { method: 'DELETE', cookie: adminCookie })

    expect([byMember.status, byToken.status, listByMember.status, unknownRevoke.status]).toEqual([403, 403, 403, 404])
  })
})

describe('the members page', () => {
  it('gives an admin the invite tools and tells a member to ask an admin', async () => {
    const memberCookie = await app.signIn('page-member@example.com')

    const adminMarkup = await (await app.request('/settings/members', { cookie: adminCookie })).text()
    const memberMarkup = await (await app.request('/settings/members', { cookie: memberCookie })).text()

    expect(adminMarkup).toContain('id="invite-email-form"')
    expect(adminMarkup).toContain('生成邀请链接')
    expect(memberMarkup).not.toContain('id="invite-email-form"')
    expect(memberMarkup).toContain('要请同事加入，请管理员邀请。')
  })
})
