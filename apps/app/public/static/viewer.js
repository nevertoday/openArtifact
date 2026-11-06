import { ApiError, api, confirmArtifactRemoval, element, initialOf, readJsonData, removalWord, removeArtifact, timeAgo } from './common.js'
import { SharedDataProxy } from './shared-data-proxy.js'

const viewerConfig = readJsonData('viewer-config')
const artifactPath = `/api/artifacts/${encodeURIComponent(viewerConfig.artifactId)}`
const VISIBILITY_LABELS = { private: '私有', specified: '指定的人', workspace: 'Workspace 内可见', public_link: '公开链接' }
const DAY_MS = 24 * 60 * 60 * 1000

/** A one-line state of a side panel: empty, or a failure to load. */
function panelMessage(text) {
  return element('p', { className: 'viewer-side__status' }, text)
}

class CommentsPanel {
  constructor(panel) {
    this.panel = panel
    this.comments = []
    this.filter = 'unresolved'
    this.openReplyFor = null
    // The panel re-renders on every filter, resolve or pin change, so unsent text lives here, not in the textarea.
    this.commentDraft = { body: '', forAgent: false }
    this.replyDraftBody = ''
    this.pendingAnchor = null
    this.pickingAnchor = false
    this.pagePins = null
  }

  /** Shows the comment a pin on the page belongs to. */
  focusThread(commentId) {
    const comment = this.comments.find(candidate => candidate.commentId === commentId)
    if (!comment) return
    if (!this.#matchesFilter(comment)) this.filter = 'all'
    this.render()
    const threadElement = this.panel.querySelector(`[data-thread-id="${CSS.escape(commentId)}"]`)
    threadElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    threadElement?.setAttribute('data-highlighted', '')
    setTimeout(() => threadElement?.removeAttribute('data-highlighted'), 1600)
  }

  anchorPicked(anchor) {
    this.pendingAnchor = anchor
    this.pickingAnchor = false
    this.render()
    document.getElementById('comment-body')?.focus()
  }

  anchorCancelled() {
    this.pickingAnchor = false
    this.render()
  }

  async load() {
    try {
      const { comments } = await api(`${artifactPath}/comments?filter=all`)
      this.comments = comments
      this.render()
    } catch (error) {
      this.panel.replaceChildren(panelMessage(`评论加载失败：${error.message}`))
    }
  }

  render() {
    const threads = this.#threads()
    const unresolvedCount = threads.filter(thread => !thread.comment.resolved).length
    document.querySelector('[data-comment-count]').textContent = String(unresolvedCount)
    const shownThreads = threads.filter(thread => this.#matchesFilter(thread.comment))
    this.pinNumbers = CommentsPanel.#pinNumbersOf(threads)
    this.pagePins?.show(threads.filter(thread => thread.comment.anchor && !thread.comment.resolved).map(thread => ({
      commentId: thread.comment.commentId,
      number: this.pinNumbers.get(thread.comment.commentId),
      forAgent: thread.comment.forAgent,
      ...thread.comment.anchor,
    })))
    this.panel.replaceChildren(
      this.#filterChips(),
      shownThreads.length > 0 ? element('ul', { className: 'comment-threads' }, shownThreads.map(thread => this.#threadElement(thread))) : panelMessage(this.#emptyText()),
      this.#composer(),
    )
  }

  // Numbers follow the order comments were written, so a pin keeps its number when filters change.
  static #pinNumbersOf(threads) {
    const anchoredThreads = threads.filter(thread => thread.comment.anchor)
    return new Map(anchoredThreads.map((thread, index) => [thread.comment.commentId, index + 1]))
  }

  #threads() {
    const repliesByParent = new Map()
    for (const comment of this.comments.filter(comment => comment.parentId)) {
      repliesByParent.set(comment.parentId, [...(repliesByParent.get(comment.parentId) ?? []), comment])
    }
    return this.comments.filter(comment => !comment.parentId).map(comment => ({ comment, replies: repliesByParent.get(comment.commentId) ?? [] }))
  }

  #matchesFilter(comment) {
    if (this.filter === 'unresolved') return !comment.resolved
    if (this.filter === 'for_agent') return comment.forAgent && !comment.resolved
    return true
  }

  #emptyText() {
    if (this.filter === 'for_agent') return '没有等待 agent 处理的评论。'
    if (this.filter === 'unresolved') return this.comments.length > 0 ? '评论都已解决。' : '还没有评论。'
    return '还没有评论。'
  }

