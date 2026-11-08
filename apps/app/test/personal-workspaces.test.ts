import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { purgePastRestoring } from '../src/purge.ts'
import { TestApp } from './test-app.ts'

const app = new TestApp()
const DAY = 24 * 60 * 60 * 1000
let adminCookie = ''

interface WorkspaceJson {
  workspaceId: string
  name: string
  role: string
  personalOf: string | null
}

interface MeJson {
  user: { userId: string }
  workspace: WorkspaceJson
  workspaces: WorkspaceJson[]
}

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
})

async function me(cookie: string): Promise<MeJson> {
  const { status, body } = await app.json<MeJson>('/api/me', { cookie })
  if (status !== 200) throw new Error(`/api/me answered ${status}`)
  return body
}

/** The cookies a browser holds after `response`: what it set replaces what `cookie` held under the same name. */
function withCookiesOf(response: Response, cookie: string): string {
  const jar = new Map(cookie.split('; ').filter(Boolean).map(pair => [pair.split('=')[0], pair]))
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(';')[0] ?? ''
    jar.set(pair.split('=')[0], pair)
  }
  return [...jar.values()].join('; ')
}

async function createWorkspace(cookie: string, name: string): Promise<{ cookie: string; workspace: WorkspaceJson }> {
  const response = await app.request('/api/workspaces', { method: 'POST', cookie, body: { name } })
  if (response.status !== 201) throw new Error(`creating a workspace answered ${response.status}`)
  const { workspace } = (await response.clone().json()) as { workspace: WorkspaceJson }
  return { cookie: withCookiesOf(response, cookie), workspace }
}

/** Makes a never-expiring link to the inviter's current workspace; `email` signs in through it and follows it back. */
async function joinByLink(inviterCookie: string, email: string): Promise<string> {
  const { body } = await app.json<{ invite: { url: string } }>('/api/workspace/invites/link', { method: 'POST', cookie: inviterCookie, body: { expiresInDays: null } })
  const invitePath = new URL(body.invite.url).pathname
  const opened = await app.request(invitePath)
  const browserCookie = withCookiesOf(opened, '')
  const sessionCookie = await app.signInAlone(email, browserCookie)
  const followed = await app.request(invitePath, { cookie: sessionCookie })
  return withCookiesOf(followed, sessionCookie)
}

