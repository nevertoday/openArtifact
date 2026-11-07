import { SigningKey, UsercontentSignature } from '@open-artifact/core'
import { env } from 'cloudflare:workers'
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

  it('hides a private artifact from everyone but its author, and tells a member only that they have no access', async () => {
    const published = await app.publish({ token: authorToken }, 'Private notes', '<h1>secret</h1>', 'private')

    const memberRead = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })
    const memberPage = await app.request(`/a/${published.artifactId}`, { cookie: memberCookie })

    expect(memberRead.status).toBe(404)
    expect(memberPage.status).toBe(403)
    expect(await memberPage.text()).not.toContain('Private notes')
    expect(await listedTitles(memberCookie)).not.toContain('Private notes')
    expect(await listedTitles(authorCookie)).toContain('Private notes')
  })

  it('opens a specified artifact only to the people granted a role, each as far as the role goes', async () => {
    const published = await app.publish({ token: authorToken }, 'Salary review', '<h1>v1</h1>', 'specified')
    const before = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })

    const grantResponse = await app.grant(authorCookie, published.artifactId, 'MEMBER@example.com', 'editor')
    const editorUpdate = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', cookie: memberCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const editorSharing = await app.request(`/api/artifacts/${published.artifactId}/sharing`, { cookie: memberCookie })
    const outsiderRead = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: outsiderCookie })

    await app.grant(authorCookie, published.artifactId, 'member@example.com', 'viewer')
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

  it('finds a person to share with by email, and explains who cannot be added', async () => {
    const published = await app.publish({ token: authorToken }, 'Invite test')
    const peoplePath = `/api/artifacts/${published.artifactId}/sharing/people`

    const found = await app.json<{ userId: string; name: string; email: string }>(`${peoplePath}?email=Member@example.com`, { cookie: authorCookie })
    const neverSignedIn = await app.json<{ error: string }>(`${peoplePath}?email=nobody@example.com`, { cookie: authorCookie })
    const theAuthor = await app.json<{ error: string }>(`${peoplePath}?email=author@example.com`, { cookie: authorCookie })
    const askedByMember = await app.request(`${peoplePath}?email=author@example.com`, { cookie: memberCookie })

    expect(found.status).toBe(200)
    expect(found.body).toMatchObject({ name: 'member', email: 'member@example.com' })
    expect(neverSignedIn.status).toBe(404)
    expect(neverSignedIn.body.error).toContain('sign in once')
    expect(theAuthor.status).toBe(400)
    expect(askedByMember.status).toBe(403)
  })
})

