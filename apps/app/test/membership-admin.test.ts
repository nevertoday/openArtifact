import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let adminCookie = ''
let adminId = ''

interface MemberJson {
  userId: string
  name: string
  role: string
}

interface AuditEventJson {
  action: string
  actor: { name: string }
  member: { name: string } | null
  detail: Record<string, unknown>
}

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
  adminId = await userIdOf(adminCookie)
})

async function userIdOf(cookie: string): Promise<string> {
  const { body } = await app.json<{ user: { userId: string } }>('/api/me', { cookie })
  return body.user.userId
}

async function members(): Promise<MemberJson[]> {
  const { body } = await app.json<{ members: MemberJson[] }>('/api/workspace/members', { cookie: adminCookie })
  return body.members
}

async function setRole(userId: string, role: string, cookie = adminCookie): Promise<Response> {
  return app.request(`/api/workspace/members/${userId}`, { method: 'PATCH', cookie, body: { role } })
}

async function latestAuditEvent(): Promise<AuditEventJson | undefined> {
  const { body } = await app.json<{ events: AuditEventJson[] }>('/api/workspace/audit', { cookie: adminCookie })
  return body.events[0]
}

describe('changing a member\'s role', () => {
  it('lets an admin make a member admin and back, and records each change', async () => {
    const colleagueCookie = await app.signIn('lin@example.com')
    const colleagueId = await userIdOf(colleagueCookie)

    const promotion = await setRole(colleagueId, 'admin')
    const asAdmin = await app.json<{ workspace: { role: string } }>('/api/me', { cookie: colleagueCookie })
    const promotionEvent = await latestAuditEvent()
    const demotion = await setRole(colleagueId, 'member')

    expect([promotion.status, demotion.status]).toEqual([200, 200])
    expect(asAdmin.body.workspace.role).toBe('admin')
    expect(promotionEvent).toMatchObject({ action: 'member.role_changed', actor: { name: 'admin' }, member: { name: 'lin' }, detail: { from: 'member', to: 'admin' } })
    expect((await members()).find(member => member.userId === colleagueId)?.role).toBe('member')
  })

  it('refuses a member, a token and an unknown role', async () => {
    const memberCookie = await app.signIn('zhou@example.com')
    const memberId = await userIdOf(memberCookie)
    const adminToken = await app.createToken(adminCookie)

    const byMember = await setRole(memberId, 'admin', memberCookie)
    const byToken = await app.request(`/api/workspace/members/${memberId}`, { method: 'PATCH', token: adminToken, body: { role: 'admin' } })
    const unknownRole = await setRole(memberId, 'owner')
    const unknownPerson = await setRole('no-such-user', 'admin')

    expect([byMember.status, byToken.status, unknownRole.status, unknownPerson.status]).toEqual([403, 403, 400, 404])
  })

  it('never leaves the workspace without an admin', async () => {
    const lastAdminDemotion = await app.json<{ error: string }>(`/api/workspace/members/${adminId}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'member' } })
    const deputyCookie = await app.signIn('deputy@example.com')
    const deputyId = await userIdOf(deputyCookie)
    await setRole(deputyId, 'admin')
    const deputySteppingDown = await setRole(deputyId, 'member', deputyCookie)

    expect(lastAdminDemotion.status).toBe(400)
    expect(lastAdminDemotion.body.error).toContain('at least one admin')
    expect(deputySteppingDown.status).toBe(200)
  })
})

describe('removing a member', () => {
  it('ends their access at once: session, tokens and grants, and records it', async () => {
    const leaverCookie = await app.signIn('leaver@example.com')
    const leaverId = await userIdOf(leaverCookie)
    const leaverToken = await app.createToken(leaverCookie)
    const authorCookie = await app.signIn('author@example.com')
    const specified = await app.publish({ cookie: authorCookie }, 'Need to know', '<h1>x</h1>', 'specified')
    await app.grant(authorCookie, specified.artifactId, 'leaver@example.com', 'viewer')
    const grantsBefore = await app.json<{ grants: { userId: string }[] }>(`/api/artifacts/${specified.artifactId}/sharing`, { cookie: authorCookie })

    const removal = await app.request(`/api/workspace/members/${leaverId}`, { method: 'DELETE', cookie: adminCookie })
    const sessionAfter = await app.json<{ error: string }>('/api/me', { cookie: leaverCookie })
    const tokenAfter = await app.request('/api/artifacts', { token: leaverToken })
    const homeAfter = await app.request('/', { cookie: leaverCookie })
    const grantsAfter = await app.json<{ grants: { userId: string }[] }>(`/api/artifacts/${specified.artifactId}/sharing`, { cookie: authorCookie })
    const leaverTokens = await app.repositories.accessTokens.listForUser(leaverId)

    expect(grantsBefore.body.grants.map(grant => grant.userId)).toContain(leaverId)
    expect(removal.status).toBe(204)
    expect(sessionAfter.status).toBe(403)
    expect(sessionAfter.body.error).toContain('removed from this workspace')
    expect(tokenAfter.status).toBe(401)
    expect(homeAfter.status).toBe(403)
    expect(await homeAfter.text()).toContain('你已被移出这个 workspace，请联系管理员')
    expect(grantsAfter.body.grants.map(grant => grant.userId)).not.toContain(leaverId)
    expect(leaverTokens.every(accessToken => accessToken.revokedAt !== null)).toBe(true)
    expect((await members()).map(member => member.userId)).not.toContain(leaverId)
    expect(await latestAuditEvent()).toMatchObject({ action: 'member.removed', actor: { name: 'admin' }, member: { name: 'leaver' } })
  })

  it('does not let a removed person back in by signing in again', async () => {
    await app.signIn('gone@example.com')
    const goneId = await userIdOf(await app.signIn('gone@example.com'))
    await app.request(`/api/workspace/members/${goneId}`, { method: 'DELETE', cookie: adminCookie })

    const freshCookie = await app.signIn('gone@example.com')
    const me = await app.request('/api/me', { cookie: freshCookie })
    const loginPage = await app.request('/login', { cookie: freshCookie })

    expect(me.status).toBe(403)
    expect(await loginPage.text()).toContain('你已被移出这个 workspace，请联系管理员')
    expect((await members()).map(member => member.userId)).not.toContain(goneId)
  })

  it('refuses an admin removing themselves, a member removing anyone, and an unknown person', async () => {
    const memberCookie = await app.signIn('bystander@example.com')

    const selfRemoval = await app.json<{ error: string }>(`/api/workspace/members/${adminId}`, { method: 'DELETE', cookie: adminCookie })
    const byMember = await app.request(`/api/workspace/members/${adminId}`, { method: 'DELETE', cookie: memberCookie })
    const unknownPerson = await app.request('/api/workspace/members/no-such-user', { method: 'DELETE', cookie: adminCookie })

    expect(selfRemoval.status).toBe(400)
    expect(selfRemoval.body.error).toContain('yourself')
    expect(byMember.status).toBe(403)
    expect(unknownPerson.status).toBe(404)
  })
})

describe('an author removed from the workspace', () => {
  // A second workspace keeps the removed author signed in, so only the rule about their old pages is left to see.
  async function alsoMemberElsewhere(userId: string): Promise<void> {
    await env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('workspace-elsewhere', 'Elsewhere', ?)").bind(Date.now()).run()
    await env.DB.prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('workspace-elsewhere', ?, 'member', ?)").bind(userId, Date.now()).run()
  }

  async function personalPageMarkup(handlePath: string): Promise<string> {
    return (await app.request(handlePath)).text()
  }

  it('loses control of the pages they left behind, while an author who stays keeps it', async () => {
    const formerCookie = await app.signIn('former-author@example.com')
    const formerId = await userIdOf(formerCookie)
    await alsoMemberElsewhere(formerId)
    const stayingCookie = await app.signIn('staying-author@example.com')
    const teamPage = await app.publish({ cookie: formerCookie }, 'Team-only roadmap')
    const publicPage = await app.publish({ cookie: formerCookie }, 'Public changelog', '<h1>log</h1>', 'public_link')
    await app.request(`/api/artifacts/${publicPage.artifactId}/sharing`, { method: 'PUT', cookie: formerCookie, body: { publicLinkExpiresAt: null, listed: true } })
    const stayingPage = await app.publish({ cookie: stayingCookie }, 'Staying notes')
    const handlePath = (await app.request('/@me', { cookie: formerCookie })).headers.get('Location') ?? ''
    const listedBefore = await personalPageMarkup(handlePath)
    const editBefore = await app.request(`/api/artifacts/${teamPage.artifactId}`, { method: 'PUT', cookie: formerCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    await app.request(`/api/workspace/members/${formerId}`, { method: 'DELETE', cookie: adminCookie })
    const viewAfter = await app.request(`/api/artifacts/${teamPage.artifactId}`, { cookie: formerCookie })
    const editAfter = await app.request(`/api/artifacts/${teamPage.artifactId}`, { method: 'PUT', cookie: formerCookie, body: { baseVersion: 2, files: [{ path: 'index.html', content: '<h1>v3</h1>' }] } })
    const sharingAfter = await app.request(`/api/artifacts/${teamPage.artifactId}/sharing`, { method: 'PUT', cookie: formerCookie, body: { visibility: 'public_link' } })
    const publicViewAfter = await app.request(`/api/artifacts/${publicPage.artifactId}`, { cookie: formerCookie })
    const publicSharingAfter = await app.request(`/api/artifacts/${publicPage.artifactId}/sharing`, { cookie: formerCookie })
    const stayingEdit = await app.request(`/api/artifacts/${stayingPage.artifactId}`, { method: 'PUT', cookie: stayingCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const stayingSharing = await app.request(`/api/artifacts/${stayingPage.artifactId}/sharing`, { cookie: stayingCookie })

    expect(editBefore.status).toBe(200)
    expect(listedBefore).toContain('Public changelog')
    expect([viewAfter.status, editAfter.status, sharingAfter.status]).toEqual([404, 404, 404])
    expect([publicViewAfter.status, publicSharingAfter.status]).toEqual([200, 403])
    expect([stayingEdit.status, stayingSharing.status]).toEqual([200, 200])
    expect(await personalPageMarkup(handlePath)).not.toContain('Public changelog')
  })
})

describe('renaming the workspace', () => {
  it('lets an admin rename it, trimmed, and records the change', async () => {
    const before = await app.json<{ workspace: { name: string } }>('/api/me', { cookie: adminCookie })

    const renamed = await app.json<{ name: string }>('/api/workspace', { method: 'PATCH', cookie: adminCookie, body: { name: '  设计组  ' } })
    const after = await app.json<{ workspace: { name: string } }>('/api/me', { cookie: adminCookie })
    const renameEvent = await latestAuditEvent()

    expect(renamed.status).toBe(200)
    expect(after.body.workspace.name).toBe('设计组')
    expect(renameEvent).toMatchObject({ action: 'workspace.renamed', actor: { name: 'admin' }, member: null, detail: { from: before.body.workspace.name, to: '设计组' } })
  })

  it('refuses a blank or too long name, a member and a token', async () => {
    const memberCookie = await app.signIn('renamer@example.com')
    const adminToken = await app.createToken(adminCookie)

    const blank = await app.request('/api/workspace', { method: 'PATCH', cookie: adminCookie, body: { name: '   ' } })
    const tooLong = await app.request('/api/workspace', { method: 'PATCH', cookie: adminCookie, body: { name: '名'.repeat(41) } })
    const byMember = await app.request('/api/workspace', { method: 'PATCH', cookie: memberCookie, body: { name: '我的' } })
    const byToken = await app.request('/api/workspace', { method: 'PATCH', token: adminToken, body: { name: '我的' } })

    expect([blank.status, tooLong.status, byMember.status, byToken.status]).toEqual([400, 400, 403, 403])
  })

  it('keeps the workspace name out of running text', async () => {
    await app.request('/api/workspace', { method: 'PATCH', cookie: adminCookie, body: { name: '增长组' } })

    const homeMarkup = await (await app.request('/', { cookie: adminCookie })).text()
    const agentsMarkup = await (await app.request('/settings/agents', { cookie: adminCookie })).text()

    expect(homeMarkup).toContain('全部 artifact')
    expect(homeMarkup).not.toContain('增长组的 artifact')
    expect(agentsMarkup).not.toContain('在 增长组 里')
  })
})

describe('public links setting', () => {
  it('shows a member the setting as text, and gives an admin the count of links a switch-off ends', async () => {
    const memberCookie = await app.signIn('reader@example.com')
    await app.publish({ cookie: memberCookie }, 'Open roadmap', '<h1>x</h1>', 'public_link')

    const memberMarkup = await (await app.request('/settings/workspace', { cookie: memberCookie })).text()
    const adminMarkup = await (await app.request('/settings/workspace', { cookie: adminCookie })).text()

    expect(memberMarkup).toContain('已允许 · 只有管理员可以修改')
    expect(memberMarkup).not.toContain('id="public-links-enabled"')
    expect(adminMarkup).toMatch(/data-public-link-count="[1-9]\d*"/)
  })
})
