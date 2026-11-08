import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let adminCookie = ''
let authorCookie = ''

interface GrantJson {
  userId: string | null
  email: string | null
  name: string | null
  role: string
  pending: boolean
}

beforeAll(async () => {
  adminCookie = await app.signIn('admin@example.com')
  authorCookie = await app.signIn('author@example.com')
})

function sharingPath(artifactId: string): string {
  return `/api/artifacts/${artifactId}/sharing`
}

async function grantsOf(artifactId: string): Promise<GrantJson[]> {
  const { body } = await app.json<{ grants: GrantJson[] }>(sharingPath(artifactId), { cookie: authorCookie })
  return body.grants
}

function saveGrants(artifactId: string, grants: Record<string, string>[], visibility = 'specified') {
  return app.json<{ grants: GrantJson[]; code?: string }>(sharingPath(artifactId), { method: 'PUT', cookie: authorCookie, body: { visibility, grants } })
}

async function userIdOf(cookie: string): Promise<string> {
  const { body } = await app.json<{ user: { userId: string } }>('/api/me', { cookie })
  return body.user.userId
}

/** Someone with an account who works only in another workspace, signed in. */
async function outsiderSignedIn(email: string): Promise<string> {
  const cookie = await app.signIn(email)
  await env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('workspace-elsewhere', 'Elsewhere', ?)").bind(Date.now()).run()
  await env.DB.prepare("UPDATE memberships SET workspace_id = 'workspace-elsewhere' WHERE user_id = ?").bind(await userIdOf(cookie)).run()
  return cookie
}

describe('looking a person up by email', () => {
  it('answers alike for an unknown address and an account the author shares no workspace with', async () => {
    const formerCookie = await app.signIn('former@example.com')
    await app.request(`/api/workspace/members/${await userIdOf(formerCookie)}`, { method: 'DELETE', cookie: adminCookie })
    const page = await app.publish({ cookie: authorCookie }, 'Lookup page')
    const peoplePath = `${sharingPath(page.artifactId)}/people`

    const outsideAccount = await app.json<Record<string, unknown>>(`${peoplePath}?email=former@example.com`, { cookie: authorCookie })
    const noAccount = await app.json<Record<string, unknown>>(`${peoplePath}?email=never-seen@example.com`, { cookie: authorCookie })

    expect(outsideAccount).toEqual({ status: 200, body: { email: 'former@example.com', name: null } })
    expect(noAccount).toEqual({ status: 200, body: { email: 'never-seen@example.com', name: null } })
  })
})

