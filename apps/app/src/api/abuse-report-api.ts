import { ABUSE_REASONS, ArtifactPath, type AbuseReason, type ArtifactSummary, type SigningKey } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_DETAILS_LENGTH = 1000
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Enough for the operator to see a page is being reported, few enough that reports cannot flood their inbox. */
const REPORTS_PER_ARTIFACT_PER_DAY = 20
const DAY_MS = 24 * 60 * 60 * 1000

const REASON_WORDS: Record<AbuseReason, string> = {
  spam: 'spam',
  phishing_or_malware: 'phishing or malware',
  illegal: 'illegal content',
  other: 'other',
}

/** What the app needs to take abuse reports, fixed for the deployment. */
export interface AbuseReporting {
  /** Where reports are mailed; null stores them only. */
  mailbox: string | null
  /** Reports sent from one network address. */
  senderLimiter: RateLimit
  /** Keys the stored hash of the sender's address, so it cannot be reversed by hashing every address. */
  addressKey: SigningKey
}

/** Anyone viewing a public link may report the page to the operator, signed in or not. */
export class AbuseReportApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async report(request: Request, artifactId: string): Promise<Response> {
    const senderAddress = request.headers.get('CF-Connecting-IP')
    await this.#ensureSenderAllowed(senderAddress)
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
        ipHash: senderAddress === null ? null : await this.#context.abuseReporting.addressKey.sign(`abuse-report-sender:${senderAddress}`),
        createdAt: now,
      },
      { max: REPORTS_PER_ARTIFACT_PER_DAY, since: now - DAY_MS },
    )
    if (reportId === null) throw new HttpError(429, 'rate_limited', `this page was reported ${REPORTS_PER_ARTIFACT_PER_DAY} times in the last day already; the operator has been told`)
    await this.#tellOperator(summary, { reportId, reason, details, reporterEmail, signedIn: identity !== null })
    return Response.json({ reportId }, { status: 201 })
  }

  // Cloudflare always names the sender; a request without it comes from local development or tests.
  async #ensureSenderAllowed(senderAddress: string | null): Promise<void> {
    if (senderAddress === null) return
    const { success } = await this.#context.abuseReporting.senderLimiter.limit({ key: senderAddress })
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
      console.warn(`Abuse report ${report.reportId} on ${summary.shortId} was stored but not mailed: ABUSE_REPORT_EMAIL is not set`)
      return
    }
    const pageUrl = `${this.#context.appOrigin}${ArtifactPath.of(summary)}`
    const text = [
      'Someone reported a public page on Open Artifact.',
      '',
      `Page:     ${pageUrl}`,
      `Title:    ${summary.title}`,
      `Reason:   ${REASON_WORDS[report.reason]}`,
      `Details:  ${report.details ?? '(none)'}`,
      `Reply to: ${report.reporterEmail ?? '(no address given)'}${report.signedIn ? ', signed in' : ', not signed in'}`,
      `Report:   ${report.reportId}`,
      '',
      'To take it down for everyone, so that its author cannot restore it, run from a checkout of this deployment:',
      `  pnpm takedown ${summary.shortId}`,
    ].join('\n')
    try {
      await this.#context.mailer.send({ to: mailbox, subject: `Abuse report (${REASON_WORDS[report.reason]}): ${pageUrl}`, text })
    } catch (error) {
      console.error(`Abuse report ${report.reportId} on ${summary.shortId} was stored but the mail to the operator failed`, error)
    }
  }
}
