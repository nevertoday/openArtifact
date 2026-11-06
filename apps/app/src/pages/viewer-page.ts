import { ArtifactRemoval } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

// No allow-same-origin: the artifact gets an opaque origin and cannot reach any site's cookies or storage.
const ARTIFACT_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'

export interface OlderVersion {
  version: number
  authorName: string
  publishedAt: number
}

export interface ViewerModel {
  openedArtifact: OpenedArtifact
  identity: Identity | null
  authorName: string
  /** The version on screen; older than the current one when the viewer picked it from the history. */
  shownVersion: number
  /** The shown version when it is older than the current one; null on the current version. */
  olderVersion: OlderVersion | null
  /** Absolute URL of the shown version's entry page, signed for this viewer. */
  artifactUrl: string
  usercontentOrigin: string
  now: number
}

export class ViewerPage {
  static render(model: ViewerModel): Response {
    const { summary, permissions } = model.openedArtifact
    const body = html`<div class="viewer-page">
${PageShell.topBar(model.identity, ViewerPage.#heading(model))}
<div class="viewer-body">
  <section class="viewer-stage" aria-label="artifact 内容">
    ${model.olderVersion ? ViewerPage.#olderVersionBanner(model, model.olderVersion) : ''}
    <div class="viewer-sandbox-note xxd-text" data-variant="caption">
      <span class="xxd-cluster">${PageShell.icon('Lock', 14)}在沙箱中运行 · <span class="xxd-mono">${new URL(model.usercontentOrigin).host}</span></span>
      <a class="xxd-link" href="${ViewerPage.#pathOf(model, '/full')}" target="_blank" rel="noopener">新标签页打开</a>
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
${PageShell.jsonData('viewer-config', ViewerPage.#viewerConfig(model))}`
    return PageShell.render({
      title: `${summary.title} · Open Artifact`,
      description: ViewerPage.#description(model),
      body,
      scripts: ['common.js', 'viewer.js'],
      frameOrigin: model.usercontentOrigin,
    })
  }

  /** The artifact alone, filling the tab; the page still proxies its shared data. */
  static renderFull(model: ViewerModel): Response {
    const { summary } = model.openedArtifact
    const body = html`<div class="viewer-full">
<header class="viewer-full__bar">
  <a class="xxd-btn" data-variant="ghost" data-size="sm" href="${ViewerPage.#pathOf(model, '')}">${PageShell.icon('ArrowLeft')}评论和版本</a>
  <span class="viewer-full__title">${summary.title}</span>
  <span class="xxd-text xxd-mono" data-variant="caption">v${model.shownVersion}</span>
</header>
<div class="viewer-full__frame"><iframe id="artifact-frame" src="${model.artifactUrl}" title="${summary.title}" sandbox="${ARTIFACT_SANDBOX}" referrerpolicy="no-referrer"></iframe></div>
</div>
${PageShell.jsonData('viewer-config', ViewerPage.#viewerConfig(model))}`
    return PageShell.render({
      title: `${summary.title} · Open Artifact`,
      description: ViewerPage.#description(model),
      body,
      scripts: ['artifact-full.js'],
      frameOrigin: model.usercontentOrigin,
    })
  }