describe('a personal workspace', () => {
  it('is created once, however many first requests arrive at the same time', async () => {
    const cookie = await app.signInAlone('parallel@example.com')
    const { user } = await me(cookie)
    await env.DB.prepare('DELETE FROM workspaces WHERE personal_of = ?').bind(user.userId).run()

    const answers = await Promise.all(Array.from({ length: 8 }, () => me(cookie)))
    const personalCount = await env.DB.prepare('SELECT COUNT(*) AS personal FROM workspaces WHERE personal_of = ?').bind(user.userId).first<number>('personal')

    expect(new Set(answers.map(answer => answer.workspace.workspaceId)).size).toBe(1)
    expect(answers[0]?.workspace).toMatchObject({ name: 'parallel的工作区', role: 'admin', personalOf: user.userId })
    expect(personalCount).toBe(1)
  })

  it('comes to a person who signed up before it existed, who keeps the workspace they were in and lands there', async () => {
    const cookie = await app.signIn('veteran@example.com')
    const { user } = await me(cookie)
    await env.DB.prepare('DELETE FROM workspaces WHERE personal_of = ?').bind(user.userId).run()
    const sessionOnly = cookie.replace(/; oa_workspace=[^;]*/, '')

    const after = await me(sessionOnly)

    expect(after.workspace.workspaceId).toBe(app.teamWorkspaceId)
    expect(after.workspaces.map(workspace => [workspace.personalOf === user.userId, workspace.workspaceId === app.teamWorkspaceId])).toEqual([
      [true, false],
      [false, true],
    ])
  })

  it('lands a person in several workspaces, with none chosen in this browser, in the earliest they joined', async () => {
    const teamCookie = await app.signIn('two-teams@example.com')
    await createWorkspace(teamCookie, 'Second team')
    const sessionOnly = teamCookie.replace(/; oa_workspace=[^;]*/g, '')

    const after = await me(sessionOnly)

    expect(after.workspace.workspaceId).toBe(app.teamWorkspaceId)
  })

  it('is joined by the invite’s workspace for a newcomer, who lands in the invited one', async () => {
    const guestCookie = await joinByLink(adminCookie, 'newcomer@partner.org')
    const sessionOnly = guestCookie.replace(/; oa_workspace=[^;]*/g, '')

    const { user, workspace, workspaces } = await me(sessionOnly)

    expect(workspace.workspaceId).toBe(app.teamWorkspaceId)
    expect(workspaces.map(candidate => (candidate.personalOf === user.userId ? 'personal' : candidate.workspaceId))).toEqual(['personal', app.teamWorkspaceId])
  })

  it('cannot be left or deleted, and its owner cannot be removed from it or demoted', async () => {
    const ownerCookie = await app.signInAlone('owner@example.com')
    const owner = await me(ownerCookie)
    const guestCookie = await joinByLink(ownerCookie, 'guest-of-owner@example.com')
    const guest = await me(guestCookie)
    await app.request(`/api/workspace/members/${guest.user.userId}`, { method: 'PATCH', cookie: ownerCookie, body: { role: 'admin' } })

    const leaving = await app.json<{ code: string }>('/api/workspace/leave', { method: 'POST', cookie: ownerCookie })
    const deleting = await app.json<{ code: string }>('/api/workspace', { method: 'DELETE', cookie: ownerCookie })
    const removing = await app.json<{ code: string }>(`/api/workspace/members/${owner.user.userId}`, { method: 'DELETE', cookie: guestCookie })
    const demoting = await app.json<{ code: string }>(`/api/workspace/members/${owner.user.userId}`, { method: 'PATCH', cookie: guestCookie, body: { role: 'member' } })

    for (const refusal of [leaving, deleting, removing, demoting]) expect(refusal).toMatchObject({ status: 400, body: { code: 'personal_workspace' } })
    expect((await me(ownerCookie)).workspace).toMatchObject({ personalOf: owner.user.userId, role: 'admin' })
  })
})

describe('creating a workspace', () => {
  it('makes its creator the admin and switches them to it', async () => {
    const creatorCookie = await app.signIn('creator@example.com')

    const created = await createWorkspace(creatorCookie, '  Launch crew ')
    const after = await me(created.cookie)
    const tooLong = await app.json<{ code: string }>('/api/workspaces', { method: 'POST', cookie: creatorCookie, body: { name: 'x'.repeat(41) } })
    const byToken = await app.request('/api/workspaces', { method: 'POST', token: await app.createToken(creatorCookie), body: { name: 'Agents' } })

    expect(created.workspace).toMatchObject({ name: 'Launch crew', role: 'admin', personalOf: null })
    expect(after.workspace.workspaceId).toBe(created.workspace.workspaceId)
    expect(after.workspaces).toHaveLength(3)
    expect(tooLong).toMatchObject({ status: 400, body: { code: 'field_too_long' } })
    expect(byToken.status).toBe(403)
  })
})

