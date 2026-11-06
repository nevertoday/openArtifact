import type { ArtifactVisibility } from '@open-artifact/core'

const VISIBILITY_LABELS: Record<ArtifactVisibility, string> = {
  private: '私有',
  specified: '指定的人',
  workspace: 'Workspace 内可见',
  public_link: '公开链接',
}

const WEB_PAGE_LABEL = '网页'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Wording shared by every page that shows an artifact. */
export class ArtifactLabels {
  static visibility(visibility: ArtifactVisibility): string {
    return VISIBILITY_LABELS[visibility]
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
