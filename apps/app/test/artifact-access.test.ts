import { SigningKey, UsercontentSignature } from '@open-artifact/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { APP_ORIGIN, SIGNING_KEY, TestApp, USERCONTENT_ORIGIN } from './test-app.ts'

const app = new TestApp()
let authorCookie = ''
let memberCookie = ''
let outsiderCookie = ''
let authorToken = ''

beforeAll(async () => {
  authorCookie = await app.signIn('author@example.com')
  memberCookie = await app.signIn('member@example.com')
  outsiderCookie = await app.signIn('reviewer@example.com')
  authorToken = await app.createToken(authorCookie)
})

async function setSharing(artifactId: string, sharing: Record<string, unknown>): Promise<Response> {
  return app.request(`/api/artifacts/${artifactId}/sharing`, { method: 'PUT', cookie: authorCookie, body: sharing })
}

async function listedTitles(cookie: string): Promise<string[]> {
  const { body } = await app.json<{ artifacts: { title: string }[] }>('/api/artifacts', { cookie })
  return body.artifacts.map(artifact => artifact.title)
}

describe('visibility', () => {
  it('shows a workspace artifact to members, who may comment but not publish', async () => {
    const published = await app.publish({ token: authorToken }, 'Team plan')

    const memberRead = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })
    const memberUpdate = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', cookie: memberCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: 'x' }] } })
    const memberComment = await app.request(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', cookie: memberCookie, body: { body: 'Looks good' } })

    expect([memberRead.status, memberUpdate.status, memberComment.status]).toEqual([200, 403, 201])
    expect(await listedTitles(memberCookie)).toContain('Team plan')
  })

  it('hides a private artifact from everyone but its author, even its existence', async () => {
    const published = await app.publish({ token: authorToken }, 'Private notes', '<h1>secret</h1>', 'private')

    const memberRead = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })
    const memberPage = await app.request(`/a/${published.artifactId}`, { cookie: memberCookie })

    expect(memberRead.status).toBe(404)
    expect(memberPage.status).toBe(404)
    expect(await listedTitles(memberCookie)).not.toContain('Private notes')
    expect(await listedTitles(authorCookie)).toContain('Private notes')
  })

  it('opens a specified artifact only to the people granted a role, each as far as the role goes', async () => {
    const published = await app.publish({ token: authorToken }, 'Salary review', '<h1>v1</h1>', 'specified')
    const before = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })

    const grantResponse = await app.request(`/api/artifacts/${published.artifactId}/grants`, { method: 'PUT', cookie: authorCookie, body: { email: 'MEMBER@example.com', role: 'editor' } })
    const editorUpdate = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', cookie: memberCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const editorSharing = await app.request(`/api/artifacts/${published.artifactId}/sharing`, { cookie: memberCookie })
    const outsiderRead = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: outsiderCookie })

    await app.request(`/api/artifacts/${published.artifactId}/grants`, { method: 'PUT', cookie: authorCookie, body: { email: 'member@example.com', role: 'viewer' } })
    const viewerComment = await app.request(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', cookie: memberCookie, body: { body: 'hi' } })
    const members = await app.json<{ artifacts: { title: string }[] }>('/api/artifacts', { cookie: memberCookie })

    expect(before.status).toBe(404)
    expect(grantResponse.status).toBe(200)
    expect(editorUpdate.status).toBe(200)
    expect(editorSharing.status).toBe(403)
    expect(outsiderRead.status).toBe(404)
    expect(viewerComment.status).toBe(403)
    expect(members.body.artifacts.map(artifact => artifact.title)).toContain('Salary review')
  })

  it('cannot add a person who has never signed in', async () => {
    const published = await app.publish({ token: authorToken }, 'Invite test')

    const grantResponse = await app.json<{ error: string }>(`/api/artifacts/${published.artifactId}/grants`, { method: 'PUT', cookie: authorCookie, body: { email: 'nobody@example.com', role: 'viewer' } })

    expect(grantResponse.status).toBe(404)
    expect(grantResponse.body.error).toContain('sign in once')
  })
})

