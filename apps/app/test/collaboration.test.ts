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
  resolvedAt: number | null
  resolvedBy: { name: string } | null
  author: { name: string }
  canDelete: boolean
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

  it('keeps every version and restores an older one as a new version that says where it came from and keeps its source', async () => {
    const published = await app.publish({ token: agentToken, agentClient: 'Claude Code' }, 'Roadmap', '<h1>v1</h1>')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, agentClient: 'Cursor', body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const restored = await app.json<{ version: number }>(`/api/artifacts/${published.artifactId}/versions/1/restore`, { method: 'POST', cookie: authorCookie, body: { baseVersion: 2 } })
    const history = await app.json<{ versions: VersionJson[] }>(`/api/artifacts/${published.artifactId}/versions`, { cookie: reviewerCookie })
    const current = await app.json<{ files: { content: string }[] }>(`/api/artifacts/${published.artifactId}`, { cookie: reviewerCookie })
    const reviewerRestore = await app.request(`/api/artifacts/${published.artifactId}/versions/2/restore`, { method: 'POST', cookie: reviewerCookie, body: { baseVersion: 3 } })

    expect(restored.body.version).toBe(3)
    expect(history.body.versions.map(version => [version.version, version.publishedVia, version.origin, version.restoredFrom])).toEqual([
      [3, 'Claude Code', 'restored', 1],
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
    expect(everything.body.comments.map(comment => [comment.body, comment.resolved, comment.resolvedBy?.name ?? null])).toEqual([
      ['第 3 节少了一条线', true, 'lin'],
      ['整体不错', false, null],
      ['已在 v2 补上', false, null],
    ])
    expect(everything.body.comments[0]?.resolvedAt).toBeGreaterThan(0)
    expect(app.mailer.lastTo('lin@example.com')?.subject).toBe('zhou 在「Design doc」发表了评论')
    expect(app.mailer.sent.filter(email => email.to === 'zhou@example.com').map(email => email.subject)).toContain('Claude Code（代 lin）在「Design doc」回复了评论')
  })

  it('lets people delete their own comments, and the author clear any comment with its replies and notices', async () => {
    const published = await app.publish({ token: agentToken }, 'Pricing page')
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`
    const question = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: '价格对吗？' } })
    const questionId = question.body.comment.commentId
    const answer = await app.json<{ comment: CommentJson }>(commentsPath, { method: 'POST', cookie: authorCookie, body: { body: '对的', parentId: questionId } })
    const asSeenByReviewer = await app.json<{ comments: CommentJson[] }>(commentsPath, { cookie: reviewerCookie })
    const asSeenByAuthor = await app.json<{ comments: CommentJson[] }>(commentsPath, { cookie: authorCookie })
    const noticesBefore = await app.json<{ notifications: { artifactId: string }[] }>('/api/notifications', { cookie: authorCookie })

    const reviewerDeletesAuthorsReply = await app.request(`/api/comments/${answer.body.comment.commentId}`, { method: 'DELETE', cookie: reviewerCookie })
    const authorDeletesQuestion = await app.request(`/api/comments/${questionId}`, { method: 'DELETE', cookie: authorCookie })
    const afterDelete = await app.json<{ comments: CommentJson[] }>(commentsPath, { cookie: authorCookie })
    const noticesAfter = await app.json<{ notifications: { artifactId: string }[] }>('/api/notifications', { cookie: authorCookie })
    const deletedAgain = await app.request(`/api/comments/${questionId}`, { method: 'DELETE', cookie: authorCookie })

    expect(question.body.comment.canDelete).toBe(true)
    expect(asSeenByReviewer.body.comments.map(comment => [comment.body, comment.canDelete])).toEqual([['价格对吗？', true], ['对的', false]])
    expect(asSeenByAuthor.body.comments.map(comment => comment.canDelete)).toEqual([true, true])
    expect(noticesBefore.body.notifications.some(notice => notice.artifactId === published.artifactId)).toBe(true)
    expect(reviewerDeletesAuthorsReply.status).toBe(403)
    expect(authorDeletesQuestion.status).toBe(204)
    expect(afterDelete.body.comments).toEqual([])
    expect(noticesAfter.body.notifications.some(notice => notice.artifactId === published.artifactId)).toBe(false)
    expect(deletedAgain.status).toBe(404)
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

    expect(pinned.body.comment.anchor).toEqual({ x: 0.1235, y: 0.5, version: 1, selector: null, textQuote: null, quote: null })
    expect(offPage.status).toBe(400)
    expect(reply.body.comment.anchor).toBeNull()
  })

  it('remembers the element and text a pin was placed on, and the version it was placed in', async () => {
    const published = await app.publish({ token: agentToken }, 'Pinned element')
    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`
    const pin = (anchor: Record<string, unknown>) => app.json<{ comment: { anchor: unknown }; error?: string }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: '这里', anchor } })

    const onElement = await pin({ x: 0.2, y: 0.3, version: 1, selector: '#pricing > table > tr:nth-of-type(2)', textQuote: '专业版 ¥99' })
    const onCurrentVersion = await pin({ x: 0.2, y: 0.3 })
    const futureVersion = await pin({ x: 0.2, y: 0.3, version: 3 })
    const longQuote = await pin({ x: 0.2, y: 0.3, textQuote: 'x'.repeat(121) })
    const selectorNumber = await pin({ x: 0.2, y: 0.3, selector: 42 })

    expect(onElement.body.comment.anchor).toEqual({ x: 0.2, y: 0.3, version: 1, selector: '#pricing > table > tr:nth-of-type(2)', textQuote: '专业版 ¥99', quote: null })
    expect(onCurrentVersion.body.comment.anchor).toEqual({ x: 0.2, y: 0.3, version: 2, selector: null, textQuote: null, quote: null })
    expect([futureVersion.status, longQuote.status, selectorNumber.status]).toEqual([400, 400, 400])
    expect(futureVersion.body.error).toContain('version')
  })

  it('remembers the words a person selected, with the text around them', async () => {
    const published = await app.publish({ token: agentToken }, 'Selected words')
    const commentsPath = `/api/artifacts/${published.artifactId}/comments`
    const pin = (anchor: Record<string, unknown>) => app.json<{ comment: { anchor: unknown } }>(commentsPath, { method: 'POST', cookie: reviewerCookie, body: { body: '换个说法', anchor } })

    const onWords = await pin({ x: 0.2, y: 0.3, selector: 'body > p:nth-of-type(2)', textQuote: '产品有五类使用者。', quote: { exact: '五类使用者', prefix: '产品有', suffix: '。前两类' } })
    const withoutContext = await pin({ x: 0.2, y: 0.3, quote: { exact: '五类' } })
    const emptySelection = await pin({ x: 0.2, y: 0.3, quote: { exact: '' } })
    const longSelection = await pin({ x: 0.2, y: 0.3, quote: { exact: 'x'.repeat(501) } })

    expect(onWords.body.comment.anchor).toMatchObject({ selector: 'body > p:nth-of-type(2)', quote: { exact: '五类使用者', prefix: '产品有', suffix: '。前两类' } })
    expect(withoutContext.body.comment.anchor).toMatchObject({ quote: { exact: '五类', prefix: '', suffix: '' } })
    expect([emptySelection.status, longSelection.status]).toEqual([400, 400])
  })

  it('refuses a reply to a comment on another artifact', async () => {
    const first = await app.publish({ token: agentToken }, 'First')
    const second = await app.publish({ token: agentToken }, 'Second')
    const comment = await app.json<{ comment: CommentJson }>(`/api/artifacts/${first.artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body: { body: 'hi' } })

    const crossReply = await app.request(`/api/artifacts/${second.artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body: { body: 'x', parentId: comment.body.comment.commentId } })

    expect(crossReply.status).toBe(400)
  })
})

