import type { Repositories } from '@open-artifact/core'
import { Mailers, type Mailer } from './auth/mailer.ts'
import { operatorMailbox, type ReportMailEnv } from './api/abuse-report-api.ts'
import { SHARED_DATA_BUDGETS } from './api/publish-limits.ts'

/** Past this share of the deployment's shared-data budget, the daily cron warns the operator. */
export const SHARED_DATA_ALERT_SHARE = 0.8

/**
 * For the daily cron: when the deployment's shared data passes 80% of its budget, one mail to the operator, since at
 * 100% every page's shared-data writes are refused at once. The mailer is made here, so a mail service set up wrong
 * fails this job alone.
 */
export async function warnWhenSharedDataNearlyFull(repositories: Repositories, env: ReportMailEnv, mailerFor: (env: ReportMailEnv) => Mailer = Mailers.fromEnv): Promise<void> {
  const usedBytes = await repositories.sharedData.deploymentBytes()
  if (usedBytes < SHARED_DATA_BUDGETS.deploymentBytes * SHARED_DATA_ALERT_SHARE) return
  const percent = Math.floor((usedBytes / SHARED_DATA_BUDGETS.deploymentBytes) * 100)
  const mailbox = operatorMailbox(env)
  if (mailbox === null) {
    console.warn(`Shared data is at ${percent}% of the deployment's budget, and no operator mailbox is set to warn`)
    return
  }
  const text = [
    `Shared data across this deployment is at ${percent}% of its ${SHARED_DATA_BUDGETS.deploymentBytes / 1024 ** 3} GB budget. At 100%, every page's shared-data writes are refused.`,
    '',
    'To see which workspaces hold the most, run in apps/app of a checkout of this deployment:',
    '  npx wrangler d1 execute open-artifact --remote --config wrangler.production.jsonc --command "SELECT workspace_id, bytes FROM workspace_shared_usage ORDER BY bytes DESC LIMIT 20"',
  ].join('\n')
  await mailerFor(env).send({ to: mailbox, subject: `Shared data is at ${percent}% of the deployment's budget`, text })
}
