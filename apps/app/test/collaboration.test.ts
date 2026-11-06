import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let authorCookie = ''
let reviewerCookie = ''
let agentToken = ''

beforeAll(async () => {
  authorCookie = await app.signIn('lin@example.com')
  reviewerCookie = await app.signIn('zhou@example.com')
  agentToken = await app.createToken(authorCookie)
})

interface VersionJson {
  version: number
  publishedVia: string | null
  origin: 'published' | 'restored'
  restoredFrom: number | null
  note: string | null
}

interface CommentJson {
  commentId: string
  parentId: string | null
  body: string
  forAgent: boolean
  postedVia: string | null
  resolved: boolean
  author: { name: string }
}

describe('publishing and updating', () => {
  it('publishes on top of the version read, and answers a stale update with the latest files to merge', async () => {
    const published = await app.publish({ token: agentToken, agentClient: 'Codex' }, 'Migration board', '<h1>draft</h1>')
    const update = (baseVersion: number, page: string) =>
      app.json<{ version?: number; currentVersion?: number; latestFiles?: { content: string }[] }>(`/api/artifacts/${published.artifactId}`, {
        method: 'PUT',
        token: agentToken,
        body: { baseVersion, files: [{ path: 'index.html', content: page }] },
      })

    const firstUpdate = await update(1, '<h1>revised</h1>')
    const staleUpdate = await update(1, '<h1>stale</h1>')
    const forced = await app.json<{ version: number }>(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { force: true, files: [{ path: 'index.html', content: '<h1>forced</h1>' }] } })

    expect(firstUpdate).toMatchObject({ status: 200, body: { version: 2 } })
    expect(staleUpdate.status).toBe(409)
    expect(staleUpdate.body.currentVersion).toBe(2)
    expect(staleUpdate.body.latestFiles?.map(file => file.content)).toEqual(['<h1>revised</h1>'])
    expect(forced.body.version).toBe(3)
  })

  it.each([
    ['no title', { files: [{ path: 'index.html', content: 'x' }] }, 'title must be'],
    ['no entry page', { title: 'T', files: [{ path: 'about.html', content: '' }] }, 'files must include index.html'],
    ['a path leaving its folder', { title: 'T', files: [{ path: 'index.html', content: '' }, { path: '../secret.html', content: '' }] }, 'relative path'],
    ['the same path twice', { title: 'T', files: [{ path: 'index.html', content: '' }, { path: 'index.html', content: '' }] }, 'only once'],
    ['an unknown visibility', { title: 'T', visibility: 'everyone', files: [{ path: 'index.html', content: '' }] }, 'visibility must be'],
    ['broken base64', { title: 'T', files: [{ path: 'index.html', content: '' }, { path: 'a.png', encoding: 'base64', content: '***' }] }, 'not valid base64'],
  ])('rejects a publish with %s', async (_case, body, expectedError) => {
    const rejected = await app.json<{ error: string }>('/api/artifacts', { method: 'POST', token: agentToken, body })

    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toContain(expectedError)
  })

  it('limits the number and size of files in a version', async () => {
    const tooManyFiles = [{ path: 'index.html', content: '' }, ...Array.from({ length: 500 }, (_, index) => ({ path: `part-${index}.txt`, content: '' }))]

    const manyFiles = await app.json<{ error: string }>('/api/artifacts', { method: 'POST', token: agentToken, body: { title: 'Many', files: tooManyFiles } })
    const bigFile = await app.json<{ error: string }>('/api/artifacts', { method: 'POST', token: agentToken, body: { title: 'Big', files: [{ path: 'index.html', content: 'x'.repeat(10 * 1024 * 1024 + 1) }] } })

    expect(manyFiles.status).toBe(400)
    expect(manyFiles.body.error).toContain('at most 500 files')
    expect(bigFile.status).toBe(413)
    expect(bigFile.body.error).toContain('index.html')
  })

  it('keeps every version and restores an older one as a new version that says where it came from', async () => {
    const published = await app.publish({ token: agentToken, agentClient: 'Claude Code' }, 'Roadmap', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, agentClient: 'Cursor', body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const restored = await app.json<{ version: number }>(`/api/artifacts/${published.artifactId}/versions/1/restore`, { method: 'POST', cookie: authorCookie, body: { baseVersion: 2 } })
    const history = await app.json<{ versions: VersionJson[] }>(`/api/artifacts/${published.artifactId}/versions`, { cookie: reviewerCookie })
    const current = await app.json<{ files: { content: string }[] }>(`/api/artifacts/${published.artifactId}`, { cookie: reviewerCookie })
    const reviewerRestore = await app.request(`/api/artifacts/${published.artifactId}/versions/2/restore`, { method: 'POST', cookie: reviewerCookie, body: { baseVersion: 3 } })

    expect(restored.body.version).toBe(3)
    expect(history.body.versions.map(version => [version.version, version.publishedVia, version.origin, version.restoredFrom])).toEqual([
      [3, null, 'restored', 1],
      [2, 'Cursor', 'published', null],
      [1, 'Claude Code', 'published', null],
    ])
    expect(current.body.files[0]?.content).toBe('<h1>v1</h1>')
    expect(reviewerRestore.status).toBe(403)
  })

  it('undoes a restore by restoring the version it replaced, so history only grows', async () => {
    const published = await app.publish({ token: agentToken }, 'Pricing', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const restorePath = (version: number) => `/api/artifacts/${published.artifactId}/versions/${version}/restore`

    await app.request(restorePath(1), { method: 'POST', cookie: authorCookie, body: { baseVersion: 2 } })
    const undo = await app.json<{ version: number }>(restorePath(2), { method: 'POST', cookie: authorCookie, body: { baseVersion: 3 } })
    const history = await app.json<{ versions: VersionJson[] }>(`/api/artifacts/${published.artifactId}/versions`, { cookie: authorCookie })
    const current = await app.json<{ files: { content: string }[] }>(`/api/artifacts/${published.artifactId}`, { cookie: authorCookie })

    expect(undo.body.version).toBe(4)
    expect(history.body.versions.map(version => [version.version, version.origin, version.restoredFrom])).toEqual([
      [4, 'restored', 2],
      [3, 'restored', 1],
      [2, 'published', null],
      [1, 'published', null],
    ])
    expect(current.body.files[0]?.content).toBe('<h1>v2</h1>')
  })

  it('refuses a restore made on top of a version that is no longer current', async () => {
    const published = await app.publish({ token: agentToken }, 'Launch plan', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 2, files: [{ path: 'index.html', content: '<h1>v3</h1>' }] } })

    const staleRestore = await app.json<{ currentVersion: number }>(`/api/artifacts/${published.artifactId}/versions/1/restore`, { method: 'POST', cookie: authorCookie, body: { baseVersion: 2 } })
    const current = await app.json<{ version: number }>(`/api/artifacts/${published.artifactId}`, { cookie: authorCookie })

    expect(staleRestore.status).toBe(409)
    expect(staleRestore.body.currentVersion).toBe(3)
    expect(current.body.version).toBe(3)
  })

  it('keeps the note that says what each version changed', async () => {
    const created = await app.json<{ artifactId: string }>('/api/artifacts', {
      method: 'POST',
      token: agentToken,
      body: { title: 'Onboarding', note: '  第一版：三个步骤  ', files: [{ path: 'index.html', content: '<h1>v1</h1>' }] },
    })
    const artifactPath = `/api/artifacts/${created.body.artifactId}`
    await app.request(artifactPath, { method: 'PUT', token: agentToken, body: { baseVersion: 1, note: '按评论补上第 3 节的连线', files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    await app.request(artifactPath, { method: 'PUT', token: agentToken, body: { baseVersion: 2, files: [{ path: 'index.html', content: '<h1>v3</h1>' }] } })
    await app.request(`${artifactPath}/versions/1/restore`, { method: 'POST', cookie: authorCookie, body: { baseVersion: 3, note: '第 3 节的改法不对，先回到第一版' } })

    const history = await app.json<{ versions: VersionJson[] }>(`${artifactPath}/versions`, { cookie: reviewerCookie })

    expect(history.body.versions.map(version => [version.version, version.note])).toEqual([
      [4, '第 3 节的改法不对，先回到第一版'],
      [3, null],
      [2, '按评论补上第 3 节的连线'],
      [1, '第一版：三个步骤'],
    ])
  })

  it('rejects a note longer than one sentence', async () => {
    const published = await app.publish({ token: agentToken }, 'Long note')

    const rejected = await app.json<{ error: string }>(`/api/artifacts/${published.artifactId}`, {
      method: 'PUT',
      token: agentToken,
      body: { baseVersion: 1, note: '改'.repeat(201), files: [{ path: 'index.html', content: '<h1>v2</h1>' }] },
    })

    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toContain('note must be 1 to 200 characters')
  })
})

describe('the comment loop with an agent', () => {
  it('lets a reviewer ask the agent, the agent reply and resolve, and the author hear about it', async () => {
    const published = await app.publish({ token: agentToken, agentClient: 'Claude Code' }, 'Design doc')
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`

    const request = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: '第 3 节少了一条线', forAgent: true } })
    await app.request(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: '整体不错' } })
    const forAgent = await app.json<{ comments: CommentJson[] }>(`${commentsPath}?filter=for_agent`, { token: agentToken })
    const reply = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', token: agentToken, agentClient: 'Claude Code', body: { body: '已在 v2 补上', parentId: request.body.comment.commentId } })
    const resolve = await app.request(`/api/comments/${request.body.comment.commentId}`, { method: 'PATCH', token: agentToken, body: { resolved: true } })
    const forAgentAfter = await app.json<{ comments: CommentJson[] }>(`${commentsPath}?filter=for_agent`, { token: agentToken })
    const everything = await app.json<{ comments: CommentJson[] }>(commentsPath, { cookie: authorCookie })

    expect(forAgent.body.comments.map(comment => comment.body)).toEqual(['第 3 节少了一条线'])
    expect(reply.body.comment).toMatchObject({ postedVia: 'Claude Code', parentId: request.body.comment.commentId, forAgent: false })
    expect(resolve.status).toBe(200)
    expect(forAgentAfter.body.comments).toEqual([])
    expect(everything.body.comments.map(comment => [comment.body, comment.resolved])).toEqual([
      ['第 3 节少了一条线', true],
      ['整体不错', false],
      ['已在 v2 补上', false],
    ])
    expect(app.mailer.lastTo('lin@example.com')?.subject).toBe('zhou 在「Design doc」发表了评论')
    expect(app.mailer.lastTo('zhou@example.com')?.subject).toBe('lin 在「Design doc」回复了评论')
  })

  it('keeps the comment loop working when notification mail cannot be sent', async () => {
    const mailOutageApp = new TestApp()
    const outageAuthorCookie = await mailOutageApp.signIn('lin@example.com')
    const outageReviewerCookie = await mailOutageApp.signIn('zhou@example.com')
    const outageAgentToken = await mailOutageApp.createToken(outageAuthorCookie)
    const published = await mailOutageApp.publish({ token: outageAgentToken }, 'Mail outage')
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`
    mailOutageApp.mailer.goOutOfService()

    const reviewerComment = await mailOutageApp.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: outageReviewerCookie, body: { body: '数字对不上', forAgent: true } })
    const agentReply = await mailOutageApp.request(commentsPath, { method: 'POST', token: outageAgentToken, body: { body: '已修正', parentId: reviewerComment.body.comment.commentId } })
    const savedComments = await mailOutageApp.json<{ comments: CommentJson[] }>(commentsPath, { cookie: outageAuthorCookie })

    expect(reviewerComment.status).toBe(201)
    expect(agentReply.status).toBe(201)
    expect(savedComments.body.comments.map(comment => comment.body)).toEqual(['数字对不上', '已修正'])
  })

  it('attaches a reply to a reply to the thread it belongs to', async () => {
    const published = await app.publish({ token: agentToken }, 'Threads')
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`
    const question = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: 'Why?' } })
    const answer = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: authorCookie, body: { body: 'Because.', parentId: question.body.comment.commentId } })

    const followUp = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: 'Thanks', parentId: answer.body.comment.commentId } })

    expect(followUp.body.comment.parentId).toBe(question.body.comment.commentId)
    expect(app.mailer.lastTo('lin@example.com')?.subject).toContain('回复了评论')
  })

  it('pins a comment to a spot on the page, and refuses a spot off the page', async () => {
    const published = await app.publish({ token: agentToken }, 'Pinned')
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`

    const pinned = await app.json<{ comment: CommentJson & { anchor: unknown } }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: '这条线缺了', forAgent: true, anchor: { x: 0.123456, y: 0.5 } } })
    const offPage = await app.request(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: 'x', anchor: { x: 1.5, y: 0.2 } } })
    const reply = await app.json<{ comment: CommentJson & { anchor: unknown } }>(commentsPath, { method: 'POST', cookie: authorCookie, body: { body: '改了', parentId: pinned.body.comment.commentId, anchor: { x: 0.1, y: 0.1 } } })

    expect(pinned.body.comment.anchor).toEqual({ x: 0.1235, y: 0.5 })
    expect(offPage.status).toBe(400)
    expect(reply.body.comment.anchor).toBeNull()
  })

  it('refuses a reply to a comment on another artifact', async () => {
    const first = await app.publish({ token: agentToken }, 'First')
    const second = await app.publish({ token: agentToken }, 'Second')
    const comment = await app.json<{ comment: CommentJson }>(`/api/artifacts/${first.artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body: { body: 'hi' } })

    const crossReply = await app.request(`/api/artifacts/${second.artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body: { body: 'x', parentId: comment.body.comment.commentId } })

    expect(crossReply.status).toBe(400)
  })
})