describe('sharing with an address that has no account yet', () => {
  it('keeps a pending grant, mails the address in both languages, and lets the list change it', async () => {
    const page = await app.publish({ cookie: authorCookie }, 'Launch plan', '<h1>plan</h1>', 'private')

    const saved = await saveGrants(page.artifactId, [{ email: 'Newcomer@Example.com', role: 'viewer' }])
    const mail = app.mailer.lastTo('newcomer@example.com')
    const roleChanged = await saveGrants(page.artifactId, [{ email: 'newcomer@example.com', role: 'commenter' }])
    const mailsAfterRoleChange = app.mailer.sent.filter(sent => sent.to === 'newcomer@example.com').length

    expect(saved.status).toBe(200)
    expect(saved.body.grants).toEqual([{ userId: null, email: 'newcomer@example.com', name: null, role: 'viewer', pending: true }])
    expect(mail?.subject).toBe('author 与你分享了「Launch plan」 / author shared “Launch plan” with you')
    expect(mail?.text).toContain('newcomer@example.com')
    expect(mail?.text).toContain(page.url)
    expect(roleChanged.body.grants).toMatchObject([{ email: 'newcomer@example.com', role: 'commenter', pending: true }])
    expect(mailsAfterRoleChange).toBe(1)
    expect(await grantsOf(page.artifactId)).toMatchObject([{ email: 'newcomer@example.com', pending: true }])

    const removed = await saveGrants(page.artifactId, [])
    expect(removed.body.grants).toEqual([])
  })

  it('turns the pending grant into a real one when the address signs up', async () => {
    const page = await app.publish({ cookie: authorCookie }, 'Pricing draft', '<h1>draft</h1>', 'private')
    await saveGrants(page.artifactId, [{ email: 'late-joiner@example.com', role: 'commenter' }])

    const joinerCookie = await app.signIn('late-joiner@example.com')
    const joinerId = await userIdOf(joinerCookie)
    const read = await app.request(`/api/artifacts/${page.artifactId}`, { cookie: joinerCookie })
    const comment = await app.request(`/api/artifacts/${page.artifactId}/comments`, { method: 'POST', cookie: joinerCookie, body: { body: 'Looks right' } })

    expect([read.status, comment.status]).toEqual([200, 201])
    expect(await grantsOf(page.artifactId)).toEqual([{ userId: joinerId, email: 'late-joiner@example.com', name: 'late-joiner', role: 'commenter', pending: false }])
  })

  it('grants the address of someone the author works with to their account at once', async () => {
    const colleagueCookie = await app.signIn('colleague@example.com')
    const page = await app.publish({ cookie: authorCookie }, 'Team retro', '<h1>retro</h1>', 'private')

    const saved = await saveGrants(page.artifactId, [{ email: 'colleague@example.com', role: 'editor' }])
    const duplicate = await saveGrants(page.artifactId, [{ email: 'colleague@example.com', role: 'editor' }, { userId: await userIdOf(colleagueCookie), role: 'viewer' }])

    expect(saved.body.grants).toMatchObject([{ userId: await userIdOf(colleagueCookie), pending: false, role: 'editor' }])
    expect(duplicate.status).toBe(400)
  })

  it('saves an account the author shares no workspace with exactly as an address with no account', async () => {
    await outsiderSignedIn('outsider@example.com')
    const page = await app.publish({ cookie: authorCookie }, 'Roadmap', '<h1>roadmap</h1>', 'private')
    const sharingPut = (email: string) => app.request(sharingPath(page.artifactId), { method: 'PUT', cookie: authorCookie, body: { visibility: 'specified', grants: [{ email, role: 'viewer' }] } })
    const sharingGet = () => app.request(sharingPath(page.artifactId), { cookie: authorCookie })
    const withoutAddress = async (response: Response, email: string) => (await response.text()).replaceAll(email, '<address>')

    const registeredPut = await withoutAddress(await sharingPut('outsider@example.com'), 'outsider@example.com')
    const registeredGet = await withoutAddress(await sharingGet(), 'outsider@example.com')
    const unregisteredPut = await withoutAddress(await sharingPut('nobody-yet@example.com'), 'nobody-yet@example.com')
    const unregisteredGet = await withoutAddress(await sharingGet(), 'nobody-yet@example.com')

    expect(registeredPut).toBe(unregisteredPut)
    expect(registeredGet).toBe(unregisteredGet)
    expect(JSON.parse(registeredPut).grants).toEqual([{ userId: null, email: '<address>', name: null, role: 'viewer', pending: true }])
    expect(app.mailer.lastTo('outsider@example.com')?.subject).toBe(app.mailer.lastTo('nobody-yet@example.com')?.subject)
  })

  it('opens the page to that account once its owner signs in', async () => {
    const outsiderCookie = await outsiderSignedIn('outsider-reader@example.com')
    const page = await app.publish({ cookie: authorCookie }, 'Partner notes', '<h1>notes</h1>', 'private')
    await saveGrants(page.artifactId, [{ email: 'outsider-reader@example.com', role: 'commenter' }])

    const read = await app.request(`/api/artifacts/${page.artifactId}`, { cookie: outsiderCookie })

    expect(read.status).toBe(200)
    expect(await grantsOf(page.artifactId)).toMatchObject([{ userId: await userIdOf(outsiderCookie), role: 'commenter', pending: false }])
  })

  it('waits quietly, without mail, for an address this deployment would not let sign up', async () => {
    const page = await app.publish({ cookie: authorCookie }, 'Partner brief', '<h1>brief</h1>', 'private')

    const saved = await saveGrants(page.artifactId, [{ email: 'someone@partner.org', role: 'viewer' }])

    expect(saved.body.grants).toMatchObject([{ email: 'someone@partner.org', pending: true }])
    expect(app.mailer.lastTo('someone@partner.org')).toBeUndefined()
  })
})

describe('claiming pages kept for an address', () => {
  async function keepForAddress(artifactId: string, email: string): Promise<void> {
    await env.DB.prepare("INSERT INTO pending_grants (artifact_id, email, role, granted_by, created_at) VALUES (?, ?, 'viewer', 'someone', ?)").bind(artifactId, email, Date.now()).run()
  }

  async function setEmailVerified(email: string, verified: boolean): Promise<void> {
    await env.DB.prepare('UPDATE "user" SET "emailVerified" = ? WHERE email = ?').bind(verified ? 1 : 0, email).run()
  }

  it('opens the page to someone who already had an account on their next request', async () => {
    const holderCookie = await app.signIn('holder@example.com')
    const page = await app.publish({ cookie: authorCookie }, 'Board memo', '<h1>memo</h1>', 'specified')
    const before = await app.request(`/api/artifacts/${page.artifactId}`, { cookie: holderCookie })
    await keepForAddress(page.artifactId, 'holder@example.com')

    const after = await app.request(`/api/artifacts/${page.artifactId}`, { cookie: holderCookie })

    expect([before.status, after.status]).toEqual([404, 200])
    expect(await grantsOf(page.artifactId)).toMatchObject([{ userId: await userIdOf(holderCookie), pending: false, role: 'viewer' }])
  })

  it('waits while the signed-in address is not verified', async () => {
    const unprovenCookie = await app.signIn('unproven@example.com')
    const page = await app.publish({ cookie: authorCookie }, 'Salary bands', '<h1>bands</h1>', 'specified')
    await keepForAddress(page.artifactId, 'unproven@example.com')
    await setEmailVerified('unproven@example.com', false)

    const unverified = await app.request(`/api/artifacts/${page.artifactId}`, { cookie: unprovenCookie })
    const keptWhileUnverified = await grantsOf(page.artifactId)
    await setEmailVerified('unproven@example.com', true)
    const verified = await app.request(`/api/artifacts/${page.artifactId}`, { cookie: unprovenCookie })

    expect([unverified.status, verified.status]).toEqual([404, 200])
    expect(keptWhileUnverified).toMatchObject([{ email: 'unproven@example.com', pending: true }])
  })
})
