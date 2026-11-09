import { ABUSE_REASONS, ArtifactPath, type AbuseReason, type ArtifactSummary, type Repositories, type SigningKey } from '@open-artifact/core'
import { Mailers, type Mailer, type MailerEnv } from '../auth/mailer.ts'
import type { AppEnv } from '../env.ts'
import { HttpError } from '../http-error.ts'
import { SenderNetwork } from '../sender-network.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_DETAILS_LENGTH = 1000
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Enough for the operator to see a page is being reported, few enough that reports cannot flood their inbox. */
const REPORTS_PER_ARTIFACT_PER_DAY = 20
/** Report mail to the operator in any 24 hours, across every page; the reports past it are stored and counted in the daily digest. */
export const REPORT_MAILS_PER_DAY = 50
const DAY_MS = 24 * 60 * 60 * 1000
// Every way text can start a new line in a mail reader, so a reporter's words cannot pass for a line of ours.
const LINE_BREAKS = /\r\n|[\r\n\v\f\u0085\u2028\u2029]/

const REASON_WORDS: Record<AbuseReason, string> = {
  spam: 'spam',
  phishing_or_malware: 'phishing or malware',
  illegal: 'illegal content',
  other: 'other',
}

export type ReportMailEnv = MailerEnv & Pick<AppEnv, 'ABUSE_REPORT_EMAIL'>

/**
 * Where the deployment mails abuse reports; null, so reports are only stored, when ABUSE_REPORT_EMAIL is not set or
 * no mail service is (MAILER).
 */
export function operatorMailbox(env: ReportMailEnv): string | null {
  if (env.MAILER === undefined) return null
  return env.ABUSE_REPORT_EMAIL?.trim() || null
}

/** What the app needs to take abuse reports, fixed for the deployment. */
export interface AbuseReporting {
  /** Where reports are mailed; null stores them only. */
  mailbox: string | null
  /** Reports sent from one sender network (see SenderNetwork). */
  senderLimiter: RateLimit
  /** Keys the stored hash of the sender's network, so it cannot be reversed by hashing every address. */
  addressKey: SigningKey
}

