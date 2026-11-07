import type { ArtifactVisibility, WorkspaceRole } from '@open-artifact/core'
import { relativeTimeText } from '../../public/static/time-text.js'

const VISIBILITY_LABELS: Record<ArtifactVisibility, string> = {
  private: '私有',
  specified: '指定的人',
  workspace: '整个 workspace',
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

  /** Prefer PageShell.relativeTime, which also carries the full time on hover. */
  static updatedAgo(updatedAt: number, now: number): string {
    return relativeTimeText(updatedAt, now)
  }
}