describe('saving sharing in one request', () => {
  async function sharingOf(artifactId: string) {
    return (await app.json<{ visibility: string; peopleApplyUnder: string[]; grants: { userId: string; role: string }[]; publicLink: { expiresAt: number | null; hasPassword: boolean } }>(`/api/artifacts/${artifactId}/sharing`, { cookie: authorCookie })).body
  }

  async function memberUserId(artifactId: string): Promise<string> {
    const { body } = await app.json<{ userId: string }>(`/api/artifacts/${artifactId}/sharing/people?email=member@example.com`, { cookie: authorCookie })
    return body.userId
  }

  it('applies the visibility, the people and the public link settings together', async () => {
    const published = await app.publish({ token: authorToken }, 'Hiring plan', '<h1>v1</h1>', 'private')
    const memberId = await memberUserId(published.artifactId)

    const saved = await app.json<{ visibility: string; grants: { userId: string; role: string }[] }>(`/api/artifacts/${published.artifactId}/sharing`, {
      method: 'PUT',
      cookie: authorCookie,
      body: { visibility: 'specified', grants: [{ userId: memberId, role: 'editor' }] },
    })
    const memberUpdate = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', cookie: memberCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    await setSharing(published.artifactId, { grants: [] })
    const memberAfterRemoval = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })

    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ visibility: 'specified', grants: [{ userId: memberId, role: 'editor' }] })
    expect(memberUpdate.status).toBe(200)
    expect(memberAfterRemoval.status).toBe(404)
  })

  it('changes nothing when any part of the save is wrong', async () => {
    const published = await app.publish({ token: authorToken }, 'Atomic save', '<h1>v1</h1>', 'private')
    const memberId = await memberUserId(published.artifactId)

    const unknownPerson = await setSharing(published.artifactId, { visibility: 'specified', grants: [{ userId: memberId, role: 'viewer' }, { userId: 'user-nobody', role: 'viewer' }] })
    const unknownRole = await setSharing(published.artifactId, { visibility: 'specified', grants: [{ userId: memberId, role: 'owner' }] })
    const twice = await setSharing(published.artifactId, { visibility: 'specified', grants: [{ userId: memberId, role: 'viewer' }, { userId: memberId, role: 'editor' }] })

    expect([unknownPerson.status, unknownRole.status, twice.status]).toEqual([400, 400, 400])
    expect(await sharingOf(published.artifactId)).toMatchObject({ visibility: 'private', grants: [] })
  })

  it('lets granted people in at every level except private', async () => {
    const published = await app.publish({ token: authorToken }, 'Board memo', '<h1>v1</h1>', 'specified')
    await app.grant(authorCookie, published.artifactId, 'member@example.com', 'editor')
    const editAsSpecified = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', cookie: memberCookie, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    await setSharing(published.artifactId, { visibility: 'workspace' })
    const editAsWorkspace = await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', cookie: memberCookie, body: { baseVersion: 2, files: [{ path: 'index.html', content: '<h1>v3</h1>' }] } })
    const peopleLevels = (await sharingOf(published.artifactId)).peopleApplyUnder
    await setSharing(published.artifactId, { visibility: 'private' })
    const readAsPrivate = await app.request(`/api/artifacts/${published.artifactId}`, { cookie: memberCookie })

    expect(editAsSpecified.status).toBe(200)
    expect(editAsWorkspace.status).toBe(200)
    expect(readAsPrivate.status).toBe(404)
    expect((await sharingOf(published.artifactId)).grants).toHaveLength(1)
    expect(peopleLevels).toEqual(['specified', 'workspace', 'public_link'])
  })

  it('tells each person once when an artifact is shared with them', async () => {
    const published = await app.publish({ token: authorToken }, 'Quarterly numbers', '<h1>v1</h1>', 'specified')
    const mailBefore = app.mailer.sent.length

    await app.grant(authorCookie, published.artifactId, 'member@example.com', 'viewer')
    await app.grant(authorCookie, published.artifactId, 'member@example.com', 'commenter')
    await setSharing(published.artifactId, { publicLinkExpiresAt: null })
    const shareMail = app.mailer.sent.slice(mailBefore)

    expect(shareMail).toHaveLength(1)
    expect(shareMail[0]).toMatchObject({ to: 'member@example.com', subject: 'author 把「Quarterly numbers」分享给了你' })
    expect(shareMail[0]?.text).toContain(`${APP_ORIGIN}/a/${published.artifactId}`)
    expect(shareMail[0]?.text).toContain('可查看')
    const memberNotifications = await app.json<{ notifications: { kind: string; text: string; artifactId: string }[] }>('/api/notifications', { cookie: memberCookie })
    const sharedNotifications = memberNotifications.body.notifications.filter(notification => notification.artifactId === published.artifactId)
    expect(sharedNotifications.map(notification => [notification.kind, notification.text])).toEqual([['shared_with_me', 'author 把「Quarterly numbers」分享给了你']])
  })

  it('does not tell people about grants that do nothing yet', async () => {
    const published = await app.publish({ token: authorToken }, 'Draft budget', '<h1>v1</h1>', 'private')
    const memberId = await memberUserId(published.artifactId)
    const mailBefore = app.mailer.sent.length

    await setSharing(published.artifactId, { grants: [{ userId: memberId, role: 'viewer' }] })
    const mailWhilePrivate = app.mailer.sent.length - mailBefore
    await setSharing(published.artifactId, { visibility: 'specified' })

    expect(mailWhilePrivate).toBe(0)
    expect(app.mailer.lastTo('member@example.com')?.subject).toBe('author 把「Draft budget」分享给了你')
  })

  it('saves the sharing even when the mail cannot be sent', async () => {
    const mailOutageApp = new TestApp()
    const outageAuthorCookie = await mailOutageApp.signIn('author@example.com')
    await mailOutageApp.signIn('member@example.com')
    const published = await mailOutageApp.publish({ cookie: outageAuthorCookie }, 'Mail down', '<h1>v1</h1>', 'specified')
    mailOutageApp.mailer.goOutOfService()

    const grantResponse = await mailOutageApp.grant(outageAuthorCookie, published.artifactId, 'member@example.com', 'viewer')

    expect(grantResponse.status).toBe(200)
  })

  it('no longer changes grants one at a time', async () => {
    const published = await app.publish({ token: authorToken }, 'Old endpoint')

    const oldGrant = await app.request(`/api/artifacts/${published.artifactId}/grants`, { method: 'PUT', cookie: authorCookie, body: { email: 'member@example.com', role: 'viewer' } })

    expect(oldGrant.status).toBe(404)
  })
})

