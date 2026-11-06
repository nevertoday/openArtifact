import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let linCookie = ''
let zhouCookie = ''
let wangCookie = ''
let linAgentToken = ''

beforeAll(async () => {
  linCookie = await app.signIn('lin@example.com')
  zhouCookie = await app.signIn('zhou@example.com')
  wangCookie = await app.signIn('wang@example.com')
  linAgentToken = await app.createToken(linCookie)
})

interface NotificationJson {
  notificationId: string
  kind: string
  artifactId: string
  commentId: string | null
  actor: { userId: string; name: string; agentClient: string | null }
  text: string
  url: string
  read: boolean
}

interface NotificationList {
  notifications: NotificationJson[]
  unreadCount: number
}

async function notificationsOf(cookie: string): Promise<NotificationList> {
  const { status, body } = await app.json<NotificationList>('/api/notifications', { cookie })
  expect(status).toBe(200)
  return body
}

async function notificationsAbout(cookie: string, artifactId: string): Promise<NotificationJson[]> {
  return (await notificationsOf(cookie)).notifications.filter(notification => notification.artifactId === artifactId)
}

async function comment(cookie: string, artifactId: string, body: Record<string, unknown>): Promise<string> {
  const { status, body: created } = await app.json<{ comment: { commentId: string } }>(`/api/artifacts/${artifactId}/comments`, { method: 'POST', cookie, body })
  expect(status).toBe(201)
  return created.comment.commentId
}

function mailTo(address: string, artifactTitle: string): string[] {
  return app.mailer.sent.filter(email => email.to === address && email.subject.includes(`「${artifactTitle}」`)).map(email => email.subject)
}

describe('notifications about comments', () => {
  it('tells the artifact author about a new comment, in the app and by mail', async () => {
    const published = await app.publish({ token: linAgentToken, agentClient: 'Claude Code' }, 'Pricing page')

    const commentId = await comment(zhouCookie, published.artifactId, { body: '价格表少了一列', forAgent: true })

    expect(await notificationsAbout(linCookie, published.artifactId)).toMatchObject([
      { kind: 'comment_on_my_artifact', commentId, actor: { name: 'zhou', agentClient: null }, text: 'zhou 评论了你的「Pricing page」', read: false },
    ])
    expect((await notificationsAbout(linCookie, published.artifactId))[0]?.url).toBe(`http://app.test/a/${published.artifactId}#comment-${commentId}`)
    expect(mailTo('lin@example.com', 'Pricing page')).toEqual(['zhou 在「Pricing page」留了一条给 agent 的评论'])
    expect(await notificationsAbout(zhouCookie, published.artifactId)).toEqual([])
  })

  it('names the agent that replied on a person\'s behalf', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Agent reply')
    const question = await comment(zhouCookie, published.artifactId, { body: '图例看不清', forAgent: true })

    await app.request(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', token: linAgentToken, agentClient: 'Claude Code', body: { body: '已在 v2 加大字号', parentId: question } })

    expect(await notificationsAbout(zhouCookie, published.artifactId)).toMatchObject([
      { kind: 'reply_to_my_comment', actor: { name: 'lin', agentClient: 'Claude Code' }, text: 'Claude Code（代 lin）回复了你在「Agent reply」的评论' },
    ])
    expect(mailTo('zhou@example.com', 'Agent reply')).toEqual(['Claude Code（代 lin）在「Agent reply」回复了评论'])
  })

  it('tells everyone in a thread about a reply to a reply, once each', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Thread replies')
    const question = await comment(zhouCookie, published.artifactId, { body: '为什么用红色？' })
    const answer = await comment(wangCookie, published.artifactId, { body: '品牌色', parentId: question })

    await comment(linCookie, published.artifactId, { body: '同意', parentId: answer })

    expect((await notificationsAbout(zhouCookie, published.artifactId)).map(notification => [notification.kind, notification.actor.name])).toEqual([
      ['reply_to_my_comment', 'lin'],
      ['reply_to_my_comment', 'wang'],
    ])
    expect((await notificationsAbout(wangCookie, published.artifactId)).map(notification => [notification.kind, notification.actor.name])).toEqual([['reply_to_my_comment', 'lin']])
    expect((await notificationsAbout(linCookie, published.artifactId)).map(notification => notification.kind)).toEqual(['comment_on_my_artifact', 'comment_on_my_artifact'])
  })

  it('resolves the thread from a reply that says resolve, and tells its author once', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Resolve by reply')
    const question = await comment(zhouCookie, published.artifactId, { body: '数据过期了', forAgent: true })

    const reply = await app.json<{ comment: { parentId: string } }>(`/api/artifacts/${published.artifactId}/comments`, {
      method: 'POST',
      token: linAgentToken,
      agentClient: 'Codex',
      body: { body: '已在 v2 更新数据', parentId: question, resolve: true },
    })
    const thread = await app.json<{ comments: { commentId: string; resolved: boolean; resolvedBy: { name: string } | null }[] }>(`/api/artifacts/${published.artifactId}/comments`, { cookie: zhouCookie })

    expect(reply.status).toBe(201)
    expect(thread.body.comments.find(candidate => candidate.commentId === question)).toMatchObject({ resolved: true, resolvedBy: { name: 'lin' } })
    expect(await notificationsAbout(zhouCookie, published.artifactId)).toMatchObject([
      { kind: 'my_comment_resolved', actor: { agentClient: 'Codex' }, text: 'Codex（代 lin）解决了你在「Resolve by reply」的评论' },
    ])
    expect(mailTo('zhou@example.com', 'Resolve by reply')).toEqual(['Codex（代 lin）在「Resolve by reply」解决了你的评论'])
  })

  it('refuses resolve on a comment that is not a reply', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Resolve top level')

    const refused = await app.json<{ error: string }>(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', cookie: zhouCookie, body: { body: 'x', resolve: true } })

    expect(refused.status).toBe(400)
    expect(refused.body.error).toContain('resolve')
  })

  it('tells the comment author when someone resolves it, and stays quiet on reopening', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Resolve by button')
    const question = await comment(zhouCookie, published.artifactId, { body: '标题太长' })

    await app.request(`/api/comments/${question}`, { method: 'PATCH', cookie: linCookie, body: { resolved: true } })
    await app.request(`/api/comments/${question}`, { method: 'PATCH', cookie: linCookie, body: { resolved: true } })
    await app.request(`/api/comments/${question}`, { method: 'PATCH', cookie: linCookie, body: { resolved: false } })

    expect((await notificationsAbout(zhouCookie, published.artifactId)).map(notification => [notification.kind, notification.text])).toEqual([
      ['my_comment_resolved', 'lin 解决了你在「Resolve by button」的评论'],
    ])
    expect(mailTo('zhou@example.com', 'Resolve by button')).toEqual(['lin 在「Resolve by button」解决了你的评论'])
  })
})

