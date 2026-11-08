import type { OutboundMailKind, OutboundMailLog, MailQuotaScope } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/** Invites go out in a workspace's name, so the workspace shares one cap; share mail is capped per person sharing. */
const DAILY_QUOTAS: Record<OutboundMailKind, { scope: MailQuotaScope; max: number; refusal: string }> = {
  invite: { scope: 'workspace', max: 100, refusal: 'this workspace may send at most 100 invite emails a day; nothing was sent. Try again tomorrow, or share an invite link' },
  share: { scope: 'sender', max: 50, refusal: 'you may email at most 50 people outside the workspace a day by sharing; nothing was saved. Try again tomorrow' },
}

/** Caps mail to addresses people type, so an account cannot be used to spam strangers. */
export class MailLimits {
  readonly #log: OutboundMailLog

  constructor(log: OutboundMailLog) {
    this.#log = log
  }

  static dailyMax(kind: OutboundMailKind): number {
    return DAILY_QUOTAS[kind].max
  }

  /** Takes `count` mails from today's quota before any is sent; refuses the whole request when they do not all fit. */
  async take(kind: OutboundMailKind, sender: { senderId: string; workspaceId: string }, count: number, now: number): Promise<void> {
    if (count === 0) return
    const { scope, max, refusal } = DAILY_QUOTAS[kind]
    const recorded = await this.#log.record({ kind, ...sender, count, sentAt: now }, { scope, max, since: now - DAY_MS })
    if (!recorded) throw new HttpError(429, 'mail_limit_reached', refusal)
  }
}
