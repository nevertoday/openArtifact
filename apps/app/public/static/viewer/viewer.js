import { element, m, readJsonData, userMessageOf } from '../common.js'
import { AgentHandoff } from './agent-handoff.js'
import { SharedDataProxy } from '../shared-data-proxy.js'
import { ArtifactFrame } from './artifact-frame.js'
import { CoachMark, CommentMode, Composer, MODIFIER_KEY, writesByTouch } from './comment-mode.js'
import { CommentList } from './comment-list.js'
import { CommentPins } from './comment-pins.js'
import { CommentThreads } from './comment-threads.js'
import { DataView } from './data-view.js'
import { LiveUpdates } from './live-updates.js'
import { ReportDialog } from './report-dialog.js'
import { ShareDialog } from './share-dialog.js'
import { ShareXPanel } from './share-x-panel.js'
import { ViewerTopBar } from './top-bar.js'
import { VersionCompare, VersionHistory, VersionOverwrite } from './versions.js'
import { ViewerDrawer } from './viewer-drawer.js'
import { ViewerKeys } from './viewer-keys.js'

// Wires the viewer's parts to each other; each part owns its own state and markup.
const COACH_DELAY_MS = 900

const config = readJsonData('viewer-config')
const { permissions } = config
const viewer = document.querySelector('[data-viewer]')
const stage = viewer.querySelector('[data-stage]')
const frame = new ArtifactFrame(document.getElementById('artifact-frame'), { version: config.shownVersion, sharedData: new SharedDataProxy(config) })
for (const modifierKey of document.querySelectorAll('[data-modifier-key]')) modifierKey.textContent = MODIFIER_KEY

const drawerElement = viewer.querySelector('[data-drawer]')
const countButton = viewer.querySelector('[data-comment-count-button]')
const drawer = drawerElement ? new ViewerDrawer(viewer, drawerElement, countButton) : null
const dataElement = viewer.querySelector('[data-drawer-view="data"]')
const dataView = dataElement ? new DataView(dataElement, config.artifactId) : null

const topBar = new ViewerTopBar({
  bar: viewer.querySelector('.viewer-bar'),
  config,
  stage,
  openData: () => {
    drawer.open('data', { focusTitle: true })
    dataView.show()
  },
})
dataView?.documentCount().then(count => topBar.showDataCount(count), reportError)

const versionButton = viewer.querySelector('[data-version-button]')
const versionMenu = viewer.querySelector('[data-version-menu]')
const versionNotice = viewer.querySelector('[data-version-notice]')
const versions = permissions.canSeeVersions
  ? new VersionHistory({ config, frame, button: versionButton, menu: versionMenu, notice: versionNotice, fullViewLink: viewer.querySelector('[data-full-view-link]'), stage })
  : null
const compare = versions ? new VersionCompare({ bar: viewer.querySelector('[data-compare-bar]'), frame, versions, menu: versionMenu, stage }) : null
if (versions) new VersionOverwrite({ config, versions, notice: versionNotice, stage })

const threads = permissions.canReadComments ? new CommentThreads(config.artifactId, config.viewer) : null
const handoff = permissions.canEdit
  ? new AgentHandoff(m.viewerClient.agentPrompt, { artifactId: config.artifactId, title: config.title, version: config.currentVersion, url: `${location.origin}${config.path}`, guideUrl: `${location.origin}/llms.txt` })
  : null
const list = threads ? new CommentList({ element: drawerElement.querySelector('[data-drawer-view="comments"]'), threads, drawer, stage, canComment: permissions.canComment, byTouch: writesByTouch(), handoff }) : null
const pins = threads ? new CommentPins({ frame, threads, list, isShowingLatest: () => versions?.isShowingLatest ?? true }) : null

if (threads) {
  threads.addEventListener('change', () => topBar.showOpenCount(threads.openCount))
  countButton.addEventListener('click', () => drawer.toggle('comments'))
  list.addEventListener('select', event => {
    const { thread, reveal } = event.detail
    if (reveal && thread.anchor) frame.scrollToAnchor(thread.anchor)
  })
  threads.load().then(() => list.showLinkedComment(), error => {
    drawerElement.querySelector('[data-comment-threads]').replaceChildren(element('p', { className: 'viewer-drawer__status' }, m.viewerClient.comments.loadFailed(userMessageOf(error))))
  })
  window.addEventListener('hashchange', () => list.showLinkedComment())
  new LiveUpdates({ threads, versions, frame, list, drawer, stage }).start()
}