describe('notifications about new versions', () => {
  it('tells people with an open thread, in the app only, and not the publisher', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Roadmap Q3')
    const openQuestion = await comment(zhouCookie, published.artifactId, { body: '第二季度呢？' })
    await comment(linCookie, published.artifactId, { body: '我来补', parentId: openQuestion })
    const settled = await comment(wangCookie, published.artifactId, { body: '错别字' })
    await app.request(`/api/comments/${settled}`, { method: 'PATCH', cookie: linCookie, body: { resolved: true } })
    const mailCountBefore = app.mailer.sent.length

    await app.request(`/api/artifacts/${published.artifactId}`, { method: 'PUT', token: linAgentToken, agentClient: 'Claude Code', body: { baseVersion: 1, files: [{ path: 'index.html', content: '<h1>v2</h1>' }] } })

    const zhouNews = await notificationsAbout(zhouCookie, published.artifactId)
    expect(zhouNews.filter(notification => notification.kind === 'new_version')).toMatchObject([
      { commentId: null, actor: { name: 'lin', agentClient: 'Claude Code' }, text: 'Claude Code（代 lin）发布了「Roadmap Q3」的新版本', url: `http://app.test/a/${published.artifactId}` },
    ])
    expect((await notificationsAbout(wangCookie, published.artifactId)).map(notification => notification.kind)).toEqual(['my_comment_resolved'])
    expect((await notificationsAbout(linCookie, published.artifactId)).map(notification => notification.kind)).not.toContain('new_version')
    expect(app.mailer.sent.length).toBe(mailCountBefore)
  })
})

describe('reading notifications', () => {
  it('lists the newest first and marks one or all as read', async () => {
    const readerApp = new TestApp()
    const authorCookie = await readerApp.signIn('lin@example.com')
    const reviewerCookie = await readerApp.signIn('zhou@example.com')
    const authorToken = await readerApp.createToken(authorCookie)
    const published = await readerApp.publish({ token: authorToken }, 'Reading')
    const commentIds: string[] = []
    for (const body of ['一', '二', '三']) {
      const created = await readerApp.json<{ comment: { commentId: string } }>(`/api/artifacts/${published.artifactId}/comments`, { method: 'POST', cookie: reviewerCookie, body: { body } })
      commentIds.push(created.body.comment.commentId)
    }
    const unread = await readerApp.json<NotificationList>('/api/notifications', { cookie: authorCookie })
    const readingNotifications = unread.body.notifications.filter(notification => notification.artifactId === published.artifactId)
    const [newest] = readingNotifications

    const markOne = await readerApp.request(`/api/notifications/${newest?.notificationId}/read`, { method: 'POST', cookie: authorCookie })
    const afterOne = await readerApp.json<NotificationList>('/api/notifications', { cookie: authorCookie })
    const othersMark = await readerApp.request(`/api/notifications/${readingNotifications[1]?.notificationId}/read`, { method: 'POST', cookie: reviewerCookie })
    const markAll = await readerApp.request('/api/notifications/read-all', { method: 'POST', cookie: authorCookie })
    const afterAll = await readerApp.json<NotificationList>('/api/notifications', { cookie: authorCookie })

    expect(unread.body.unreadCount).toBeGreaterThanOrEqual(3)
    expect(readingNotifications.map(notification => notification.commentId)).toEqual([...commentIds].reverse())
    expect(markOne.status).toBe(204)
    expect(afterOne.body.unreadCount).toBe(unread.body.unreadCount - 1)
    expect(afterOne.body.notifications.find(notification => notification.notificationId === newest?.notificationId)).toMatchObject({ notificationId: newest?.notificationId, read: true })
    expect(othersMark.status).toBe(404)
    expect(markAll.status).toBe(204)
    expect(afterAll.body.unreadCount).toBe(0)
    expect(afterAll.body.notifications.every(notification => notification.read)).toBe(true)
  })

  it('hides notifications about an artifact the recipient can no longer open', async () => {
    const published = await app.publish({ token: linAgentToken }, 'Gone private')
    await comment(zhouCookie, published.artifactId, { body: '好', forAgent: false })
    await comment(linCookie, published.artifactId, { body: '谢谢', parentId: (await notificationsAbout(linCookie, published.artifactId))[0]?.commentId })

    await app.request(`/api/artifacts/${published.artifactId}/sharing`, { method: 'PUT', cookie: linCookie, body: { visibility: 'private' } })

    expect(await notificationsAbout(zhouCookie, published.artifactId)).toEqual([])
  })

  it('needs a signed-in person', async () => {
    const response = await app.request('/api/notifications')

    expect(response.status).toBe(401)
  })
})