describe('a public link opened by an agent', () => {
  const DAY = 24 * 60 * 60 * 1000

  async function expiryOf(artifactId: string): Promise<number | null> {
    return (await app.repositories.artifacts.findSummary(artifactId))?.sharing.publicLinkExpiresAt ?? null
  }

  it('expires in 7 days when the agent publishes straight to a public link, and tells the author', async () => {
    const publishedAt = Date.now()
    const published = await app.json<{ artifactId: string; publicLinkExpiresAt: number }>('/api/artifacts', {
      method: 'POST',
      token: authorToken,
      agentClient: 'Claude Code',
      body: { title: 'Launch teaser', visibility: 'public_link', files: [{ path: 'index.html', content: '<h1>soon</h1>' }] },
    })

    const expiresAt = await expiryOf(published.body.artifactId)
    expect(published.status).toBe(201)
    expect(expiresAt).toBeGreaterThanOrEqual(publishedAt + 7 * DAY)
    expect(expiresAt).toBeLessThan(publishedAt + 7 * DAY + 60_000)
    expect(published.body.publicLinkExpiresAt).toBe(expiresAt)
    expect(app.mailer.lastTo('author@example.com')?.subject).toBe('Claude Code（代 author）把「Launch teaser」设为公开链接，7 天后过期')
    expect(app.mailer.lastTo('author@example.com')?.text).toContain(`${APP_ORIGIN}/a/${published.body.artifactId}`)
  })

  it('keeps the expiry the agent asks for', async () => {
    const mailBefore = app.mailer.sent.length
    const published = await app.json<{ artifactId: string }>('/api/artifacts', {
      method: 'POST',
      token: authorToken,
      body: { title: 'Evergreen docs', visibility: 'public_link', publicLinkExpiresAt: null, files: [{ path: 'index.html', content: '<h1>docs</h1>' }] },
    })

    expect(await expiryOf(published.body.artifactId)).toBeNull()
    expect(app.mailer.sent.length).toBe(mailBefore)
  })

  it('expires in 7 days when an agent with full access switches an artifact to a public link, but not when it only changes other settings', async () => {
    const fullToken = await app.createToken(authorCookie, 'full')
    const published = await app.publish({ token: fullToken }, 'Press kit')
    const sharingPath = `/api/artifacts/${published.artifactId}/sharing`

    await app.request(sharingPath, { method: 'PUT', token: fullToken, agentClient: 'Codex', body: { visibility: 'public_link' } })
    const expiresAt = await expiryOf(published.artifactId)
    const mailAfterSwitch = app.mailer.sent.length
    await app.request(sharingPath, { method: 'PUT', token: fullToken, body: { visibility: 'public_link', anonymousWriteEnabled: true } })

    expect(expiresAt).toBeGreaterThan(Date.now() + 6 * DAY)
    expect(app.mailer.lastTo('author@example.com')?.subject).toBe('Codex（代 author）把「Press kit」设为公开链接，7 天后过期')
    expect(await expiryOf(published.artifactId)).toBe(expiresAt)
    expect(app.mailer.sent.length).toBe(mailAfterSwitch)
  })

  it('leaves the choice to a person on the web page', async () => {
    const published = await app.publish({ token: authorToken }, 'Hand picked')
    const mailBefore = app.mailer.sent.length

    await setSharing(published.artifactId, { visibility: 'public_link' })

    expect(await expiryOf(published.artifactId)).toBeNull()
    expect(app.mailer.sent.length).toBe(mailBefore)
  })

  it('publishes even when the mail to the author cannot be sent', async () => {
    const mailOutageApp = new TestApp()
    const outageAuthorCookie = await mailOutageApp.signIn('author@example.com')
    const outageToken = await mailOutageApp.createToken(outageAuthorCookie)
    mailOutageApp.mailer.goOutOfService()

    const published = await mailOutageApp.request('/api/artifacts', { method: 'POST', token: outageToken, body: { title: 'Mail down', visibility: 'public_link', files: [{ path: 'index.html', content: 'x' }] } })

    expect(published.status).toBe(201)
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
    expect(wrongPassword.status).toBe(303)
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
    await app.repositories.artifactAccess.saveSharing(published.artifactId, { ...(summary?.sharing ?? { visibility: 'public_link', publicLinkPasswordHash: null, anonymousWriteEnabled: false, publicLinkShowsComments: false }), publicLinkExpiresAt: Date.now() - 1 }, [])

    const backToPrivate = await setSharing(published.artifactId, { visibility: 'private' })
    const sharing = await app.json<{ visibility: string; publicLink: { expiresAt: number } }>(`/api/artifacts/${published.artifactId}/sharing`, { cookie: authorCookie })

    expect(backToPrivate.status).toBe(200)
    expect(sharing.body.visibility).toBe('private')
  })

  it('limits password guesses for a public link', async () => {
    const published = await app.publish({ token: authorToken }, 'Guarded deck')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkPassword: 'right-one' })

    const attempts = []
    for (let attempt = 0; attempt < 6; attempt++) attempts.push((await app.request(`/a/${published.artifactId}/unlock`, { method: 'POST', form: { password: `guess-${attempt}` } })).headers.get('Location'))

    expect(attempts.slice(0, 5)).toEqual(Array(5).fill(`/a/${published.artifactId}?password=wrong`))
    expect(attempts[5]).toBe(`/a/${published.artifactId}?password=wait`)
  })

  it('answers each password with a redirect, so the address never shows /unlock and a reload never resubmits', async () => {
    const published = await app.publish({ token: authorToken }, 'Redirected deck')
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkPassword: 'right-one' })

    const wrong = await app.request(`/a/${published.artifactId}/unlock`, { method: 'POST', form: { password: 'nope' } })
    const wrongPrompt = await app.request(wrong.headers.get('Location') ?? '')
    const waitPrompt = await app.request(`/a/${published.artifactId}?password=wait`)
    const unlockOpenedDirectly = await app.request(`/a/${published.artifactId}/unlock`)

    expect(wrong.status).toBe(303)
    expect(wrongPrompt.status).toBe(401)
    expect(await wrongPrompt.text()).toContain('密码不对，再试一次。')
    expect(waitPrompt.status).toBe(429)
    expect(await waitPrompt.text()).toContain('1 分钟后可以再试')
    expect(unlockOpenedDirectly.status).toBe(303)
    expect(unlockOpenedDirectly.headers.get('Location')).toBe(`/a/${published.artifactId}`)
  })

  it('sends a visitor who finds nothing to sign in and come back to the same address', async () => {
    const missing = await app.request('/a/no-such-artifact')

    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('href="/login?next=%2Fa%2Fno-such-artifact"')
  })

  it('stops an expired link', async () => {
    const published = await app.publish({ token: authorToken }, 'Old offer')

    const pastExpiry = await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: Date.now() - 1000 })

    expect(pastExpiry.status).toBe(400)
  })
})

