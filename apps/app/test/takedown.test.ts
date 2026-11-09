import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { shortIdOf, takedownSql } from '../../../scripts/takedown-sql.mjs'
import { TestApp } from './test-app.ts'

const app = new TestApp()

/** Runs what `pnpm takedown --dry-run` prints, as `wrangler d1 execute --command` would. */
async function runTakedown(shortId: string, now = Date.now()): Promise<void> {
  const statements = takedownSql(shortId, now)
    .split(/;\s*$/m)
    .filter(statement => statement.trim() !== '')
  await env.DB.batch(statements.map(statement => env.DB.prepare(statement)))
}

async function personalPublisher(name: string): Promise<{ cookie: string; workspaceId: string }> {
  const cookie = await app.signInAlone(`${name}@example.com`)
  const { body } = await app.json<{ workspace: { workspaceId: string; personalOf: string | null }; user: { userId: string } }>('/api/me', { cookie })
  expect(body.workspace.personalOf).toBe(body.user.userId)
  return { cookie, workspaceId: body.workspace.workspaceId }
}

describe('pnpm takedown', () => {
  it('finds the short id in a link, an address segment or the id itself, and nothing in anything else', () => {
    expect(shortIdOf('https://artifact.example.com/a/bank-login-k7f3q9x2m4ab')).toBe('k7f3q9x2m4ab')
    expect(shortIdOf('https://artifact.example.com/a/k7f3q9x2m4ab/full')).toBe('k7f3q9x2m4ab')
    expect(shortIdOf('bank-login-K7F3Q9X2M4AB')).toBe('k7f3q9x2m4ab')
    expect(shortIdOf("k7f3q9x2m4ab'; DROP TABLE artifacts; --")).toBeNull()
    expect(shortIdOf('https://artifact.example.com/settings')).toBeNull()
    expect(() => takedownSql("x'; --", 1)).toThrow()
  })

  it('takes a public page down for everyone, and its author cannot restore it though they admin their personal workspace', async () => {
    const author = await personalPublisher('phisher')
    const page = await app.publish({ cookie: author.cookie }, 'Bank login', '<h1>password?</h1>', 'public_link')
    const shortId = shortIdOf(page.url) ?? ''

    await runTakedown(shortId)
    const visitor = await app.request(page.path)
    const restore = await app.request(`/api/artifacts/${page.artifactId}/restore`, { method: 'POST', cookie: author.cookie })
    const restorable = await app.json<{ artifacts: { artifactId: string }[] }>('/api/artifacts?removed=true', { cookie: author.cookie })
    const summary = await app.repositories.artifacts.findSummary(page.artifactId)
    const settings = await (await app.request('/settings/workspace', { cookie: author.cookie })).text()
    const audit = await app.repositories.auditLog.listLatest(author.workspaceId, 10)

    expect(visitor.status).not.toBe(200)
    expect(await visitor.text()).not.toContain('password?')
    expect(restore.status).toBe(404)
    expect(restorable.body.artifacts.map(artifact => artifact.artifactId)).not.toContain(page.artifactId)
    expect(summary?.removal).toMatchObject({ removedBy: 'operator', removedAsAdmin: true })
    expect(settings).toContain('Open Artifact 运营方')
    expect(audit[0]).toMatchObject({ actorId: 'operator', action: 'artifact.removed', targetId: page.artifactId })
  })

  it('keeps the removal time of a page its author removed first, so its purge date does not move', async () => {
    const author = await personalPublisher('quick-remover')
    const page = await app.publish({ cookie: author.cookie }, 'Removed first', '<h1>x</h1>', 'public_link')
    await app.request(`/api/artifacts/${page.artifactId}`, { method: 'DELETE', cookie: author.cookie })
    const removedAt = (await app.repositories.artifacts.findSummary(page.artifactId))?.removal?.removedAt

    await runTakedown(shortIdOf(page.url) ?? '', Date.now() + 60_000)
    await runTakedown(shortIdOf(page.url) ?? '', Date.now() + 120_000)
    const removal = (await app.repositories.artifacts.findSummary(page.artifactId))?.removal

    expect(removal?.removedAt).toBe(removedAt)
    expect(removal?.byOperator).toBe(true)
  })
})
