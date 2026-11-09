import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { CloudflarePublishLog } from '../src/index.ts'

const publishLog = new CloudflarePublishLog(env.DB)

describe('CloudflarePublishLog', () => {
  it('lets concurrent publishes take no more places than the cap, and counts only the window and the person', async () => {
    const now = Date.now()
    const quota = { max: 5, since: now - 1000 }

    const beforeWindow = await publishLog.record('person-a', now - 2000, { max: 5, since: now - 5000 })
    const racing = await Promise.all(Array.from({ length: 12 }, () => publishLog.record('person-a', now, quota)))
    const someoneElse = await publishLog.record('person-b', now, quota)

    expect(beforeWindow).not.toBeNull()
    expect(racing.filter(entryId => entryId !== null)).toHaveLength(5)
    expect(someoneElse).not.toBeNull()
  })

  it('gives a released place back to the person', async () => {
    const now = Date.now()
    const quota = { max: 1, since: now - 1000 }

    const taken = await publishLog.record('person-c', now, quota)
    const whileTaken = await publishLog.record('person-c', now, quota)
    await publishLog.release(taken ?? -1)
    const afterRelease = await publishLog.record('person-c', now, quota)

    expect(taken).not.toBeNull()
    expect(whileTaken).toBeNull()
    expect(afterRelease).not.toBeNull()
  })
})