  #filterChips() {
    const chip = (filter, label) =>
      element('button', { type: 'button', className: 'xxd-chip', 'aria-pressed': String(this.filter === filter), onClick: () => { this.filter = filter; this.render() } }, label)
    // Addressing an agent is part of commenting, so a read-only reader does not get that filter.
    const agentChip = viewerConfig.permissions.canComment ? chip('for_agent', '给 agent') : null
    return element('div', { className: 'xxd-cluster comment-filters', role: 'group', 'aria-label': '筛选评论' }, chip('unresolved', '未解决'), agentChip, chip('all', '全部'))
  }

  #threadElement({ comment, replies }) {
    const stateBadge = comment.resolved ? element('span', { className: 'xxd-badge', 'data-tone': 'success' }, '已解决') : comment.forAgent ? element('span', { className: 'xxd-badge', 'data-tone': 'warning' }, '给 agent') : null
    const pinNumber = this.pinNumbers.get(comment.commentId)
    return element('li', { className: 'comment-thread', 'data-resolved': comment.resolved, 'data-thread-id': comment.commentId },
      this.#commentHeader(comment, stateBadge, pinNumber),
      element('p', { className: 'comment-body' }, comment.body),
      replies.map(reply => element('div', { className: 'comment-reply', 'data-via-agent': Boolean(reply.postedVia) }, this.#commentHeader(reply, null), element('p', { className: 'comment-body' }, reply.body))),
      viewerConfig.permissions.canComment ? this.#threadActions(comment) : null,
      this.openReplyFor === comment.commentId ? this.#replyForm(comment) : null,
    )
  }

  #commentHeader(comment, stateBadge, pinNumber) {
    const authorLabel = comment.postedVia ? `${comment.postedVia}（代 ${comment.author.name}）` : comment.author.name
    return element('div', { className: 'comment-header' },
      pinNumber ? element('span', { className: 'pin-number', 'data-for-agent': comment.forAgent, title: '页面上的标注' }, String(pinNumber)) : null,
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'aria-hidden': 'true' }, initialOf(comment.author.name)),
      element('span', { className: 'comment-author' }, authorLabel),
      element('span', { className: 'xxd-text', 'data-variant': 'caption' }, timeAgo(comment.createdAt)),
      stateBadge,
    )
  }

  #threadActions(comment) {
    return element('div', { className: 'xxd-cluster comment-actions' },
      element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'xs', onClick: () => this.#openReply(comment.commentId) }, '回复'),
      element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'xs', onClick: () => this.#setResolved(comment, !comment.resolved) }, comment.resolved ? '重新打开' : '标记已解决'),
    )
  }

  #openReply(commentId) {
    if (this.openReplyFor !== commentId) this.replyDraftBody = ''
    this.openReplyFor = commentId
    this.render()
  }

  #replyForm(parentComment) {
    const replyBody = element('textarea', { className: 'xxd-textarea', rows: '2', required: true, 'aria-label': '回复内容', 'data-error-required': '写点什么再发送', onInput: event => { this.replyDraftBody = event.target.value } }, this.replyDraftBody)
    const replyForm = element('form', { className: 'xxd-stack comment-reply-form', 'data-xxd-validate': true },
      element('div', { className: 'xxd-field' }, replyBody),
      element('div', { className: 'xxd-cluster comment-form-actions' },
        element('button', { type: 'button', className: 'xxd-btn ui-dialog-cancel', 'data-size': 'sm', onClick: () => { this.openReplyFor = null; this.replyDraftBody = ''; this.render() } }, '取消'),
        element('button', { type: 'submit', className: 'xxd-btn', 'data-variant': 'primary', 'data-size': 'sm' }, '发送回复'),
      ),
    )
    replyForm.addEventListener('submit', event => {
      event.preventDefault()
      this.#post({ body: replyBody.value, parentId: parentComment.commentId })
    })
    queueMicrotask(() => replyBody.focus())
    return replyForm
  }

  #composer() {
    if (!viewerConfig.permissions.canComment) {
      const reason = viewerConfig.viewer ? '你可以查看，但没有评论权限。' : '登录后可以评论。'
      return element('p', { className: 'comment-composer xxd-text', 'data-variant': 'secondary' }, reason, viewerConfig.viewer ? null : element('a', { className: 'xxd-link', href: `/login?next=${encodeURIComponent(location.pathname)}` }, '登录'))
    }
    const commentBody = element('textarea', { id: 'comment-body', className: 'xxd-textarea', rows: '3', required: true, placeholder: '这一节需要补充…', 'data-error-required': '写点什么再发送', onInput: event => { this.commentDraft.body = event.target.value } }, this.commentDraft.body)
    const forAgent = element('input', { id: 'for-agent', type: 'checkbox', className: 'xxd-check', checked: this.commentDraft.forAgent, onChange: event => { this.commentDraft.forAgent = event.target.checked } })
    const anchorControl = this.#anchorControl()
    const composer = element('form', { className: 'comment-composer xxd-stack', 'data-xxd-validate': true },
      element('div', { className: 'xxd-field' }, element('label', { for: 'comment-body', className: 'xxd-label' }, '写评论'), commentBody),
      anchorControl,
      element('div', { className: 'comment-composer__row' },
        element('label', { className: 'xxd-choice', for: 'for-agent' }, forAgent, '给 agent 处理'),
        element('button', { type: 'submit', className: 'xxd-btn', 'data-variant': 'primary', 'data-size': 'sm' }, '发送'),
      ),
    )
    composer.addEventListener('submit', event => {
      event.preventDefault()
      this.#post({ body: commentBody.value, forAgent: forAgent.checked, anchor: this.pendingAnchor })
    })
    return composer
  }

  #anchorControl() {
    if (this.pickingAnchor) {
      return element('div', { className: 'xxd-cluster anchor-control', 'data-picking': true },
        element('span', {}, '在左边的页面上点要评论的位置'),
        element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'xs', onClick: () => { this.pagePins?.cancelPick(); this.anchorCancelled() } }, '取消'))
    }
    if (this.pendingAnchor) {
      return element('div', { className: 'xxd-cluster anchor-control' },
        element('span', { className: 'pin-number' }, '+'), element('span', {}, '已标注页面上的位置'),
        element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'xs', onClick: () => { this.pendingAnchor = null; this.render() } }, '移除'))
    }
    return element('div', { className: 'xxd-cluster anchor-control' },
      element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', onClick: () => { this.pickingAnchor = true; this.pagePins?.pickSpot(); this.render() } }, '在页面上标注位置'))
  }

  async #post(newComment) {
    try {
      const { comment } = await api(`${artifactPath}/comments`, { method: 'POST', body: newComment })
      this.comments.push(comment)
      this.openReplyFor = null
      this.replyDraftBody = ''
      if (!newComment.parentId) {
        this.pendingAnchor = null
        this.commentDraft = { body: '', forAgent: false }
      }
      if (!newComment.parentId && this.filter === 'for_agent' && !comment.forAgent) this.filter = 'unresolved'
      this.render()
    } catch (error) {
      Xxd.toast(`发送失败：${error.message}`, { tone: 'danger', within: this.panel })
    }
  }

  async #setResolved(comment, resolved) {
    try {
      await api(`/api/comments/${encodeURIComponent(comment.commentId)}`, { method: 'PATCH', body: { resolved } })
      comment.resolved = resolved
      this.render()
    } catch (error) {
      Xxd.toast(error.message, { tone: 'danger', within: this.panel })
    }
  }
}

