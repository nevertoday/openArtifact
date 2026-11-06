import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

// No allow-same-origin: the artifact gets an opaque origin and cannot reach any site's cookies or storage.
const ARTIFACT_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'

export interface ViewerModel {
  openedArtifact: OpenedArtifact
  identity: Identity | null
  authorName: string
  /** The version on screen; older than the current one when the viewer picked it from the history. */
  shownVersion: number
  /** Absolute URL of the shown version's entry page, signed for this viewer. */
  artifactUrl: string
  usercontentOrigin: string
  now: number
}

export class ViewerPage {
  static render(model: ViewerModel): Response {
    const { summary, permissions } = model.openedArtifact
    const isOldVersion = model.shownVersion !== summary.version
    const viewerConfig = {
      artifactId: summary.artifactId,
      title: summary.title,
      shownVersion: model.shownVersion,
      currentVersion: summary.version,
      usercontentOrigin: model.usercontentOrigin,
      permissions: { canComment: permissions.canComment, canEdit: permissions.canEdit, canManageSharing: permissions.canManageSharing },
      viewer: model.identity ? { userId: model.identity.userId, name: model.identity.name } : null,
    }
    const body = html`<div class="viewer-page">
${PageShell.topBar(model.identity, ViewerPage.#heading(model))}
<div class="viewer-body">
  <section class="viewer-stage" aria-label="artifact 内容">
    ${isOldVersion ? ViewerPage.#oldVersionBanner(model.shownVersion, summary.version, permissions.canEdit) : ''}
    <div class="viewer-sandbox-note xxd-text" data-variant="caption">
      <span class="xxd-cluster">${PageShell.icon('Lock', 14)}在沙箱中运行 · <span class="xxd-mono">${new URL(model.usercontentOrigin).host}</span></span>
      <a class="xxd-link" href="${model.artifactUrl}" target="_blank" rel="noopener noreferrer">新标签页打开</a>
    </div>
    <div class="viewer-frame"><iframe id="artifact-frame" src="${model.artifactUrl}" title="${summary.title}" sandbox="${ARTIFACT_SANDBOX}" referrerpolicy="no-referrer"></iframe></div>
  </section>
  <aside class="viewer-side" aria-label="评论、版本和数据">
    <div class="xxd-tabs viewer-side__tabs" data-xxd-tabs id="viewer-tabs" aria-label="评论、版本和数据">
      <button type="button" role="tab" id="tab-comments" aria-controls="panel-comments" aria-selected="true">评论<span class="xxd-count" data-comment-count></span></button>
      <button type="button" role="tab" id="tab-versions" aria-controls="panel-versions" aria-selected="false">版本<span class="xxd-count xxd-mono">${summary.version}</span></button>
      <button type="button" role="tab" id="tab-data" aria-controls="panel-data" aria-selected="false">数据</button>
    </div>
    <div class="viewer-side__panel" id="panel-comments"><p class="viewer-side__status"><span class="xxd-spinner" aria-hidden="true"></span>正在加载评论…</p></div>
    <div class="viewer-side__panel" id="panel-versions" hidden></div>
    <div class="viewer-side__panel" id="panel-data" hidden></div>
  </aside>
</div>
</div>
${permissions.canManageSharing ? ViewerPage.#shareDialog() : ''}
${PageShell.jsonData('viewer-config', viewerConfig)}`
    return PageShell.render({
      title: `${summary.title} · Open Artifact`,
      description: `${model.authorName} 发布 · v${summary.version} · ${ArtifactLabels.publishedVia(summary.publishedVia)}`,
      body,
      scripts: ['common.js', 'viewer.js'],
      frameOrigin: model.usercontentOrigin,
    })
  }

  static #heading(model: ViewerModel): SafeHtml {
    const { summary, permissions } = model.openedArtifact
    return html`<a class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" href="/" aria-label="返回列表">${PageShell.icon('ArrowLeft')}</a>
<div class="xxd-topbar__title viewer-heading">
  <span class="viewer-heading__title">${summary.title}</span>
  <span class="viewer-heading__meta xxd-text" data-variant="caption">${model.authorName} · ${ArtifactLabels.publishedVia(summary.publishedVia)} 发布 · ${ArtifactLabels.updatedAgo(summary.updatedAt, model.now)}更新</span>
</div>
<span class="xxd-badge viewer-visibility" data-visibility-pill>${ArtifactLabels.visibility(summary.sharing.visibility)}</span>
${permissions.canManageSharing ? html`<button type="button" class="xxd-btn" data-variant="primary" data-size="sm" data-open-share>${PageShell.icon('Share2')}分享</button>` : ''}`
  }

  static #oldVersionBanner(shownVersion: number, currentVersion: number, canEdit: boolean): SafeHtml {
    return html`<div class="xxd-banner" data-size="sm" role="status">
  ${PageShell.icon('History')}
  <p class="xxd-banner__text">你在看 <strong class="xxd-mono">v${shownVersion}</strong>，当前版本是 <span class="xxd-mono">v${currentVersion}</span>。</p>
  <div class="xxd-banner__actions">
    ${canEdit ? html`<button type="button" class="xxd-btn" data-size="sm" data-restore-version="${shownVersion}">恢复为当前版本</button>` : ''}
    <a class="xxd-btn" data-size="sm" href="?">回到当前版本</a>
  </div>
</div>`
  }

  static #shareDialog(): SafeHtml {
    return html`<dialog class="xxd-dialog" data-size="lg" id="share-dialog" aria-labelledby="share-title">
  <form method="dialog" id="share-form">
    <div class="xxd-dialog__head">
      <div class="xxd-text-pair share-dialog__heading"><h2 class="xxd-dialog__title" id="share-title">分享</h2><p class="xxd-text" data-variant="caption" data-share-subtitle></p></div>
      <button type="submit" value="close" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="关闭">${PageShell.icon('X')}</button>
    </div>
    <div class="xxd-dialog__body share-dialog__body" data-share-body><p class="viewer-side__status"><span class="xxd-spinner" aria-hidden="true"></span>正在加载…</p></div>
    <div class="xxd-dialog__actions">
      <span class="xxd-text share-dialog__url" data-variant="mono-secondary" data-share-url></span>
      <button type="button" class="xxd-btn" data-copy-link data-copy-done="链接已复制">${PageShell.icon('Copy', 14)}复制链接</button>
      <button type="button" class="xxd-btn" data-variant="primary" data-save-sharing>保存</button>
    </div>
  </form>
</dialog>`
  }
}