  // An older version keeps its number, so a link from it shows the same version.
  static #pathOf(model: ViewerModel, suffix: '' | '/full'): string {
    const { summary } = model.openedArtifact
    const versionQuery = model.shownVersion === summary.version ? '' : `?v=${model.shownVersion}`
    return `/a/${encodeURIComponent(summary.artifactId)}${suffix}${versionQuery}`
  }

  static #viewerConfig(model: ViewerModel) {
    const { summary, permissions } = model.openedArtifact
    return {
      artifactId: summary.artifactId,
      title: summary.title,
      shownVersion: model.shownVersion,
      currentVersion: summary.version,
      usercontentOrigin: model.usercontentOrigin,
      permissions: {
        canComment: permissions.canComment,
        canEdit: permissions.canEdit,
        canManageSharing: permissions.canManageSharing,
        canRename: permissions.canRename,
        canRemove: permissions.canRemove,
      },
      removalTakesDown: ViewerPage.#removalTakesDown(model),
      viewer: model.identity ? { userId: model.identity.userId, name: model.identity.name } : null,
    }
  }

  static #description(model: ViewerModel): string {
    const { summary } = model.openedArtifact
    return `${model.authorName} 发布 · v${summary.version} · ${ArtifactLabels.publishedVia(summary.publishedVia)}`
  }

  static #heading(model: ViewerModel): SafeHtml {
    const { summary, permissions } = model.openedArtifact
    return html`<a class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" href="/" aria-label="返回列表">${PageShell.icon('ArrowLeft')}</a>
<div class="xxd-topbar__title viewer-heading">
  <span class="viewer-heading__title">${summary.title}</span>
  <span class="viewer-heading__meta xxd-text" data-variant="caption">${model.authorName} · ${ArtifactLabels.publishedVia(summary.publishedVia)} 发布 · ${ArtifactLabels.updatedAgo(summary.updatedAt, model.now)}更新</span>
</div>
<span class="xxd-badge viewer-visibility" data-visibility-pill>${ArtifactLabels.visibility(summary.sharing.visibility)}</span>
${permissions.canManageSharing ? html`<button type="button" class="xxd-btn" data-variant="primary" data-size="sm" data-open-share>${PageShell.icon('Share2')}分享</button>` : ''}
${ViewerPage.#artifactMenu(model)}`
  }

  static #removalTakesDown(model: ViewerModel): boolean {
    const viewerId = model.identity?.userId
    return viewerId !== undefined && ArtifactRemoval.isTakedown(viewerId, model.openedArtifact.summary.authorId)
  }

  static #artifactMenu(model: ViewerModel): SafeHtml | string {
    const { canRename, canRemove } = model.openedArtifact.permissions
    if (!canRename && !canRemove) return ''
    const renameItem = html`<button type="button" class="xxd-menu__item" role="menuitem" data-rename-artifact>${PageShell.icon('Pen', 14)}重命名</button>`
    const removeItem = html`<button type="button" class="xxd-menu__item" role="menuitem" data-tone="danger" data-remove-artifact>${PageShell.icon('Trash2', 14)}${ArtifactLabels.removal(ViewerPage.#removalTakesDown(model))}</button>`
    const separator = html`<div class="xxd-menu__sep" role="separator"></div>`
    return html`<button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" data-xxd-menu="artifact-menu" data-artifact-menu aria-label="更多操作">${PageShell.icon('Ellipsis')}</button>
<div class="xxd-menu" id="artifact-menu" role="menu" popover>
  ${canRename ? renameItem : ''}${canRename && canRemove ? separator : ''}${canRemove ? removeItem : ''}
</div>`
  }

  static #olderVersionBanner(model: ViewerModel, olderVersion: OlderVersion): SafeHtml {
    const { summary, permissions } = model.openedArtifact
    const publishedAgo = ArtifactLabels.updatedAgo(olderVersion.publishedAt, model.now)
    const overwriteButton = html`<button type="button" class="xxd-btn" data-size="sm" data-overwrite-with-version="${olderVersion.version}">用 v${olderVersion.version} 覆盖当前</button>`
    return html`<div class="xxd-banner" data-size="sm" role="status">
  ${PageShell.icon('History')}
  <p class="xxd-banner__text">你在看 <strong class="xxd-mono">v${olderVersion.version}</strong>（${publishedAgo}，${olderVersion.authorName} 发布），最新是 <span class="xxd-mono">v${summary.version}</span>。</p>
  <div class="xxd-banner__actions">
    <a class="xxd-link" href="/a/${encodeURIComponent(summary.artifactId)}">看最新版</a>
    ${permissions.canEdit ? overwriteButton : ''}
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