class VersionsPanel {
  constructor(panel, versionOverwrite) {
    this.panel = panel
    this.versionOverwrite = versionOverwrite
  }

  async load() {
    try {
      const { versions } = await api(`${artifactPath}/versions`)
      this.panel.replaceChildren(element('ol', { className: 'xxd-timeline version-timeline' }, versions.map(versionRecord => this.#versionItem(versionRecord))))
    } catch (error) {
      this.panel.replaceChildren(panelMessage(`版本加载失败：${error.message}`))
    }
  }

  #versionItem(versionRecord) {
    const isCurrent = versionRecord.version === viewerConfig.currentVersion
    const isShown = versionRecord.version === viewerConfig.shownVersion
    const canOverwriteWithIt = viewerConfig.permissions.canEdit && !isCurrent
    return element('li', { className: 'xxd-timeline__item', 'data-highlight': isCurrent },
      element('time', { className: 'xxd-timeline__time', datetime: new Date(versionRecord.createdAt).toISOString() }, timeAgo(versionRecord.createdAt)),
      element('div', { className: 'xxd-timeline__body' },
        element('p', { className: 'xxd-timeline__title xxd-cluster' },
          element('span', { className: 'xxd-mono' }, `v${versionRecord.version}`),
          VersionsPanel.#stateBadge(isCurrent, isShown),
          VersionsPanel.#originLabel(versionRecord),
        ),
        element('p', { className: 'xxd-timeline__text' }, `${versionRecord.author.name} · ${versionRecord.publishedVia ?? '网页'}`),
        versionRecord.note ? element('p', { className: 'version-note' }, versionRecord.note) : null,
        element('div', { className: 'xxd-cluster version-actions' },
          isShown ? null : element('a', { className: 'xxd-btn', 'data-size': 'xs', href: VersionsPanel.#viewPath(versionRecord.version, isCurrent) }, '查看'),
          canOverwriteWithIt ? element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'xs', onClick: () => this.versionOverwrite.confirmAndOverwrite(versionRecord.version) }, '用这个版本覆盖') : null,
        ),
      ),
    )
  }

  static #stateBadge(isCurrent, isShown) {
    if (isCurrent) return element('span', { className: 'xxd-badge' }, '当前')
    if (isShown) return element('span', { className: 'xxd-badge', 'data-tone': 'action' }, '正在查看')
    return null
  }

  static #originLabel(versionRecord) {
    switch (versionRecord.origin) {
      case 'published':
        return null
      case 'restored':
        return element('span', { className: 'xxd-text', 'data-variant': 'caption' }, `恢复自 v${versionRecord.restoredFrom}`)
      default:
        throw new Error(`Unknown version origin ${versionRecord.origin}`)
    }
  }