describe('shared data', () => {
  it('keeps documents per collection with who wrote them, for every member', async () => {
    const published = await app.publish({ token: agentToken }, 'Sign-up sheet')
    const dataPath = `/api/artifacts/${published.artifactId}/data`

    await app.request(`${dataPath}/signups/lin`, { method: 'PUT', cookie: authorCookie, body: { data: { session: 'Morning' } } })
    const reviewerWrite = await app.json<{ document: { createdBy: { name: string }; updatedBy: { name: string } } }>(`${dataPath}/signups/lin`, { method: 'PUT', cookie: reviewerCookie, body: { data: { session: 'Afternoon' } } })
    const collections = await app.json<{ collections: { collection: string; documentCount: number }[] }>(dataPath, { cookie: reviewerCookie })
    const deleted = await app.request(`${dataPath}/signups/lin`, { method: 'DELETE', cookie: reviewerCookie })
    const deletedAgain = await app.request(`${dataPath}/signups/lin`, { method: 'DELETE', cookie: reviewerCookie })

    expect(reviewerWrite.body.document).toMatchObject({ createdBy: { name: 'lin' }, updatedBy: { name: 'zhou' } })
    expect(collections.body.collections).toEqual([{ collection: 'signups', documentCount: 1 }])
    expect([deleted.status, deletedAgain.status]).toEqual([204, 404])
  })

  it('rejects unsafe names and oversized documents', async () => {
    const published = await app.publish({ token: agentToken }, 'Limits')
    const dataPath = `/api/artifacts/${published.artifactId}/data`

    const badCollection = await app.request(`${dataPath}/${encodeURIComponent('../x')}/doc`, { method: 'PUT', cookie: authorCookie, body: { data: 1 } })
    const oversized = await app.request(`${dataPath}/notes/big`, { method: 'PUT', cookie: authorCookie, body: { data: 'x'.repeat(70 * 1024) } })
    const noData = await app.request(`${dataPath}/notes/empty`, { method: 'PUT', cookie: authorCookie, body: {} })

    expect([badCollection.status, oversized.status, noData.status]).toEqual([400, 413, 400])
  })
})