const commentMode = permissions.canComment ? new CommentMode({ button: viewer.querySelector('[data-comment-mode]'), hint: stage.querySelector('[data-mode-hint]'), frame }) : null
const composer = permissions.canComment ? new Composer({ form: stage.querySelector('[data-composer]'), stage, frame, threads, shownVersion: () => frame.version }) : null
const coach = permissions.canComment ? new CoachMark(viewer.querySelector('[data-coach]'), viewer.querySelector('[data-comment-mode]')) : null

if (commentMode) {
  composer.addEventListener('open', () => {
    commentMode.set(false)
    coach.dismiss()
  })
  commentMode.addEventListener('change', () => {
    if (!commentMode.isOn) return
    composer.close()
    coach.dismiss()
  })
  // On a phone the drawer would cover the page just written on, so a toast offers it instead.
  composer.addEventListener('sent', event => {
    const { thread } = event.detail
    if (!drawer.isSheet) return list.select(thread.id, { reveal: false, fresh: true })
    Xxd.toast(m.viewerClient.comments.sent(thread.number), { tone: 'success', within: stage, action: { label: m.viewerClient.actions.view, onClick: () => list.select(thread.id, { reveal: false, focus: true }) } })
  })
  versions?.addEventListener('shown', () => composer.close())
  setTimeout(() => coach.showOnce(), COACH_DELAY_MS)
}

const shareDialogElement = document.getElementById('share-dialog')
const shareDialog = shareDialogElement ? new ShareDialog(shareDialogElement, config, stage) : null
const reportButton = viewer.querySelector('[data-open-report]')
if (reportButton) new ReportDialog({ button: reportButton, dialog: document.getElementById('report-dialog'), artifactId: config.artifactId })
const shareXElement = document.getElementById('share-x-dialog')
const shareXPanel = shareXElement ? new ShareXPanel(shareXElement, config) : null
topBar.addEventListener('renamed', event => {
  frame.setTitle(event.detail.title)
  shareDialog?.showTitle(event.detail.title)
  shareXPanel?.showTitle(event.detail.title)
})

if (shareDialog) {
  for (const shareOpener of document.querySelectorAll('[data-open-share]')) shareOpener.addEventListener('click', () => shareDialog.open())
  shareDialog.addEventListener('saved', event => topBar.showVisibility(event.detail.label))
  shareXPanel.addEventListener('saved', event => topBar.showVisibility(event.detail.label))
  for (const shareXOpener of document.querySelectorAll('[data-open-share-x]')) shareXOpener.addEventListener('click', () => shareXPanel.open())
  shareDialogElement.querySelector('[data-share-to-x]').addEventListener('click', async () => {
    if (await shareDialog.close()) shareXPanel.open()
  })
  shareDialog.openFromLink()
  window.addEventListener('hashchange', () => shareDialog.openFromLink())
}

const keyActions = new Map([['?', () => keys.openShortcutSheet()]])
if (commentMode) keyActions.set('c', () => commentMode.toggle())
if (list) {
  keyActions.set('j', () => list.step(1, pins.threadsInPageOrder()))
  keyActions.set('k', () => list.step(-1, pins.threadsInPageOrder()))
}
const keys = new ViewerKeys({
  frame,
  actions: keyActions,
  shortcutSheet: document.querySelector('[data-shortcut-sheet]'),
  layers: [
    { isOpen: () => list?.isReplyFocused ?? false, close: () => list.cancelReply() },
    { isOpen: () => composer?.isOpen ?? false, close: () => composer.close() },
    { isOpen: () => commentMode?.isOn ?? false, close: () => commentMode.set(false) },
    { isOpen: () => coach?.isOpen ?? false, close: () => coach.dismiss() },
    { isOpen: () => compare?.isOpen ?? false, close: () => compare.exit() },
    { isOpen: () => drawer?.isOpen ?? false, close: () => drawer.close() },
  ],
})
