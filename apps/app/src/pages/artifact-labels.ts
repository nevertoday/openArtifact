import type { Messages } from '../i18n/messages.ts'
import type { ArtifactSharing, ArtifactVisibility, WorkspaceRole } from '@open-artifact/core'
import { dateText, relativeTimeText } from '../../public/static/time-text.js'

const VISIBILITY_LABELS: Record<ArtifactVisibility, string> = {
  private: '私有',
  specified: '指定的人',
  workspace: 'workspace 内可见',
  public_link: '公开链接',
}

const WEB_PAGE_LABEL = '网页'

const ROLE_LABELS: Record<WorkspaceRole, string> = { admin: '管理员', member: '成员' }

const DAY = 24 * 60 * 60 * 1000

/** Wording shared by every page that shows an artifact. */
export class ArtifactLabels {
  static visibility(visibility: ArtifactVisibility): string {
    return VISIBILITY_LABELS[visibility]
  }

  /** Every visibility's label, for page scripts that word visibility themselves; they get it in their page JSON. */
  static visibilityLabels(): Record<ArtifactVisibility, string> {
    return { ...VISIBILITY_LABELS }
  }

  /** The visibility as a badge says it: a public link also says whether it needs a password and when it ends. */
  static sharingBadge(sharing: ArtifactSharing, now: number): string {
    const label = VISIBILITY_LABELS[sharing.visibility]
    if (sharing.visibility !== 'public_link') return label
    const expiresAt = sharing.publicLinkExpiresAt
    const expiry = expiresAt === null ? null : expiresAt > now ? `${dateText(expiresAt)} 过期` : '已过期'
    return [label, sharing.publicLinkPasswordHash === null ? null : '有密码', expiry].filter(part => part !== null).join(' · ')
  }

  /** 下架 is an admin removing someone else's artifact; 删除 is the author removing their own. */
  static removal(removedAsAdmin: boolean): string {
    return removedAsAdmin ? '下架' : '删除'
  }

  static purgeIn(purgeAt: number, now: number): string {
    const daysLeft = Math.max(1, Math.ceil((purgeAt - now) / DAY))
    return `${daysLeft} 天后彻底删除`
  }

  static role(role: WorkspaceRole): string {
    return ROLE_LABELS[role]
  }

  static publishedVia(publishedVia: string | null): string {
    return publishedVia ?? WEB_PAGE_LABEL
  }

  /** 「devin 用 Claude Code 发布」 or 「devin 在网页上发布」. */
  static publishedBy(authorName: string, publishedVia: string | null): string {
    return publishedVia === null ? `${authorName} 在${WEB_PAGE_LABEL}上发布` : `${authorName} 用 ${publishedVia} 发布`
  }

  /** Prefer PageShell.relativeTime, which also carries the full time on hover. */
  static updatedAgo(m: Messages, updatedAt: number, now: number): string {
    return relativeTimeText(m.time, updatedAt, now)
  }
}