/** Anyone viewing a public link may report the page to the operator, signed in or not. */
export class AbuseReportApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async report(request: Request, artifactId: string): Promise<Response> {
    const senderNetwork = SenderNetwork.of(request)
    await this.#ensureSenderAllowed(senderNetwork)
    const identity = await this.#context.identity()
    const { summary } = await this.#context.gate.require(artifactId, identity, request, 'canView', 'report this artifact')
    // Pages inside a workspace are its admins' business; only pages strangers can open reach the operator.
    if (summary.sharing.visibility !== 'public_link') throw HttpError.notFound(`artifact ${artifactId}`)
    const requestBody = await JsonBody.of(request)
    const reason = requestBody.oneOf('reason', ABUSE_REASONS)
    const details = requestBody.optionalText('details', MAX_DETAILS_LENGTH)
    const reporterEmail = AbuseReportApi.#emailFrom(requestBody)
    const now = Date.now()
    const reportId = await this.#context.repositories.abuseReports.record(
      {
        artifactId: summary.artifactId,
        shortId: summary.shortId,
        reason,
        details,
        reporterEmail,
        reporterId: identity?.userId ?? null,
        ipHash: senderNetwork === null ? null : await this.#context.abuseReporting.addressKey.sign(`abuse-report-sender:${senderNetwork}`),
        createdAt: now,
      },
      { max: REPORTS_PER_ARTIFACT_PER_DAY, since: now - DAY_MS },
    )
    if (reportId === null) throw new HttpError(429, 'rate_limited', `this page was reported ${REPORTS_PER_ARTIFACT_PER_DAY} times in the last day already; the operator has been told`)
    await this.#tellOperator(summary, { reportId, reason, details, reporterEmail, signedIn: identity !== null })
    return Response.json({ reportId }, { status: 201 })
  }

  async #ensureSenderAllowed(senderNetwork: string | null): Promise<void> {
    if (senderNetwork === null) return
    const { success } = await this.#context.abuseReporting.senderLimiter.limit({ key: senderNetwork })
    if (!success) throw new HttpError(429, 'rate_limited', 'too many reports from this network; wait a minute and try again')
  }

  static #emailFrom(requestBody: JsonBody): string | null {
    const email = requestBody.optionalText('contactEmail', MAX_EMAIL_LENGTH)
    if (email === null) return null
    if (!EMAIL_PATTERN.test(email)) throw HttpError.fieldInvalid('contactEmail', 'contactEmail must be an email address, or left out')
    return email
  }

  // The report is stored whatever happens to the mail, so a mail failure is logged, not shown to the reporter.
  async #tellOperator(summary: ArtifactSummary, report: { reportId: string; reason: AbuseReason; details: string | null; reporterEmail: string | null; signedIn: boolean }): Promise<void> {
    const { mailbox } = this.#context.abuseReporting
    if (mailbox === null) {
      console.warn(`Abuse report ${report.reportId} on ${summary.shortId} was stored but not mailed: ABUSE_REPORT_EMAIL or MAILER is not set`)
      return
    }
    const now = Date.now()
    const reports = this.#context.repositories.abuseReports
    if (!(await reports.claimMail(report.reportId, now, { max: REPORT_MAILS_PER_DAY, since: now - DAY_MS }))) {
      console.warn(`Abuse report ${report.reportId} on ${summary.shortId} was stored but not mailed: ${REPORT_MAILS_PER_DAY} reports were mailed in the last day; the daily digest counts it`)
      return
    }
    const pageUrl = `${this.#context.appOrigin}${ArtifactPath.of(summary)}`
    // The command comes first and everything the author or the reporter wrote last, on lines of its own, so neither
    // can put a takedown line of their choosing where the operator would copy one.
    const text = [
      'To take this page down for everyone, so that its author cannot restore it, run from a checkout of this deployment:',
      `  pnpm takedown ${summary.shortId}`,
      '',
      'Someone reported a public page on Open Artifact.',
      '',
      `Page:     ${pageUrl}`,
      `Reason:   ${REASON_WORDS[report.reason]}`,
      `Reply to: ${report.reporterEmail ?? '(no address given)'}${report.signedIn ? ', signed in' : ', not signed in'}`,
      `Report:   ${report.reportId}`,
      `Title:    ${summary.title.split(LINE_BREAKS).join(' ')}`,
      '',
      ...(report.details === null ? ['Details:  (none)'] : ['Details, as the reporter wrote them:', ...report.details.split(LINE_BREAKS).map(line => `> ${line}`)]),
    ].join('\n')
    try {
      await this.#context.mailer.send({ to: mailbox, subject: `Abuse report (${REASON_WORDS[report.reason]}): ${pageUrl}`, text })
    } catch (error) {
      await reports.releaseMail(report.reportId)
      console.error(`Abuse report ${report.reportId} on ${summary.shortId} was stored but the mail to the operator failed`, error)
    }
  }
}

/**
 * For the daily cron: one mail telling the operator how many reports of the last day were stored without mail, when
 * any were. The mailer is made here, so a mail service set up wrong fails this job alone, not the purge beside it.
 */
export async function mailUnmailedReportDigest(repositories: Repositories, env: ReportMailEnv, now: number, mailerFor: (env: ReportMailEnv) => Mailer = Mailers.fromEnv): Promise<void> {
  const mailbox = operatorMailbox(env)
  if (mailbox === null) {
    if (env.ABUSE_REPORT_EMAIL?.trim()) console.warn('The daily digest of abuse reports stored without mail was skipped: ABUSE_REPORT_EMAIL is set but MAILER is not')
    return
  }
  const unmailed = await repositories.abuseReports.countUnmailedSince(now - DAY_MS)
  if (unmailed === 0) return
  const mailer = mailerFor(env)
  const text = [
    `${unmailed} abuse ${unmailed === 1 ? 'report was' : 'reports were'} stored without mail in the last day, past the ${REPORT_MAILS_PER_DAY} reports a day that are mailed one by one; see abuse_reports.`,
    '',
    'They are the rows whose mailed_at is NULL. To list them, run in apps/app of a checkout of this deployment:',
    `  npx wrangler d1 execute open-artifact --remote --config wrangler.production.jsonc --command "SELECT short_id, reason, COUNT(*) FROM abuse_reports WHERE mailed_at IS NULL AND created_at > ${now - DAY_MS} GROUP BY short_id, reason ORDER BY 3 DESC"`,
  ].join('\n')
  await mailer.send({ to: mailbox, subject: `${unmailed} abuse ${unmailed === 1 ? 'report' : 'reports'} stored without mail in the last day`, text })
}
