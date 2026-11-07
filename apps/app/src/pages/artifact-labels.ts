import type { Messages } from '../i18n/messages.ts'
import type { ArtifactSharing, ArtifactVisibility, WorkspaceRole } from '@open-artifact/core'
import { dateText, relativeTimeText } from '../../public/static/time-text.js'

const DAY = 24 * 60 * 60 * 1000

/** Wording shared by every page that shows an artifact. */
export class ArtifactLabels {
  static visibility(m: Messages, visibility: ArtifactVisibility): string {
    return m.labels.visibility[visibility]
  }

  /** Every visibility's label, for page scripts that word visibility themselves; they get it in their page JSON. */
  static visibilityLabels(m: Messages): Record<ArtifactVisibility, string> {
    return { ...m.labels.visibility }
  }

  /** The visibility as a badge says it: a public link also says whether it needs a password and when it ends. */
  static sharingBadge(m: Messages, sharing: ArtifactSharing, now: number): string {
    const label = m.labels.visibility[sharing.visibility]
    if (sharing.visibility !== 'public_link') return label
    const expiresAt = sharing.publicLinkExpiresAt
    const expiry = expiresAt === null ? null : expiresAt > now ? m.labels.expiresOn(dateText(expiresAt)) : m.labels.expired
    return [label, sharing.publicLinkPasswordHash === null ? null : m.labels.hasPassword, expiry].filter(part => part !== null).join(' · ')
  }

  /** 下架 is an admin removing someone else's artifact; 删除 is the author removing their own. */
  static removal(m: Messages, removedAsAdmin: boolean): string {
    return removedAsAdmin ? m.labels.removal.takeDown : m.labels.removal.remove
  }

  /** 「devin 删除」 or 「devin 下架」, said of an artifact already removed. */
  static removedBy(m: Messages, name: string, removedAsAdmin: boolean): string {
    return removedAsAdmin ? m.labels.removedBy.takeDown(name) : m.labels.removedBy.remove(name)
  }

  static purgeIn(m: Messages, purgeAt: number, now: number): string {
    const daysLeft = Math.max(1, Math.ceil((purgeAt - now) / DAY))
    return m.labels.purgeIn(daysLeft)
  }

  static role(m: Messages, role: WorkspaceRole): string {
    return m.labels.roles[role]
  }

  static publishedVia(m: Messages, publishedVia: string | null): string {
    return publishedVia ?? m.labels.webPage
  }

  /** 「devin 用 Claude Code 发布」 or 「devin 在网页上发布」. */
  static publishedBy(m: Messages, authorName: string, publishedVia: string | null): string {
    return publishedVia === null ? m.labels.publishedOnWeb(authorName) : m.labels.publishedWith({ author: authorName, via: publishedVia })
  }

  /** Prefer PageShell.relativeTime, which also carries the full time on hover. */
  static updatedAgo(m: Messages, updatedAt: number, now: number): string {
    return relativeTimeText(m.time, updatedAt, now)
  }
}
