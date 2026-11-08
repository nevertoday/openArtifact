/** Mail the app sends on a person's behalf to addresses they typed, which a stranger could use to spam. */
export type OutboundMailKind = 'invite' | 'share'

export interface OutboundMailing {
  kind: OutboundMailKind
  senderId: string
  workspaceId: string
  /** How many messages this one request sends. */
  count: number
  sentAt: number
}

/** Which mailings share a cap: every sender in one workspace, or one sender wherever they share from. */
export type MailQuotaScope = 'workspace' | 'sender'

export interface MailQuota {
  scope: MailQuotaScope
  max: number
  /** Only mailings after this time (epoch ms) count. */
  since: number
}

/** Mail sent per kind, so a cap can be checked and taken in one step that concurrent requests cannot both pass. */
export interface OutboundMailLog {
  /** Records the mailing when it keeps its scope's total of that kind within `quota.max`; false, and nothing recorded, when it would not. */
  record(mailing: OutboundMailing, quota: MailQuota): Promise<boolean>
}