describe('what a visitor of a public link sees', () => {
  async function publicArtifactWithHistory(title: string): Promise<string> {
    const published = await app.publish({ token: authorToken }, title, '<h1>v1</h1>')
    const artifactPath = `/api/artifacts/${published.artifactId}`
    await app.request(artifactPath, { method: 'PUT', token: authorToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    await app.request(`${artifactPath}/comments`, { method: 'POST', cookie: memberCookie, body: { body: 'Internal note from a member' } })
    await app.request(`${artifactPath}/data/signups/member-1`, { method: 'PUT', cookie: memberCookie, body: { data: { name: 'Member' } } })
    await setSharing(published.artifactId, { visibility: 'public_link', publicLinkExpiresAt: null })
    return published.artifactId
  }

  it('shows an anonymous visitor the current page alone, with a way to sign in', async () => {
    const artifactId = await publicArtifactWithHistory('Launch page')

    const pageMarkup = await (await app.request(`/a/${artifactId}`)).text()

    expect(pageMarkup).toContain('artifact-frame')
    expect(pageMarkup).toContain('Launch page')
    expect(pageMarkup).toContain(`href="/login?next=${encodeURIComponent(`/a/${artifactId}`)}">登录后可以评论</a>`)
    expect(pageMarkup).not.toContain('panel-comments')
    expect(pageMarkup).not.toContain('panel-versions')
    expect(pageMarkup).not.toContain('panel-data')
    expect(pageMarkup).not.toContain('返回列表')
    expect(pageMarkup).not.toContain('data-visibility-pill')
  })

  it('refuses an anonymous visitor the comments, the versions, older files and the data listing', async () => {
    const artifactId = await publicArtifactWithHistory('Closed history')
    const artifactPath = `/api/artifacts/${artifactId}`

    const comments = await app.request(`${artifactPath}/comments`)
    const versions = await app.request(`${artifactPath}/versions`)
    const olderVersion = await app.request(`${artifactPath}?version=1`)
    const currentVersion = await app.request(`${artifactPath}?version=2`)
    const olderPage = await app.request(`/a/${artifactId}?v=1`)
    const olderFullPage = await app.request(`/a/${artifactId}/full?v=1`)
    const dataListing = await app.request(`${artifactPath}/data`)

    expect([comments.status, versions.status, olderVersion.status, dataListing.status]).toEqual([401, 401, 401, 401])
    expect(currentVersion.status).toBe(200)
    expect([olderPage.status, olderFullPage.status]).toEqual([302, 302])
    expect(olderPage.headers.get('Location')).toContain('/login?next=')
  })

  it('keeps the page\'s own shared data working for an anonymous visitor', async () => {
    const artifactId = await publicArtifactWithHistory('Public sign-up')
    await setSharing(artifactId, { visibility: 'public_link', anonymousWriteEnabled: true })

    const signups = await app.request(`/api/artifacts/${artifactId}/data/signups`)
    const anonymousSignup = await app.request(`/api/artifacts/${artifactId}/data/signups/guest-1`, { method: 'PUT', body: { data: { name: 'Guest' } } })

    expect([signups.status, anonymousSignup.status]).toEqual([200, 200])
  })

  it('shows an anonymous visitor the comments, read-only, once the author turns them on', async () => {
    const artifactId = await publicArtifactWithHistory('Open feedback')
    await setSharing(artifactId, { visibility: 'public_link', publicLinkShowsComments: true })

    const comments = await app.json<{ comments: { body: string; author: { name: string } }[] }>(`/api/artifacts/${artifactId}/comments`)
    const anonymousComment = await app.request(`/api/artifacts/${artifactId}/comments`, { method: 'POST', body: { body: 'hello' } })
    const versions = await app.request(`/api/artifacts/${artifactId}/versions`)
    const pageMarkup = await (await app.request(`/a/${artifactId}`)).text()
    const sharing = await app.json<{ publicLink: { showsComments: boolean } }>(`/api/artifacts/${artifactId}/sharing`, { cookie: authorCookie })

    expect(comments.status).toBe(200)
    expect(comments.body.comments[0]).toMatchObject({ body: 'Internal note from a member', author: { name: 'member' } })
    expect(anonymousComment.status).toBe(401)
    expect(versions.status).toBe(401)
    expect(pageMarkup).toContain('panel-comments')
    expect(pageMarkup).not.toContain('panel-versions')
    expect(pageMarkup).not.toContain('panel-data')
    expect(sharing.body.publicLink.showsComments).toBe(true)
  })

  it('treats a signed-in person from another workspace like any visitor of the link', async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('workspace-partner', 'Partner team', ?)").bind(Date.now()).run()
    const partnerPage = await app.repositories.artifacts.create({ workspaceId: 'workspace-partner', authorId: 'user-partner', title: 'Partner brief', visibility: 'public_link', publicLinkExpiresAt: null, publishedVia: null, note: null, files: [{ path: 'index.html', contentType: 'text/html', body: new TextEncoder().encode('x') }] })

    const versions = await app.request(`/api/artifacts/${partnerPage.artifactId}/versions`, { cookie: memberCookie })
    const pageMarkup = await (await app.request(`/a/${partnerPage.artifactId}`, { cookie: memberCookie })).text()

    expect(versions.status).toBe(403)
    expect(pageMarkup).toContain('artifact-frame')
    expect(pageMarkup).not.toContain('panel-versions')
    expect(pageMarkup).not.toContain('登录后可以评论')
  })

  it('still shows members the comments, versions and data of an artifact that has a public link', async () => {
    const artifactId = await publicArtifactWithHistory('Member view')
    const artifactPath = `/api/artifacts/${artifactId}`

    const statuses = await Promise.all([`${artifactPath}/comments`, `${artifactPath}/versions`, `${artifactPath}?version=1`, `${artifactPath}/data`].map(async path => (await app.request(path, { cookie: memberCookie })).status))
    const pageMarkup = await (await app.request(`/a/${artifactId}`, { cookie: memberCookie })).text()

    expect(statuses).toEqual([200, 200, 200, 200])
    expect(pageMarkup).toContain('panel-versions')
    expect(pageMarkup).toContain('返回列表')
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