describe('leaving a workspace', () => {
  it('ends a member’s access and tokens, lands them in their personal workspace, and any invite brings them back', async () => {
    const memberCookie = await app.signIn('leaving-member@example.com')
    const { user } = await me(memberCookie)
    const token = await app.createToken(memberCookie)
    const teamPage = await app.publish({ cookie: adminCookie }, 'Team-only notes', '<h1>notes</h1>', 'workspace')

    const left = await app.request('/api/workspace/leave', { method: 'POST', cookie: memberCookie })
    const after = await me(withCookiesOf(left, memberCookie))
    const tokenAfter = await app.request('/api/artifacts', { token })
    const teamPageAfter = await app.request(`/api/artifacts/${teamPage.artifactId}`, { cookie: withCookiesOf(left, memberCookie) })
    const { body: audit } = await app.json<{ events: { action: string }[] }>('/api/workspace/audit', { cookie: adminCookie })
    const backCookie = await joinByLink(adminCookie, 'leaving-member@example.com')

    expect(left.status).toBe(200)
    expect(after.workspace.personalOf).toBe(user.userId)
    expect(after.workspaces.map(workspace => workspace.workspaceId)).not.toContain(app.teamWorkspaceId)
    expect(tokenAfter.status).toBe(401)
    expect(teamPageAfter.status).toBe(404)
    expect(audit.events[0]?.action).toBe('member.left')
    expect((await me(backCookie)).workspace).toMatchObject({ workspaceId: app.teamWorkspaceId, role: 'member' })
  })

  it('refuses the last admin, who has to hand over or delete the workspace instead', async () => {
    const soloCookie = (await createWorkspace(await app.signInAlone('solo@example.com'), 'Solo')).cookie

    const leaving = await app.json<{ code: string; error: string }>('/api/workspace/leave', { method: 'POST', cookie: soloCookie })

    expect(leaving).toMatchObject({ status: 400, body: { code: 'last_admin' } })
    expect(leaving.body.error).toContain('delete the workspace')
  })
})

describe('deleting a workspace', () => {
  let ownerCookie = ''
  let memberCookie = ''
  let workspaceId = ''
  let artifactPath = ''
  let artifactId = ''
  let memberToken = ''

  beforeAll(async () => {
    const created = await createWorkspace(await app.signInAlone('deleter@example.com'), 'Doomed')
    ownerCookie = created.cookie
    workspaceId = created.workspace.workspaceId
    memberCookie = await joinByLink(ownerCookie, 'doomed-member@example.com')
    memberToken = await app.createToken(memberCookie)
    const published = await app.publish({ cookie: ownerCookie }, 'Doomed plan', '<h1>plan</h1>', 'workspace')
    artifactPath = published.path
    artifactId = published.artifactId
  })

  it('is refused to a member who is not an admin', async () => {
    const byMember = await app.json<{ code: string }>('/api/workspace', { method: 'DELETE', cookie: memberCookie })

    expect(byMember).toMatchObject({ status: 403, body: { code: 'admin_required' } })
  })

  it('takes the workspace, its pages and its tokens from every member at once', async () => {
    const deleted = await app.json<{ purgeAt: number }>('/api/workspace', { method: 'DELETE', cookie: ownerCookie })

    const memberAfter = await me(memberCookie)
    const pageAfter = await app.request(artifactPath, { cookie: memberCookie })
    const apiAfter = await app.request(`/api/artifacts/${artifactId}`, { cookie: memberCookie })
    const tokenAfter = await app.json<{ code: string; error: string }>('/api/artifacts', { token: memberToken })
    const { body: restorableForMember } = await app.json<{ workspaces: unknown[] }>('/api/workspaces/deleted', { cookie: memberCookie })
    const restoreByMember = await app.request(`/api/workspaces/${workspaceId}/restore`, { method: 'POST', cookie: memberCookie })

    expect(deleted.status).toBe(200)
    expect(Math.round((deleted.body.purgeAt - Date.now()) / DAY)).toBe(30)
    expect(memberAfter.workspaces.map(workspace => workspace.workspaceId)).not.toContain(workspaceId)
    expect(pageAfter.status).toBe(404)
    expect(apiAfter.status).toBe(404)
    expect(tokenAfter).toMatchObject({ status: 401, body: { code: 'workspace_deleted' } })
    expect(tokenAfter.body.error).toContain('was deleted')
    expect(restorableForMember.workspaces).toEqual([])
    expect(restoreByMember.status).toBe(404)
  })

  it('can be restored by its admin within 30 days, pages and tokens included', async () => {
    const { body: restorable } = await app.json<{ workspaces: { workspaceId: string; name: string }[] }>('/api/workspaces/deleted', { cookie: ownerCookie })

    const restored = await app.request(`/api/workspaces/${workspaceId}/restore`, { method: 'POST', cookie: ownerCookie })
    const memberPage = await app.request(artifactPath, { cookie: memberCookie })
    const tokenAfter = await app.request('/api/artifacts', { token: memberToken })

    expect(restorable.workspaces).toEqual([expect.objectContaining({ workspaceId, name: 'Doomed' })])
    expect(restored.status).toBe(200)
    expect(memberPage.status).toBe(200)
    expect(tokenAfter.status).toBe(200)
  })

  it('is purged with its pages and their files 30 days after it was deleted', async () => {
    const empty = await createWorkspace(ownerCookie, 'Empty and doomed')
    await app.request('/api/workspace', { method: 'DELETE', cookie: empty.cookie })
    await app.request('/api/workspace', { method: 'DELETE', cookie: ownerCookie })
    const workspacesLeft = () => env.DB.prepare('SELECT COUNT(*) AS kept FROM workspaces WHERE id IN (?, ?)').bind(workspaceId, empty.workspace.workspaceId).first<number>('kept')
    await purgePastRestoring(app.repositories, Date.now() + 29 * DAY)
    const keptWhileRestorable = await workspacesLeft()

    await purgePastRestoring(app.repositories, Date.now() + 31 * DAY)

    expect(keptWhileRestorable).toBe(2)
    expect(await workspacesLeft()).toBe(0)
    expect(await env.DB.prepare('SELECT COUNT(*) AS left_over FROM artifacts WHERE id = ?').bind(artifactId).first<number>('left_over')).toBe(0)
    expect((await env.FILES.list({ prefix: `artifacts/${artifactId}/` })).objects).toEqual([])
  })
})