  static #viewPath(version, isCurrent) {
    return isCurrent ? location.pathname : `${location.pathname}?v=${version}`
  }
}

class DataPanel {
  constructor(panel) {
    this.panel = panel
  }

  async load() {
    try {
      const { collections } = await api(`${artifactPath}/data`)
      if (collections.length === 0) {
        this.panel.replaceChildren(element('div', { className: 'xxd-empty', 'data-size': 'sm' },
          element('p', { className: 'xxd-empty__title' }, '这个页面还没有存数据。'),
          element('p', { className: 'xxd-empty__text' }, '页面可以用 window.openArtifact.db 保存报名、投票这类团队共享的数据，数据和页面版本分开保存。')))
        return
      }
      const sections = await Promise.all(collections.map(collection => this.#collectionSection(collection)))
      this.panel.replaceChildren(...sections)
    } catch (error) {
      this.panel.replaceChildren(panelMessage(`数据加载失败：${error.message}`))
    }
  }

  async #collectionSection(collection) {
    const { documents } = await api(`${artifactPath}/data/${encodeURIComponent(collection.collection)}`)
    return element('section', { className: 'xxd-stack data-collection' },
      element('p', { className: 'xxd-cluster' }, element('span', { className: 'xxd-mono' }, collection.collection), element('span', { className: 'xxd-text', 'data-variant': 'caption' }, `${collection.documentCount} 条`)),
      element('div', { className: 'xxd-table-wrap' }, element('table', { className: 'xxd-table', 'data-density': 'compact' },
        element('thead', {}, element('tr', {}, element('th', {}, 'id'), element('th', {}, '内容'), element('th', {}, '最后修改'))),
        element('tbody', {}, documents.map(sharedDocument => element('tr', {},
          element('td', { className: 'xxd-mono data-collection__id', title: sharedDocument.id }, sharedDocument.id),
          element('td', { 'data-wrap': true }, element('code', { className: 'xxd-code-inline' }, JSON.stringify(sharedDocument.data))),
          element('td', {}, element('span', { className: 'xxd-text', 'data-variant': 'secondary' }, `${sharedDocument.updatedBy?.name ?? '匿名访客'} · ${timeAgo(sharedDocument.updatedAt)}`)),
        ))),
      )),
    )
  }
}

/**
 * Carries comment pins between this page and the artifact frame: the frame's SDK draws the pins and reports
 * where the viewer clicked. Messages come from the sandboxed frame's opaque origin "null", so the frame's
 * window object is what identifies them.
 */
class PagePins {
  constructor(frame, commentsPanel, showCommentsTab) {
    this.frame = frame
    this.pins = []
    this.commentsPanel = commentsPanel
    this.showCommentsTab = showCommentsTab
    window.addEventListener('message', event => this.#handle(event))
    frame.addEventListener('load', () => this.#send({ type: 'open-artifact:pins', pins: this.pins }))
  }

  show(pins) {
    this.pins = pins
    this.#send({ type: 'open-artifact:pins', pins })
  }

  pickSpot() {
    this.#send({ type: 'open-artifact:pick-anchor' })
  }

  cancelPick() {
    this.#send({ type: 'open-artifact:cancel-pick' })
  }

  #handle(event) {
    const fromArtifactFrame = event.source === this.frame.contentWindow && event.origin === 'null'
    const message = event.data
    if (!fromArtifactFrame || !message) return
    switch (message.type) {
      case 'open-artifact:anchor-picked':
        return this.commentsPanel.anchorPicked(PagePins.#validAnchor(message.anchor))
      case 'open-artifact:anchor-cancelled':
        return this.commentsPanel.anchorCancelled()
      case 'open-artifact:pin-selected':
        this.showCommentsTab()
        return this.commentsPanel.focusThread(String(message.commentId ?? ''))
    }
  }

  // The page is untrusted; anything but two fractions becomes no anchor.
  static #validAnchor(anchor) {
    const isFraction = value => typeof value === 'number' && value >= 0 && value <= 1
    return anchor && isFraction(anchor.x) && isFraction(anchor.y) ? { x: anchor.x, y: anchor.y } : null
  }

  #send(message) {
    this.frame.contentWindow?.postMessage(message, '*')
  }
}

/**
 * Overwrites the current version with an older one by publishing that version's files as a new version, so
 * every version stays in the history. Undo is the same move with the version that was replaced. The page
 * reloads on the new version, so the result travels to it in sessionStorage.
 */
class VersionOverwrite {
  static #RESULT_KEY = `open-artifact:overwrite:${viewerConfig.artifactId}`

