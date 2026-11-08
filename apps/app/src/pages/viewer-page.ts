import type { Messages } from '../i18n/messages.ts'
import { ArtifactPath, ArtifactRemoval } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, SafeHtml } from './html.ts'
import { PageShell, type IconName } from './page-shell.ts'
import type { ShareCard } from '../share/share-card.ts'

// No allow-same-origin: the artifact gets an opaque origin and cannot reach any site's cookies or storage.
const ARTIFACT_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'

export interface OlderVersion {
  version: number
  authorName: string
  publishedAt: number
}

/** Under an artifact listed on its author's personal page, for the strangers who read it there. */
export interface Byline {
  authorName: string
  personalPagePath: string
  /** What the link carries on X; its url is where search engines and share cards should send people. */
  share: ShareCard
  /** The next piece on the author's page; null when this is the only one. */
  next: { path: string; title: string } | null
}

export interface ViewerModel {
  m: Messages
  openedArtifact: OpenedArtifact
  identity: Identity | null
  authorName: string
  /** Shown to a visitor of a listed artifact; null otherwise. */
  byline: Byline | null
  /** The version on screen; older than the current one when the viewer picked it from the history. */
  shownVersion: number
  /** A version the address asked for that does not exist; the latest one is shown instead. */
  missingVersion: number | null
  /** The shown version when it is older than the current one; null on the current version. */
  olderVersion: OlderVersion | null
  /** Absolute URL of the shown version's entry page, signed for this viewer. */
  artifactUrl: string
  usercontentOrigin: string
  now: number
}

/**
 * The artifact first: a slim bar above it, comments written on the page itself, and a drawer for the
 * threads that pushes the page aside on a wide screen and rises from the bottom on a phone. The page's
 * scripts fill in what changes while it is open: threads, versions, pins and the comment composer.
 */
export class ViewerPage {
  static render(model: ViewerModel): Response {
    const { summary, permissions } = model.openedArtifact
    const body = html`<div class="viewer" data-viewer>
${ViewerPage.#bar(model)}
<div class="viewer-notice" data-version-notice></div>
${permissions.canSeeVersions ? ViewerPage.#compareBar(model.m) : ''}
<div class="viewer-body">
  <section class="viewer-stage" id="main" tabindex="-1" aria-label="${model.m.viewer.stageLabel}" data-stage>
    <iframe id="artifact-frame" src="${model.artifactUrl}" title="${summary.title}" sandbox="${ARTIFACT_SANDBOX}" referrerpolicy="no-referrer"></iframe>
    ${permissions.canComment ? ViewerPage.#commentingLayer(model.m) : ''}
  </section>
  ${ViewerPage.#drawer(model)}
</div>
${model.byline ? ViewerPage.#byline(model, model.byline) : ''}
${permissions.canComment ? ViewerPage.#coachMark(model.m) : ''}
</div>
${permissions.canManageSharing ? ViewerPage.#shareDialog(model.m) : ''}
${ViewerPage.#shortcutSheet(model)}
${PageShell.jsonData('viewer-config', ViewerPage.#viewerConfig(model))}`
    return PageShell.render({
      m: model.m,
      title: `${summary.title} · Open Artifact`,
      description: ViewerPage.#description(model),
      body,
      scripts: ['common.js', 'viewer/viewer.js'],
      styles: ['viewer.css'],
      frameOrigin: model.usercontentOrigin,
      ...(model.byline ? { publicCard: { url: model.byline.share.url, kind: 'article' as const, image: { url: model.byline.share.imageUrl, alt: summary.title } } } : {}),
    })
  }

