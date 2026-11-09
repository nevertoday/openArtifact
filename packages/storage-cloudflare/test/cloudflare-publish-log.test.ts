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

    expect(beforeWindow).toBe(true)
    expect(racing.filter(Boolean)).toHaveLength(5)
    expect(someoneElse).toBe(true)
  })
})
