import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { CloudflareOutboundMailLog } from '../src/index.ts'

const HOUR_MS = 60 * 60 * 1000
const mailLog = new CloudflareOutboundMailLog(env.DB)

describe('CloudflareOutboundMailLog', () => {
  it('counts only mailings of the same kind and scope inside the window', async () => {
    const now = Date.now()
    const daily = { max: 10, since: now - 24 * HOUR_MS }
    const mailing = { kind: 'invite' as const, senderId: 'user-a', workspaceId: 'workspace-a', sentAt: now }

    const yesterday = await mailLog.record({ ...mailing, count: 10, sentAt: now - 25 * HOUR_MS }, { scope: 'workspace', ...daily, since: now - 49 * HOUR_MS })
    const today = await mailLog.record({ ...mailing, count: 8 }, { scope: 'workspace', ...daily })
    const overflow = await mailLog.record({ ...mailing, count: 3 }, { scope: 'workspace', ...daily })
    const otherWorkspace = await mailLog.record({ ...mailing, workspaceId: 'workspace-b', count: 10 }, { scope: 'workspace', ...daily })
    const shareBySameSender = await mailLog.record({ ...mailing, kind: 'share', count: 10 }, { scope: 'sender', ...daily })
    const fillingUp = await mailLog.record({ ...mailing, count: 2 }, { scope: 'workspace', ...daily })

    expect([yesterday, today, overflow, otherWorkspace, shareBySameSender, fillingUp]).toEqual([true, true, false, true, true, true])
  })
})