describe('public links', () => {
  it('lets anyone with the link open the page, read-only unless the author allows writes', async () => {
    const published = await app.publish({ token: authorToken }, 'Workshop sign-up')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: null })

    const anonymousPage = await app.request(`/a/${published.artifactId}`)
    const anonymousRead = await app.request(`/api/artifacts/${published.artifactId}`)
    const anonymousWrite = await app.request(`/api/artifacts/${published.artifactId}/data/signups/guest-1`, { method: 'PUT', body: { data: { name: 'Guest' } } })
    await setSharing(published.artifactId, { visibility: 'public_link', anonymousWriteEnabled: true })
    const allowedWrite = await app.json<{ document: { createdBy: unknown } }>(`/api/artifacts/${published.artifactId}/data/signups/guest-1`, { method: 'PUT', body: { data: { name: 'Guest' } } })
    const anonymousComment = await app.request(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', body: { body: 'hello' } })

    expect(anonymousPage.status).toBe(200)
    expect(anonymousRead.status).toBe(200)
    expect(anonymousWrite.status).toBe(401)
    expect(allowedWrite.status).toBe(200)
    expect(allowedWrite.body.document.createdBy).toBeNull()
    expect(anonymousComment.status).toBe(401)
  })

  it('asks for the password, sets an unlock cookie for the right one, and forgets it when the password changes', async () => {
    const published = await app.publish({ token: authorToken }, 'Board deck')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkPassword: 'board-2026' })

    const locked = await app.request(`/a/${published.artifactId}`)
    const wrongPassword = await app.request(`/a/${published.artifactId}/unlock`, { method: 'POST', form: { password: 'guess' } })
    const rightPassword = await app.request(`/a/${published.artifactId}/unlock`, { method: 'POST', form: { password: 'board-2026' } })
    const unlockCookie = (rightPassword.headers.get('Set-Cookie') ?? '').split(';')[0] ?? ''
    const unlocked = await app.request(`/a/${published.artifactId}`, { cookie: unlockCookie })
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkPassword: 'board-2027' })
    const afterPasswordChange = await app.request(`/a/${published.artifactId}`, { cookie: unlockCookie })

    expect(await locked.text()).toContain('这个链接需要密码')
    expect(wrongPassword.status).toBe(401)
    expect(rightPassword.status).toBe(303)
    expect(unlocked.status).toBe(200)
    expect(await unlocked.text()).toContain('artifact-frame')
    expect(await afterPasswordChange.text()).toContain('这个链接需要密码')
  })

  it('closes every public link when the admin switches them off, and refuses new ones', async () => {
    const published = await app.publish({ token: authorToken }, 'Press release')
    await setSharing(published.artifactId, { visibility: 'public_link' })

    const memberToggle = await app.request('/api/workspace', { method: 'PATCH', cookie: memberCookie, body: { publicLinksEnabled: false } })
    const adminToggle = await app.request('/api/workspace', { method: 'PATCH', cookie: authorCookie, body: { publicLinksEnabled: false } })
    const anonymousAfter = await app.request(`/a/${published.artifactId}`)
    const newPublicLink = await setSharing(published.artifactId, { visibility: 'public_link' })
    await app.request('/api/workspace', { method: 'PATCH', cookie: authorCookie, body: { publicLinksEnabled: true } })

    expect(memberToggle.status).toBe(403)
    expect(adminToggle.status).toBe(200)
    expect(anonymousAfter.status).toBe(302)
    expect(newPublicLink.status).toBe(400)
  })

  it('lets the author change sharing after the link has expired', async () => {
    const published = await app.publish({ token: authorToken }, 'Expired campaign')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: Date.now() + 60_000 })
    const summary = await app.repositories.artifacts.findSummary(published.artifactId)
    await app.repositories.artifactAccess.updateSharing(published.artifactId, { ...(summary?.sharing ?? { visibility: 'public_link', publicLinkPasswordHash: null, anonymousWriteEnabled: false }), publicLinkExpiresAt: Date.now() - 1 })

    const backToPrivate = await setSharing(published.artifactId, { visibility: 'private' })
    const sharing = await app.json<{ visibility: string; publicLink: { expiresAt: number } }>(`/api/artifacts/${published.artifactId}/sharing`, { cookie: authorCookie })

    expect(backToPrivate.status).toBe(200)
    expect(sharing.body.visibility).toBe('private')
  })

  it('limits password guesses for a public link', async () => {
    const published = await app.publish({ token: authorToken }, 'Guarded deck')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkPassword: 'right-one' })

    const attempts = []
    for (let attempt = 0; attempt < 6; attempt++) attempts.push((await app.request(`/a/${published.artifactId}/unlock`, { method: 'POST', form: { password: `guess-${attempt}` } })).status)

    expect(attempts.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(attempts[5]).toBe(429)
  })

  it('stops an expired link', async () => {
    const published = await app.publish({ token: authorToken }, 'Old offer')

    const pastExpiry = await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: Date.now() - 1000 })

    expect(pastExpiry.status).toBe(400)
  })
})

describe('the viewer page', () => {
  it('frames the artifact through a signed usercontent URL without same-origin access', async () => {
    const published = await app.publish({ token: authorToken }, 'Signed frame')

    const viewerMarkup = await (await app.request(`/a/${published.artifactId}`, { cookie: memberCookie })).text()
    const frameSource = viewerMarkup.match(/<iframe id="artifact-frame" src="([^"]+)"/)?.[1] ?? ''
    const verifiedRequest = await new UsercontentSignature(new SigningKey(SIGNING_KEY)).verifiedRequest(new URL(frameSource).pathname, Date.now())

    expect(frameSource.startsWith(`${USERCONTENT_ORIGIN}/s/`)).toBe(true)
    expect(verifiedRequest).toEqual({ artifactId: published.artifactId, version: 1, filePath: 'index.html' })
    expect(viewerMarkup).toMatch(/sandbox="allow-scripts[^"]*"/)
    expect(viewerMarkup).not.toContain('allow-same-origin')
  })

  it('offers sharing only to the author', async () => {
    const published = await app.publish({ token: authorToken }, 'Share button')

    const authorMarkup = await (await app.request(`/a/${published.artifactId}`, { cookie: authorCookie })).text()
    const memberMarkup = await (await app.request(`/a/${published.artifactId}`, { cookie: memberCookie })).text()

    expect(authorMarkup).toContain('data-open-share')
    expect(memberMarkup).not.toContain('data-open-share')
  })

  it('sends a signed-out visitor of a workspace artifact to the login page and back', async () => {
    const published = await app.publish({ token: authorToken }, 'Login first')

    const signedOut = await app.request(`/a/${published.artifactId}`)

    expect(signedOut.status).toBe(302)
    expect(signedOut.headers.get('Location')).toBe(`${APP_ORIGIN}/login?next=${encodeURIComponent(`/a/${published.artifactId}`)}`)
  })
})
