import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { CloudflareAbuseReports } from '../src/index.ts'

const abuseReports = new CloudflareAbuseReports(env.DB)

describe('CloudflareAbuseReports', () => {
  it('lets concurrent reports claim no more mail than the cap across every page, and counts the rest as unmailed', async () => {
    const now = Date.now()
    const reportIds = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        abuseReports.record(
          { artifactId: `artifact-${index % 3}`, shortId: 'abcdefabcdef', reason: 'spam', details: null, reporterEmail: null, reporterId: null, ipHash: null, createdAt: now },
          { max: 100, since: now - 1000 },
        ),
      ),
    )

    const claims = await Promise.all(reportIds.map(reportId => abuseReports.claimMail(reportId ?? '', now, { max: 5, since: now - 1000 })))
    const unmailed = await abuseReports.countUnmailedSince(now - 1000)
    const claimedReport = reportIds[claims.indexOf(true)] ?? ''
    await abuseReports.releaseMail(claimedReport)

    expect(claims.filter(Boolean)).toHaveLength(5)
    expect(unmailed).toBe(7)
    expect(await abuseReports.countUnmailedSince(now - 1000)).toBe(8)
  })
})