describe('the agent inbox', () => {
  interface InboxComment {
    commentId: string
    artifactId: string
    title: string
    version: number
    url: string
    anchor: unknown
    body: string
    author: { name: string }
    replies: { body: string; postedVia: string | null }[]
  }

  it('lists open comments for the agent on every artifact the token owner can edit', async () => {
    const reviewerToken = await app.createToken(reviewerCookie)
    const mine = await app.publish({ token: agentToken }, 'Inbox: mine')
    await app.request(`/api/artifacts/${mine.artifactId}`, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })
    const editable = await app.publish({ token: reviewerToken }, 'Inbox: editable', '<h1>hello</h1>', 'specified')
    const agentOwner = await app.json<{ user: { userId: string } }>('/api/me', { token: agentToken })
    await app.request(`/api/artifacts/${editable.artifactId}/sharing`, { method: 'PUT', cookie: reviewerCookie, body: { grants: [{ userId: agentOwner.body.user.userId, role: 'editor' }] } })
    const readOnly = await app.publish({ token: reviewerToken }, 'Inbox: read only')
    const comment = async (artifactId: string, body: Record<string, unknown>) =>
      (await app.json<{ comment: { commentId: string } }>(`/api/artifacts/${artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body })).body.comment.commentId
    const pinned = await comment(mine.artifactId, { body: '图例错了', forAgent: true, anchor: { x: 0.5, y: 0.25 } })
    await comment(mine.artifactId, { body: '还是不对', parentId: pinned })
    await comment(mine.artifactId, { body: '给人看的', forAgent: false })
    const settled = await comment(mine.artifactId, { body: '已经好了', forAgent: true })
    await app.request(`/api/comments/${settled}`, { method: 'PATCH', cookie: reviewerCookie, body: { resolved: true } })
    await comment(editable.artifactId, { body: '加一节', forAgent: true })
    await comment(readOnly.artifactId, { body: '看不到我', forAgent: true })

    const inbox = await app.json<{ comments: InboxComment[] }>('/api/comments?for=me&status=open', { token: agentToken })
    const inboxHere = inbox.body.comments.filter(inboxComment => inboxComment.title.startsWith('Inbox:'))

    expect(inbox.status).toBe(200)
    expect(inboxHere.map(inboxComment => [inboxComment.title, inboxComment.body])).toEqual([
      ['Inbox: mine', '图例错了'],
      ['Inbox: editable', '加一节'],
    ])
    expect(inboxHere[0]).toMatchObject({
      commentId: pinned,
      artifactId: mine.artifactId,
      version: 2,
      url: `http://app.test/a/${mine.artifactId}#comment-${pinned}`,
      anchor: { x: 0.5, y: 0.25, version: 2 },
      author: { name: 'zhou' },
      replies: [{ body: '还是不对', postedVia: null }],
    })
  })

  it('refuses an inbox for anyone but the caller, or for closed comments', async () => {
    const forEveryone = await app.json<{ error: string }>('/api/comments?for=everyone&status=open', { token: agentToken })
    const closed = await app.json<{ error: string }>('/api/comments?for=me&status=resolved', { token: agentToken })

    expect([forEveryone.status, closed.status]).toEqual([400, 400])
    expect(forEveryone.body.error).toContain('for=me')
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
