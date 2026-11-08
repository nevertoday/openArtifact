import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
let cookie = ''
let agentToken = ''

beforeAll(async () => {
  cookie = await app.signIn('share@example.com')
  agentToken = await app.createToken(cookie, 'full', 'Claude Code · share')
})

interface ShareJson {
  readiness: { kind: string; at?: number }
  url: string
  imageUrl: string
  savedText: string | null
  x: { text: string; weightedLength: number; intentUrl: string }
}

const page = (summary: string) => `<html><head><meta name="description" content="${summary}"></head><body><main><p>${summary}</p></main></body></html>`

async function publishByAgent(body: Record<string, unknown>) {
  return app.json<{ artifactId: string; url: string; share: ShareJson; code?: string; error?: string }>('/api/artifacts', {
    method: 'POST',
    token: agentToken,
    agentClient: 'Claude Code',
    body: { files: [{ path: 'index.html', content: page('以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。') }], ...body },
  })
}

describe('sharing an artifact on X', () => {
  it('gives an agent a post ready to open on X when it publishes a listed page', async () => {
    const published = await publishByAgent({ title: 'Claude Code 命令：入门到精通', visibility: 'public_link', listed: true })
    const intent = new URL(published.body.share.x.intentUrl)

    expect(published.status).toBe(201)
    expect(published.body.share.readiness).toEqual({ kind: 'ready' })
    expect(published.body.share.url).toBe(published.body.url)
    expect(published.body.share.imageUrl).toBe(`${published.body.url}/card.png?v=1.1`)
    expect(intent.origin + intent.pathname).toBe('https://x.com/intent/post')
    expect(intent.searchParams.get('url')).toBe(published.body.url)
    expect(intent.searchParams.get('text')).toBe('Claude Code 命令：入门到精通\n\n以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。')
    // Title 28, blank line 2, summary 77, then a space and the link at 23.
    expect(published.body.share.x.weightedLength).toBe(131)
  })

  it('tells an agent why a link cannot go out yet', async () => {
    const workspaceOnly = await publishByAgent({ title: '内部周报' })
    const unlisted = await publishByAgent({ title: '临时链接', visibility: 'public_link' })

    expect(workspaceOnly.body.share.readiness).toEqual({ kind: 'not_public' })
    expect(unlisted.body.share.readiness).toEqual({ kind: 'not_listed' })
  })

  it('keeps words an agent or author wrote, and refuses words that do not fit in a post', async () => {
    const written = await publishByAgent({ title: '短文', visibility: 'public_link', listed: true, shareText: '一句话说清这篇讲什么' })
    const tooLong = await publishByAgent({ title: '太长', shareText: '字'.repeat(130) })
    const artifactPath = `/api/artifacts/${written.body.artifactId}`
    const rewritten = await app.json<{ share: ShareJson }>(artifactPath, { method: 'PATCH', cookie, body: { shareText: '换一种说法' } })
    const cleared = await app.json<{ share: ShareJson }>(artifactPath, { method: 'PATCH', cookie, body: { shareText: null } })
    const updated = await app.json<{ share: ShareJson }>(artifactPath, { method: 'PUT', token: agentToken, body: { baseVersion: 1, files: [{ path: 'index.html', content: page('新版') }], shareText: '第二版的一句话' } })

    expect(written.body.share.x.text).toBe('一句话说清这篇讲什么')
    expect(written.body.share.savedText).toBe('一句话说清这篇讲什么')
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.code).toBe('share_text_too_long')
    expect(tooLong.body.error).toContain('weighs 284')
    expect(rewritten.body.share.x.text).toBe('换一种说法')
    expect(cleared.body.share.savedText).toBeNull()
    expect(cleared.body.share.x.text).toBe('短文\n\n以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。')
    expect(updated.body.share.x.text).toBe('第二版的一句话')
    expect(updated.body.share.imageUrl).toMatch(/\/card\.png\?v=2\.1$/)
  })

  it('shows the author in the share dialog whether the link may go out, and why not', async () => {
    const published = await publishByAgent({ title: '要分享的文章', visibility: 'public_link', listed: true, publicLinkExpiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000 })
    const sharingPath = `/api/artifacts/${published.body.artifactId}/sharing`

    const expiring = await app.json<{ share: ShareJson }>(sharingPath, { cookie })
    const fixed = await app.json<{ share: ShareJson }>(sharingPath, { method: 'PUT', cookie, body: { visibility: 'public_link', listed: true, publicLinkExpiresAt: null, publicLinkPassword: null } })
    const withPassword = await app.json<{ share: ShareJson }>(sharingPath, { method: 'PUT', cookie, body: { listed: false, publicLinkPassword: 'secret-123' } })

    expect(expiring.body.share.readiness.kind).toBe('expires')
    expect(fixed.body.share.readiness).toEqual({ kind: 'ready' })
    expect(withPassword.body.share.readiness).toEqual({ kind: 'has_password' })
  })
})
