export const ABUSE_REASONS = ['spam', 'phishing_or_malware', 'illegal', 'other'] as const
export type AbuseReason = (typeof ABUSE_REASONS)[number]

/** Someone viewing a public link says the page is abusive; the operator decides whether to take it down. */
export interface NewAbuseReport {
  artifactId: string
  shortId: string
  reason: AbuseReason
  details: string | null
  /** An address the reporter gave for a reply; null when they gave none. */
  reporterEmail: string | null
  /** null when the reporter was not signed in. */
  reporterId: string | null
  /** A keyed hash of the sender's network address, never the address; null when the request named none. */
  ipHash: string | null
  createdAt: number
}

export interface AbuseReports {
  /**
   * Stores the report when its artifact has fewer than `cap.max` reports after `cap.since` (epoch ms), and returns
   * its id; null, and nothing stored, when it has that many already. Concurrent reports cannot both take the last place.
   */
  record(report: NewAbuseReport, cap: { max: number; since: number }): Promise<string | null>
  /**
   * Marks the report mailed to the operator when fewer than `cap.max` reports, across every page, were mailed after
   * `cap.since`; false, and nothing marked, when that many were. Concurrent calls cannot both take the last place.
   */
  claimMail(reportId: string, mailedAt: number, cap: { max: number; since: number }): Promise<boolean>
  /** Gives the place back, for a mail that could not be sent. */
  releaseMail(reportId: string): Promise<void>
  /** Reports stored after `since` that the operator was not mailed. */
  countUnmailedSince(since: number): Promise<number>
}
