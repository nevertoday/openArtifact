import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { SHARED_DATA_BUDGETS } from '../src/api/publish-limits.ts'
import { SHARED_DATA_ALERT_SHARE, warnWhenSharedDataNearlyFull } from '../src/shared-data-alert.ts'
import { RecordingMailer, TestApp } from './test-app.ts'

const app = new TestApp()
const operator = { MAILER: 'console', ABUSE_REPORT_EMAIL: 'ops@example.com' }

async function deploymentUsesShare(share: number): Promise<void> {
  await env.DB.prepare('UPDATE deployment_shared_usage SET bytes = ? WHERE id = 1').bind(Math.floor(SHARED_DATA_BUDGETS.deploymentBytes * share)).run()
}

describe('the daily warning about shared data filling the deployment', () => {
  it('mails the operator once shared data passes 80% of the deployment budget', async () => {
    const mailer = new RecordingMailer()
    await deploymentUsesShare(0.85)

    await warnWhenSharedDataNearlyFull(app.repositories, operator, () => mailer)

    expect(mailer.lastTo('ops@example.com')?.subject).toBe('Shared data is at 85% of the deployment\'s budget')
  })

  it('stays quiet below 80%', async () => {
    const mailer = new RecordingMailer()
    await deploymentUsesShare(SHARED_DATA_ALERT_SHARE - 0.01)

    await warnWhenSharedDataNearlyFull(app.repositories, operator, () => mailer)

    expect(mailer.sent).toEqual([])
  })

  it('makes no mailer when no operator mailbox is set, so a missing mail setup cannot fail the cron', async () => {
    await deploymentUsesShare(0.95)
    let mailersMade = 0

    await warnWhenSharedDataNearlyFull(app.repositories, {}, () => {
      mailersMade++
      return new RecordingMailer()
    })

    expect(mailersMade).toBe(0)
  })
})