  async confirmAndOverwrite(olderVersion) {
    const currentVersion = viewerConfig.currentVersion
    const nextVersion = currentVersion + 1
    const confirmed = await Xxd.confirmDialog({
      title: `用 v${olderVersion} 覆盖当前版本？`,
      message: `会发布 v${nextVersion}，内容和 v${olderVersion} 一样。v${currentVersion} 和更早的版本都会保留，随时可以再换回来。`,
      cancelLabel: '取消',
      confirmLabel: `发布 v${nextVersion}`,
    })
    if (confirmed) await this.#overwrite(olderVersion, currentVersion)
  }

  /** Shows the result of an overwrite made just before this page loaded, with a way to undo it. */
  showResultOfLastOverwrite() {
    const overwriteResult = VersionOverwrite.#takeResult()
    if (!overwriteResult) return
    const { publishedVersion, restoredFrom, replacedVersion } = overwriteResult
    const stillCurrent = publishedVersion === viewerConfig.currentVersion
    const undo = { label: '撤销', onClick: () => this.#overwrite(replacedVersion, publishedVersion) }
    Xxd.toast(`已发布 v${publishedVersion}（恢复自 v${restoredFrom}）`, { tone: 'success', action: stillCurrent ? undo : undefined })
  }

  async #overwrite(olderVersion, baseVersion) {
    try {
      const { version: publishedVersion } = await api(`${artifactPath}/versions/${olderVersion}/restore`, { method: 'POST', body: { baseVersion } })
      VersionOverwrite.#keepResult({ publishedVersion, restoredFrom: olderVersion, replacedVersion: baseVersion })
      location.href = location.pathname
    } catch (error) {
      const someoneElsePublished = error instanceof ApiError && error.status === 409
      Xxd.toast(someoneElsePublished ? '刚有人发布了新版本，刷新后再试' : `覆盖失败：${error.message}`, { tone: 'danger' })
    }
  }

  // Storage can be blocked; the overwrite has happened either way, only the toast is lost.
  static #keepResult(overwriteResult) {
    try {
      sessionStorage.setItem(VersionOverwrite.#RESULT_KEY, JSON.stringify(overwriteResult))
    } catch {}
  }