describe('an invite link', () => {
  it('offers 7 days, 30 days or never, and a link that never expires keeps working', async () => {
    const lifetimes = await Promise.all(
      [7, 30, null].map(async expiresInDays => {
        const { body } = await app.json<{ invite: { expiresAt: number | null } }>('/api/workspace/invites/link', { method: 'POST', cookie: adminCookie, body: { expiresInDays } })
        return body.invite.expiresAt === null ? null : Math.round((body.invite.expiresAt - Date.now()) / DAY)
      }),
    )
    const unoffered = await app.json<{ code: string }>('/api/workspace/invites/link', { method: 'POST', cookie: adminCookie, body: { expiresInDays: 365 } })
    const { body: lasting } = await app.json<{ invite: { url: string } }>('/api/workspace/invites/link', { method: 'POST', cookie: adminCookie, body: { expiresInDays: null } })

    expect(lifetimes).toEqual([7, 30, null])
    expect(unoffered).toMatchObject({ status: 400, body: { code: 'field_invalid' } })
    expect(await app.repositories.invites.findPendingByCode(new URL(lasting.invite.url).pathname.split('/').pop() ?? '', Date.now() + 3650 * DAY)).not.toBeNull()
  })
})

describe('the pages', () => {
  it('show every workspace in the top bar menu, the current one checked and the personal one marked, with a way to create one', async () => {
    const cookie = await app.signIn('menu@example.com')

    const home = await (await app.request('/', { cookie })).text()
    const items = [...home.matchAll(/role="menuitemradio" aria-checked="(true|false)" data-switch-workspace="([^"]+)"[^>]*>.*?<span class="app-workspace-menu__name">([^<]+)<\/span>(<span class="xxd-badge"[^>]*>个人<\/span>)?/g)]

    expect(items.map(([, checked, , name, personalBadge]) => [name, checked, personalBadge !== undefined])).toEqual([
      ['menu的工作区', 'false', true],
      ['我的团队', 'true', false],
    ])
    expect(home).toContain('data-xxd-dialog-open="new-workspace-dialog">')
    expect(home).toContain('新建工作区')
    expect(home).not.toContain('deleted-workspaces-dialog')
  })

  it('offers an admin the workspaces they deleted, with the days left to restore them', async () => {
    const created = await createWorkspace(await app.signInAlone('restorer@example.com'), 'Archive me')
    await app.request('/api/workspace', { method: 'DELETE', cookie: created.cookie })

    const home = await (await app.request('/', { cookie: created.cookie })).text()

    expect(home).toContain('data-xxd-dialog-open="deleted-workspaces-dialog"')
    expect(home).toMatch(/Archive me<\/span><span class="xxd-list__meta">30 天后彻底删除<\/span>/)
    expect(home).toContain(`data-restore-workspace="${created.workspace.workspaceId}"`)
  })

  it('list under 分享给我的 what was shared with the person in any workspace, naming the workspace it comes from', async () => {
    const authorCookie = (await createWorkspace(await app.signInAlone('far-author@example.com'), 'Far team')).cookie
    const readerCookie = await app.signIn('near-reader@example.com')
    const farPage = await app.publish({ cookie: authorCookie }, 'Far away plan', '<h1>far</h1>', 'specified')
    await app.grant(authorCookie, farPage.artifactId, 'near-reader@example.com', 'viewer')
    const nearPage = await app.publish({ cookie: adminCookie }, 'Close by plan', '<h1>near</h1>', 'specified')
    await app.grant(adminCookie, nearPage.artifactId, 'near-reader@example.com', 'viewer')

    const shared = await (await app.request('/?filter=shared', { cookie: readerCookie })).text()
    const all = await (await app.request('/', { cookie: readerCookie })).text()

    expect(shared).toContain('Far away plan')
    expect(shared).toContain('Close by plan')
    expect(shared).toMatch(/title="来自工作区「Far team」">.*Far team<\/span>/)
    expect(shared).not.toMatch(/title="来自工作区「我的团队」"/)
    expect(all).not.toContain('Far away plan')
  })

  it('give an admin of an empty workspace a way to invite members beside connecting an agent', async () => {
    const created = await createWorkspace(await app.signInAlone('empty-admin@example.com'), 'Empty room')

    const home = await (await app.request('/', { cookie: created.cookie })).text()

    expect(home).toMatch(/<div class="xxd-empty__actions xxd-cluster"><a class="xxd-btn" data-variant="primary" href="\/settings\/agents">连接 agent<\/a><a class="xxd-btn"  href="\/settings\/members">邀请成员<\/a><\/div>/)
  })

  it('end the workspace settings with leave and delete, and say why a personal workspace has neither', async () => {
    const memberCookie = await app.signIn('settings-member@example.com')
    const personalCookie = await app.signInAlone('settings-personal@example.com')

    const asAdmin = await (await app.request('/settings/workspace', { cookie: adminCookie })).text()
    const asMember = await (await app.request('/settings/workspace', { cookie: memberCookie })).text()
    const asOwner = await (await app.request('/settings/workspace', { cookie: personalCookie })).text()
    const members = await (await app.request('/settings/members', { cookie: adminCookie })).text()

    expect(asAdmin).toContain('data-leave-workspace')
    expect(asAdmin).toContain('data-delete-workspace')
    expect(asMember).toContain('data-leave-workspace')
    expect(asMember).not.toContain('data-delete-workspace')
    expect(asOwner).toContain('这是你的个人工作区，不能离开或删除')
    expect(asOwner).not.toContain('data-leave-workspace')
    expect(members).toMatch(/<select id="invite-link-expiry">\s*<option value="7">7 天<\/option><option value="30">30 天<\/option><option value="never">永不过期<\/option>/)
  })
})
