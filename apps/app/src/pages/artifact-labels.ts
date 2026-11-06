import type { ArtifactVisibility, WorkspaceRole } from '@open-artifact/core'

const VISIBILITY_LABELS: Record<ArtifactVisibility, string> = {
  private: '私有',
  specified: '指定的人',
  workspace: 'Workspace 内可见',
  public_link: '公开链接',
}

const WEB_PAGE_LABEL = '网页'

const ROLE_LABELS: Record<WorkspaceRole, string> = { admin: '管理员', member: '成员' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

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

  static updatedAgo(updatedAt: number, now: number): string {
    const elapsed = Math.max(0, now - updatedAt)
    if (elapsed < MINUTE) return '刚刚'
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`
    if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`
    if (elapsed < 2 * DAY) return '昨天'
    if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} 天前`
    return new Date(updatedAt).toISOString().slice(0, 10)
  }
}