  static #takeResult() {
    try {
      const storedResult = sessionStorage.getItem(VersionOverwrite.#RESULT_KEY)
      sessionStorage.removeItem(VersionOverwrite.#RESULT_KEY)
      return storedResult ? JSON.parse(storedResult) : null
    } catch {
      return null
    }
  }
}

function showTitle(title) {
  viewerConfig.title = title
  document.title = `${title} · Open Artifact`
  document.querySelector('.viewer-heading__title').textContent = title
  const shareSubtitle = document.querySelector('[data-share-subtitle]')
  if (shareSubtitle) shareSubtitle.textContent = title
}

async function renameArtifact() {
  const titleInput = element('input', { id: 'rename-title', className: 'xxd-input', value: viewerConfig.title, maxlength: '200', required: true, autocomplete: 'off' })
  const titleField = element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'rename-title' }, '标题'), titleInput)
  // Enter would submit the dialog's first button, its close button, so it confirms explicitly.
  titleInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    titleInput.closest('dialog')?.querySelector('button[value="confirm"]')?.click()
  })
  const renameConfirmation = Xxd.confirmDialog({ title: '重命名', message: titleField, confirmLabel: '保存', cancelLabel: '取消', closeLabel: '关闭' })
  titleInput.select()
  const confirmed = await renameConfirmation
  const newTitle = titleInput.value.trim()
  const titleChanged = newTitle !== '' && newTitle !== viewerConfig.title
  if (!confirmed || !titleChanged) return
  try {
    const { title } = await api(artifactPath, { method: 'PATCH', body: { title: newTitle } })
    showTitle(title)
    Xxd.toast('已重命名', { tone: 'success' })
  } catch (error) {
    Xxd.toast(`重命名失败：${error.message}`, { tone: 'danger' })
  }
}

// After removing, home offers 撤销 for this artifact.
async function removeThisArtifact() {
  const takesDown = viewerConfig.removalTakesDown
  const confirmed = await confirmArtifactRemoval(viewerConfig.title, takesDown)
  if (!confirmed) return
  try {
    await removeArtifact(viewerConfig.artifactId)
    location.href = `/?removed=${encodeURIComponent(viewerConfig.artifactId)}`
  } catch (error) {
    Xxd.toast(`${removalWord(takesDown)}失败：${error.message}`, { tone: 'danger' })
  }
}

class ShareDialog {
  constructor(dialog) {
    this.dialog = dialog
    this.body = dialog.querySelector('[data-share-body]')
    this.sharing = null
    dialog.querySelector('[data-save-sharing]').addEventListener('click', () => this.#save())
    dialog.querySelector('[data-copy-link]').dataset.copy = location.origin + location.pathname
    dialog.querySelector('[data-share-subtitle]').textContent = viewerConfig.title
    dialog.querySelector('[data-share-url]').textContent = location.host + location.pathname
  }

  async open() {
    Xxd.openDialog(this.dialog)
    try {
      this.sharing = await api(`${artifactPath}/sharing`)
      this.render()
    } catch (error) {
      this.body.replaceChildren(element('div', { className: 'xxd-banner', 'data-tone': 'danger', role: 'alert' }, element('p', { className: 'xxd-banner__text' }, error.message)))
    }
  }

  render() {
    this.body.replaceChildren(...[this.#visibilityChoices(), this.#grantsSection(), this.#publicLinkSection()].filter(Boolean))
  }

  #visibilityChoices() {
    const choice = (visibility, title, description) => {
      const isDisabled = visibility === 'public_link' && !this.sharing.publicLink.allowedInWorkspace
      const radio = element('input', { type: 'radio', className: 'xxd-radio', name: 'visibility', id: `visibility-${visibility}`, value: visibility, checked: this.sharing.visibility === visibility, disabled: isDisabled })
      radio.addEventListener('change', () => { this.sharing.visibility = visibility; this.render() })
      return element('label', { className: 'xxd-choice', for: `visibility-${visibility}` }, radio,
        element('span', {}, title, element('small', {}, isDisabled ? 'workspace 管理员已关闭公开链接' : description)))
    }
    return element('fieldset', { className: 'xxd-choices share-section' }, element('legend', { className: 'share-section__title' }, '谁能看到'),
      choice('private', '私有', '只有你自己'),
      choice('specified', '指定的人', '只有下面单独授权的人'),
      choice('workspace', '整个 workspace', '默认。成员可以查看、评论，也能读写页面里的共享数据'),
      choice('public_link', '任何拿到链接的人', '不需要登录。默认只读，可以设过期时间和密码'),
    )
  }

  #grantsSection() {
    const emailInput = element('input', { className: 'xxd-input', 'data-size': 'sm', id: 'grant-email', type: 'email', required: true, placeholder: '输入成员邮箱', 'aria-label': '成员邮箱', list: 'workspace-members', 'data-error-type': '请输入有效的邮箱，比如 name@example.com' })
    const roleSelect = this.#roleSelect('viewer', 'grant-role')
    const addForm = element('form', { className: 'share-grant-form', 'data-xxd-validate': true },
      element('div', { className: 'xxd-field share-grant-form__email' }, emailInput), ShareDialog.#selectBox(roleSelect), element('button', { type: 'submit', className: 'xxd-btn', 'data-size': 'sm' }, '添加'))
    addForm.addEventListener('submit', async event => {
      event.preventDefault()
      await this.#grant(emailInput.value, roleSelect.value)
    })
    const memberOptions = element('datalist', { id: 'workspace-members' }, this.sharing.members.map(member => element('option', { value: member.email }, member.name)))
    const grantList = this.sharing.grants.length > 0 ? element('ul', { className: 'xxd-list' }, this.sharing.grants.map(grant => this.#grantRow(grant))) : null
    return element('section', { className: 'xxd-stack share-section' },
      element('div', { className: 'xxd-text-pair' },
        element('h3', { className: 'share-section__title' }, '单独授权'),
        element('p', { className: 'xxd-text', 'data-variant': 'caption' }, this.sharing.visibility === 'private' ? '私有时，单独授权不生效。' : '可查看：使用页面；可评论：再加评论；可编辑：还能发布新版本。')),
      addForm, memberOptions, grantList,
    )
  }

  #grantRow(grant) {
    const roleSelect = this.#roleSelect(grant.role, `grant-role-${grant.userId}`)
    roleSelect.setAttribute('aria-label', `${grant.name} 的权限`)
    roleSelect.addEventListener('change', () => this.#grant(grant.email, roleSelect.value))
    return element('li', { className: 'xxd-list__item share-person' },
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'aria-hidden': 'true' }, initialOf(grant.name)),
      element('span', { className: 'xxd-list__main' }, element('span', { className: 'xxd-list__title' }, grant.name), element('span', { className: 'xxd-list__meta' }, grant.email ?? '')),
      ShareDialog.#selectBox(roleSelect),
      element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'sm', onClick: () => this.#revoke(grant) }, '移除'),
    )
  }

  #roleSelect(selectedRole, selectId) {
    const roles = [['viewer', '可查看'], ['commenter', '可评论'], ['editor', '可编辑']]
    return element('select', { id: selectId, 'aria-label': '权限' }, roles.map(([role, label]) => element('option', { value: role, selected: role === selectedRole }, label)))
  }

  static #selectBox(select) {
    return element('label', { className: 'xxd-select', 'data-size': 'sm' }, select)
  }