  static #byline(model: ViewerModel, byline: Byline): SafeHtml {
    const { summary } = model.openedArtifact
    return html`<footer class="viewer-byline">
  <a class="viewer-byline__avatar" href="${byline.personalPagePath}" aria-label="${model.m.viewer.byline.authorPage(byline.authorName)}">${PageShell.initialOf(byline.authorName)}</a>
  <p class="viewer-byline__who"><a href="${byline.personalPagePath}">${byline.authorName}</a><span>${model.m.viewer.byline.updated({ version: summary.version, time: PageShell.relativeTime(model.m, summary.currentVersionAt, model.now) })}</span></p>
  ${byline.next ? html`<p class="viewer-byline__next"><span>${model.m.viewer.byline.next}</span><a href="${byline.next.path}">${byline.next.title} ${PageShell.icon('ArrowRight', 14)}</a></p>` : html`<p class="viewer-byline__next"><a href="${byline.personalPagePath}">${model.m.viewer.byline.more} ${PageShell.icon('ArrowRight', 14)}</a></p>`}
</footer>`
  }

  /** The artifact alone, filling the tab; the page still proxies its shared data. */
  static renderFull(model: ViewerModel): Response {
    const { summary } = model.openedArtifact
    const body = html`<div class="viewer-full">
<header class="viewer-full__bar">
  <a class="xxd-btn" data-variant="ghost" data-size="sm" href="${ViewerPage.#pathOf(model, 'viewer')}">${PageShell.icon('ArrowLeft')}${model.m.viewer.full.back}</a>
  <span class="viewer-full__title" tabindex="0" data-tooltip="${summary.title}" data-tooltip-placement="bottom-start">${summary.title}</span>
  <span class="xxd-text xxd-mono" data-variant="caption">v${model.shownVersion}</span>
</header>
<div class="viewer-full__frame"><iframe id="artifact-frame" src="${model.artifactUrl}" title="${summary.title}" sandbox="${ARTIFACT_SANDBOX}" referrerpolicy="no-referrer"></iframe></div>
</div>
${PageShell.jsonData('viewer-config', ViewerPage.#viewerConfig(model))}`
    return PageShell.render({
      m: model.m,
      title: `${summary.title} · Open Artifact`,
      description: ViewerPage.#description(model),
      body,
      scripts: ['artifact-full.js'],
      styles: ['viewer.css'],
      frameOrigin: model.usercontentOrigin,
    })
  }

  // An older version keeps its number, so a link from it shows the same version.
  static #pathOf(model: ViewerModel, page: 'viewer' | 'full'): string {
    const { summary } = model.openedArtifact
    const versionQuery = model.shownVersion === summary.version ? '' : `?v=${model.shownVersion}`
    return `${ArtifactPath.of(summary, page)}${versionQuery}`
  }

  static #viewerConfig(model: ViewerModel) {
    const { summary, permissions } = model.openedArtifact
    return {
      artifactId: summary.artifactId,
      path: ArtifactPath.of(summary),
      fullViewPath: ArtifactPath.of(summary, 'full'),
      title: summary.title,
      shownVersion: model.shownVersion,
      currentVersion: summary.version,
      missingVersion: model.missingVersion,
      olderVersion: model.olderVersion,
      usercontentOrigin: model.usercontentOrigin,
      visibility: summary.sharing.visibility,
      visibilityLabels: ArtifactLabels.visibilityLabels(model.m),
      permissions: {
        canComment: permissions.canComment,
        canEdit: permissions.canEdit,
        canManageSharing: permissions.canManageSharing,
        canRename: permissions.canRename,
        canRemove: permissions.canRemove,
        canReadComments: permissions.canReadComments,
        canSeeVersions: permissions.canSeeVersions,
        canBrowseSharedData: permissions.canBrowseSharedData,
      },
      removalTakesDown: ViewerPage.#removalTakesDown(model),
      viewer: model.identity ? { userId: model.identity.userId, name: model.identity.name } : null,
    }
  }

  static #description(model: ViewerModel): string {
    const { summary } = model.openedArtifact
    if (model.byline && summary.summary) return summary.summary
    return model.m.viewer.description({ author: model.authorName, version: summary.version, via: ArtifactLabels.publishedVia(model.m, summary.publishedVia) })
  }

  // Someone who reaches the artifact only through its public link sees the page, not the people who work on it:
  // no history, no data overview, no way into the workspace.
  static isPublicLinkVisitor(openedArtifact: OpenedArtifact): boolean {
    return !openedArtifact.permissions.canSeeVersions
  }

  static #bar(model: ViewerModel): SafeHtml {
    const { summary, permissions } = model.openedArtifact
    const isVisitor = ViewerPage.isPublicLinkVisitor(model.openedArtifact)
    const homeLink = html`<a class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" href="/" aria-label="${model.m.viewer.bar.home}" data-tooltip="${model.m.viewer.bar.home}" data-tooltip-placement="bottom-start">${PageShell.icon('House')}</a>`
    return html`<header class="xxd-topbar viewer-bar">
  ${isVisitor ? '' : homeLink}
  <div class="viewer-bar__title">
    <span class="viewer-bar__name" tabindex="0" data-tooltip="${summary.title}" data-tooltip-placement="bottom-start" data-artifact-title>${summary.title}</span>
    ${permissions.canSeeVersions ? ViewerPage.#versionPicker(model) : ''}
  </div>
  <div class="viewer-bar__end">
    ${isVisitor ? '' : ViewerPage.#visibilityBadge(model)}
    ${permissions.canReadComments ? ViewerPage.#commentCountButton(model.m) : ''}
    ${permissions.canComment ? html`<button type="button" class="xxd-btn viewer-comment-mode" data-variant="ghost" data-size="sm" aria-pressed="false" aria-keyshortcuts="C" data-tooltip="${model.m.viewer.bar.commentModeTooltip}" data-comment-mode>${PageShell.icon('Plus')}<span class="viewer-bar__label">${model.m.viewer.bar.comment}</span></button>` : ''}
    ${permissions.canManageSharing ? html`<button type="button" class="xxd-btn" data-variant="primary" data-size="sm" data-open-share>${model.m.viewer.bar.share}</button>` : ''}
    ${isVisitor ? '' : ViewerPage.#moreMenu(model)}
    ${model.identity ? PageShell.accountControls(model.m, model.identity) : ViewerPage.#signInLink(model)}
  </div>
</header>`
  }

  static #versionPicker(model: ViewerModel): SafeHtml {
    return html`<button type="button" class="xxd-btn viewer-version" data-variant="ghost" data-size="sm" data-xxd-menu="version-menu" aria-label="${model.m.viewer.version.picker(model.shownVersion)}" data-version-button><span data-version-label>v${model.shownVersion}</span>${PageShell.icon('ChevronDown', 14)}</button>
<div class="xxd-menu viewer-version-menu" id="version-menu" role="menu" popover aria-label="${model.m.viewer.version.menu}" data-version-menu></div>`
  }

  // Whoever manages sharing opens the share dialog from the badge; everyone else reads it as a fact.
  static #visibilityBadge(model: ViewerModel): SafeHtml {
    const { summary, permissions } = model.openedArtifact
    const label = ArtifactLabels.visibility(model.m, summary.sharing.visibility)
    if (permissions.canManageSharing) return html`<button type="button" class="xxd-badge viewer-visibility" data-tooltip="${model.m.viewer.visibility.tooltipManage}" data-open-share data-visibility-label>${label}</button>`
    return html`<span class="xxd-badge viewer-visibility" tabindex="0" data-tooltip="${model.m.viewer.visibility.tooltip}" data-visibility-label>${label}</span>`
  }

  static #commentCountButton(m: Messages): SafeHtml {
    return html`<button type="button" class="xxd-btn viewer-count-button" data-variant="ghost" data-size="sm" aria-expanded="false" aria-controls="viewer-drawer" aria-label="${m.viewer.bar.comments}" data-comment-count-button>${PageShell.icon('MessageSquare')}<span class="viewer-count" data-comment-count></span></button>`
  }

  static #signInLink(model: ViewerModel): SafeHtml {
    const loginPath = `/login?next=${encodeURIComponent(ViewerPage.#pathOf(model, 'viewer'))}`
    return html`<a class="xxd-link viewer-sign-in" href="${loginPath}">${model.m.viewer.bar.signInToComment}</a>`
  }

  static #removalTakesDown(model: ViewerModel): boolean {
    const viewerId = model.identity?.userId
    return viewerId !== undefined && ArtifactRemoval.isTakedown(viewerId, model.openedArtifact.summary.authorId)
  }

  static #moreMenu(model: ViewerModel): SafeHtml {
    const { summary, permissions } = model.openedArtifact
    const menuItem = (icon: IconName, label: string, marker: string) =>
      html`<button type="button" class="xxd-menu__item" role="menuitem" ${new SafeHtml(marker)}>${PageShell.icon(icon, 14)}${label}</button>`
    const separator = html`<div class="xxd-menu__sep" role="separator"></div>`
    const removeItem = html`${separator}<button type="button" class="xxd-menu__item" role="menuitem" data-tone="danger" data-remove-artifact>${PageShell.icon('Trash2', 14)}${ArtifactLabels.removal(model.m, ViewerPage.#removalTakesDown(model))}</button>`
    return html`<button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" data-xxd-menu="artifact-menu" aria-label="${model.m.viewer.more.label}" data-tooltip="${model.m.viewer.more.label}">${PageShell.icon('Ellipsis')}</button>
<div class="xxd-menu viewer-more-menu" id="artifact-menu" role="menu" popover aria-label="${model.m.viewer.more.label}">
  <a class="xxd-menu__item" role="menuitem" href="${ViewerPage.#pathOf(model, 'full')}" target="_blank" rel="noopener" data-full-view-link>${PageShell.icon('ExternalLink', 14)}${model.m.viewer.more.openInNewTab}</a>
  ${permissions.canBrowseSharedData ? menuItem('Database', model.m.viewer.more.data, 'data-open-data') : ''}
  ${permissions.canRename ? menuItem('Pen', model.m.viewer.more.rename, 'data-rename-artifact') : ''}
  ${menuItem('Link', model.m.viewer.more.copyLink, 'data-copy-artifact-link')}
  ${permissions.canRemove ? removeItem : ''}
  ${separator}
  <div class="xxd-menu__label viewer-more-menu__visibility">${model.m.viewer.more.visibleTo}<span data-visibility-label>${ArtifactLabels.visibility(model.m, summary.sharing.visibility)}</span></div>
  <div class="xxd-menu__label viewer-more-menu__note">${PageShell.icon('ShieldCheck', 14)}${model.m.viewer.more.isolation}</div>
</div>`
  }

  static #compareBar(m: Messages): SafeHtml {
    return html`<div class="viewer-compare" role="region" aria-label="${m.viewer.compare.label}" data-compare-bar hidden>
  <b class="viewer-compare__title" data-compare-title></b>
  <div class="viewer-compare__legend" data-compare-legend></div>
  <div class="viewer-compare__end">
    <button type="button" class="xxd-btn" data-variant="ghost" data-size="sm" data-compare-previous>${m.viewer.compare.previous}</button>
    <button type="button" class="xxd-btn" data-variant="ghost" data-size="sm" data-compare-next>${m.viewer.compare.next}</button>
    <button type="button" class="xxd-btn" data-size="sm" data-compare-exit>${m.viewer.compare.exit}</button>
  </div>
</div>`
  }

  // The mode hint and the composer float over the artifact; both are drawn here once and shown by the page script.
  static #commentingLayer(m: Messages): SafeHtml {
    return html`<div class="viewer-mode-hint" data-mode-hint hidden><span role="status" data-mode-hint-text></span><kbd class="xxd-kbd">Esc</kbd><button type="button" class="xxd-btn" data-variant="ghost" data-size="xs" data-exit-comment-mode>${m.viewer.composer.exitCommentMode}</button></div>
<form class="viewer-composer" role="dialog" aria-label="${m.viewer.composer.label}" aria-describedby="composer-quote" data-composer hidden>
  <div class="viewer-composer__head"><b data-composer-label></b><span class="xxd-mono" data-composer-version></span></div>
  <p class="viewer-composer__quote" id="composer-quote" data-composer-quote></p>
  <textarea class="xxd-textarea" name="body" rows="3" placeholder="${m.viewer.composer.placeholder}" aria-label="${m.viewer.composer.bodyLabel}" required data-error-required="${m.viewer.composer.bodyRequired}"></textarea>
  <p class="viewer-composer__agent-note" data-agent-note hidden>${m.viewer.composer.agentNote}</p>
  <div class="viewer-composer__row">
    <label class="xxd-choice"><input type="checkbox" role="switch" class="xxd-switch" data-size="sm" name="forAgent">${m.viewer.composer.forAgent}</label>
    <span class="viewer-shortcut" aria-hidden="true"><kbd class="xxd-kbd" data-modifier-key>⌘</kbd><kbd class="xxd-kbd">↵</kbd></span>
    <button type="button" class="xxd-btn ui-dialog-cancel" data-size="sm" data-cancel-composer>${m.viewer.composer.cancel}</button>
    <button type="submit" class="xxd-btn" data-variant="primary" data-size="sm">${m.viewer.composer.send}</button>
  </div>
</form>`
  }

  static #coachMark(m: Messages): SafeHtml {
    return html`<div class="viewer-coach" role="note" data-coach hidden><span data-coach-text></span><button type="button" class="xxd-btn" data-variant="ghost" data-size="xs" data-dismiss-coach>${m.viewer.coach.dismiss}</button></div>`
  }

  static #drawer(model: ViewerModel): SafeHtml | '' {
    const { canReadComments, canBrowseSharedData } = model.openedArtifact.permissions
    const { m } = model
    if (!canReadComments && !canBrowseSharedData) return ''
    const commentsView = html`<div class="viewer-drawer__view" data-drawer-view="comments">
    <div class="viewer-drawer__filters" data-comment-filters></div>
    <div class="viewer-drawer__cue" data-new-comments></div>
    <div class="viewer-drawer__threads" data-comment-threads tabindex="-1"><p class="viewer-drawer__status"><span class="xxd-spinner" aria-hidden="true"></span>${m.viewer.drawer.loading}</p></div>
    <p class="viewer-drawer__foot" data-drawer-foot hidden></p>
    <div class="xxd-sr-only" role="status" data-comment-status></div>
  </div>`
    return html`<aside class="viewer-drawer" id="viewer-drawer" aria-labelledby="viewer-drawer-title" data-drawer hidden>
  <button type="button" class="viewer-drawer__handle" aria-label="${m.viewer.drawer.handle}" data-drawer-handle></button>
  <div class="viewer-drawer__head">
    <h2 class="viewer-drawer__title" id="viewer-drawer-title" tabindex="-1" data-drawer-title>${m.viewer.drawer.title}</h2>
    <button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="${m.viewer.drawer.close}" data-close-drawer>${PageShell.icon('X')}</button>
  </div>
  ${canReadComments ? commentsView : ''}
  ${canBrowseSharedData ? html`<div class="viewer-drawer__view viewer-data" data-drawer-view="data" hidden></div>` : ''}
</aside>`
  }

  static #shortcutSheet(model: ViewerModel): SafeHtml {
    const { canComment, canReadComments } = model.openedArtifact.permissions
    const { shortcuts } = model.m.viewer
    const shortcut = (keys: SafeHtml, meaning: string) => html`<dt>${keys}</dt><dd>${meaning}</dd>`
    const key = (name: string) => html`<kbd class="xxd-kbd">${name}</kbd>`
    return html`<dialog class="xxd-dialog viewer-keys" data-size="sm" id="shortcut-sheet" aria-labelledby="shortcut-sheet-title" data-shortcut-sheet>
  <div class="xxd-dialog__head"><h2 class="xxd-dialog__title" id="shortcut-sheet-title">${shortcuts.title}</h2></div>
  <div class="xxd-dialog__body"><dl class="viewer-keys__list">
    ${canComment ? shortcut(key('C'), shortcuts.commentMode) : ''}
    ${canReadComments ? html`${shortcut(key('J'), shortcuts.nextComment)}${shortcut(key('K'), shortcuts.previousComment)}` : ''}
    ${canComment ? shortcut(html`<kbd class="xxd-kbd" data-modifier-key>⌘</kbd>${key('↵')}`, shortcuts.send) : ''}
    ${shortcut(key('Esc'), shortcuts.escape)}
    ${shortcut(key('?'), shortcuts.help)}
  </dl></div>
  <div class="xxd-dialog__actions"><button type="button" class="xxd-btn ui-dialog-cancel" data-xxd-dialog-close>${shortcuts.close}</button></div>
</dialog>`
  }

  static #shareDialog(m: Messages): SafeHtml {
    return html`<dialog class="xxd-dialog" data-size="lg" id="share-dialog" aria-labelledby="share-title">
  <form id="share-form">
    <div class="xxd-dialog__head">
      <div class="xxd-text-pair share-dialog__heading"><h2 class="xxd-dialog__title" id="share-title">${m.viewer.share.title}</h2><p class="xxd-text" data-variant="caption" data-share-subtitle></p></div>
      <button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="${m.viewer.share.close}" data-close-share>${PageShell.icon('X')}</button>
    </div>
    <div class="xxd-dialog__body share-dialog__body" data-share-body><p class="viewer-drawer__status"><span class="xxd-spinner" aria-hidden="true"></span>${m.viewer.share.loading}</p></div>
    <div class="xxd-dialog__actions">
      <span class="xxd-text share-dialog__url" data-variant="mono-secondary" data-share-url></span>
      <button type="button" class="xxd-btn" data-copy-link data-copy-done="${m.viewer.share.linkCopied}">${PageShell.icon('Copy', 14)}${m.viewer.share.copyLink}</button>
      <button type="submit" class="xxd-btn" data-variant="primary" data-save-sharing disabled>${m.viewer.share.save}</button>
    </div>
  </form>
</dialog>`
  }
}