  #publicLinkSection() {
    if (this.sharing.visibility !== 'public_link') return null
    const { publicLink } = this.sharing
    const expirySelect = element('select', { id: 'link-expiry' },
      element('option', { value: 'keep', selected: true }, publicLink.expiresAt ? `保持不变（${new Date(publicLink.expiresAt).toLocaleDateString('zh-CN')} 过期）` : '保持不变（永不过期）'),
      element('option', { value: '7' }, '7 天后过期'), element('option', { value: '30' }, '30 天后过期'), element('option', { value: 'never' }, '永不过期'))
    const passwordInput = element('input', { className: 'xxd-input', id: 'link-password', type: 'password', autocomplete: 'new-password', placeholder: publicLink.hasPassword ? '已设置，留空表示不变' : '不设置' })
    const removePassword = element('input', { type: 'checkbox', className: 'xxd-check', id: 'remove-password' })
    const anonymousWrite = element('input', { type: 'checkbox', className: 'xxd-check', id: 'anonymous-write', checked: publicLink.anonymousWriteEnabled })
    this.publicLinkFields = { expirySelect, passwordInput, removePassword, anonymousWrite }
    return element('section', { className: 'xxd-stack share-section' },
      element('h3', { className: 'share-section__title' }, '公开链接'),
      element('div', { className: 'xxd-layout', 'data-cols': '2up' },
        element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'link-expiry' }, '过期时间'), element('label', { className: 'xxd-select' }, expirySelect)),
        element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'link-password', 'data-optional': true }, '访问密码'), passwordInput)),
      publicLink.hasPassword ? element('label', { className: 'xxd-choice', for: 'remove-password' }, removePassword, '取消访问密码') : null,
      element('label', { className: 'xxd-choice', for: 'anonymous-write' }, anonymousWrite, element('span', {}, '允许匿名访客写入共享数据', element('small', {}, '适合对外的报名表。'))),
    )
  }

  #publicLinkUpdate() {
    if (this.sharing.visibility !== 'public_link' || !this.publicLinkFields) return {}
    const { expirySelect, passwordInput, removePassword, anonymousWrite } = this.publicLinkFields
    const update = { anonymousWriteEnabled: anonymousWrite.checked }
    const expiryChoice = expirySelect.value
    // Leaving the expiry out keeps it, so an author can still save after the link has expired.
    const expiresInDays = Number(expiryChoice)
    if (expiryChoice === 'never') update.publicLinkExpiresAt = null
    if (Number.isInteger(expiresInDays)) update.publicLinkExpiresAt = Date.now() + expiresInDays * DAY_MS
    if (removePassword.checked) update.publicLinkPassword = null
    else if (passwordInput.value) update.publicLinkPassword = passwordInput.value
    return update
  }

  async #save() {
    try {
      const sharingUpdate = { visibility: this.sharing.visibility, ...this.#publicLinkUpdate() }
      await api(`${artifactPath}/sharing`, { method: 'PUT', body: sharingUpdate })
      document.querySelector('[data-visibility-pill]').textContent = VISIBILITY_LABELS[this.sharing.visibility]
      Xxd.closeDialog(this.dialog)
      Xxd.toast('分享设置已保存', { tone: 'success' })
    } catch (error) {
      Xxd.toast(`保存失败：${error.message}`, { tone: 'danger', within: this.dialog })
    }
  }

  async #grant(email, role) {
    try {
      const grantedPerson = await api(`${artifactPath}/grants`, { method: 'PUT', body: { email, role } })
      this.sharing.grants = [...this.sharing.grants.filter(grant => grant.userId !== grantedPerson.userId), grantedPerson]
      this.render()
    } catch (error) {
      Xxd.toast(error.message, { tone: 'danger', within: this.dialog })
    }
  }

  async #revoke(grant) {
    try {
      await api(`${artifactPath}/grants/${encodeURIComponent(grant.userId)}`, { method: 'DELETE' })
      this.sharing.grants = this.sharing.grants.filter(candidate => candidate.userId !== grant.userId)
      this.render()
    } catch (error) {
      Xxd.toast(error.message, { tone: 'danger', within: this.dialog })
    }
  }
}

const artifactFrame = document.getElementById('artifact-frame')
new SharedDataProxy(artifactFrame, viewerConfig)

// A visitor of a public link may get no side panels at all, or the comments alone.
const commentsPanelElement = document.getElementById('panel-comments')
const versionsPanelElement = document.getElementById('panel-versions')
const dataPanelElement = document.getElementById('panel-data')
const versionOverwrite = new VersionOverwrite()
const versionsPanel = versionsPanelElement ? new VersionsPanel(versionsPanelElement, versionOverwrite) : null
const dataPanel = dataPanelElement ? new DataPanel(dataPanelElement) : null
const viewerTabs = document.getElementById('viewer-tabs')
viewerTabs?.addEventListener('xxd:change', event => {
  if (event.detail.value === 'tab-versions') versionsPanel?.load()
  if (event.detail.value === 'tab-data') dataPanel?.load()
})
if (commentsPanelElement) {
  const commentsPanel = new CommentsPanel(commentsPanelElement)
  // Pins belong to the current version; on an older version the page may have moved.
  const showsCurrentVersion = viewerConfig.shownVersion === viewerConfig.currentVersion
  if (showsCurrentVersion) commentsPanel.pagePins = new PagePins(artifactFrame, commentsPanel, () => Xxd.selectTab(viewerTabs, document.getElementById('tab-comments')))
  commentsPanel.load()
}

const shareDialogElement = document.getElementById('share-dialog')
if (shareDialogElement) {
  const shareDialog = new ShareDialog(shareDialogElement)
  document.querySelector('[data-open-share]')?.addEventListener('click', () => shareDialog.open())
}
document.querySelector('[data-rename-artifact]')?.addEventListener('click', renameArtifact)
document.querySelector('[data-remove-artifact]')?.addEventListener('click', removeThisArtifact)
for (const overwriteButton of document.querySelectorAll('[data-overwrite-with-version]')) {
  overwriteButton.addEventListener('click', () => versionOverwrite.confirmAndOverwrite(Number(overwriteButton.dataset.overwriteWithVersion)))
}
versionOverwrite.showResultOfLastOverwrite()
