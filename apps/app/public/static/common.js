// Helpers shared by the page scripts. Text from people and agents is only ever set through textContent.
// Toasts, copy buttons, menus, tabs and dialogs come from the UI kit's global `Xxd`.
import { dateText, fullTimeText, relativeTimeText } from './time-text.js'

export { dateText }

export class ApiError extends Error {
  /** `code`, `field` and `maxLength` come from the server's error body; see ErrorCode in src/http-error.ts. */
  constructor(status, message, { code = null, field = null, maxLength = null, cause } = {}) {
    super(message, { cause })
    this.status = status
    this.code = code
    this.field = field
    this.maxLength = maxLength
  }
}

const FALLBACK_MESSAGE = '操作没有成功，请重试。'
const NEW_TOKEN_HINT = '请在「Agent 接入」里新建一个。'

// The one place an error code becomes Chinese. Keys follow ErrorCode in src/http-error.ts; `network` is the browser's own.
const ERROR_MESSAGES = {
  network: () => '连不上 Open Artifact，请检查网络后重试。',
  unauthenticated: () => '登录已失效，请刷新页面重新登录。',
  token_invalid: () => `这个 token 无效，${NEW_TOKEN_HINT}`,
  token_revoked: () => `这个 token 已撤销，${NEW_TOKEN_HINT}`,
  token_expired: () => `这个 token 已过期，${NEW_TOKEN_HINT}`,
  forbidden: () => '你没有权限做这件事。',
  admin_required: () => '只有 workspace 管理员可以做这件事。',
  browser_session_required: () => '这件事要在网页上登录后做。',
  outside_token_scope: () => '这个 token 只能发布。要做这件事，请新建一个完全权限的 token，或者在网页上操作。',
  cross_site_request: () => '请在 Open Artifact 的页面上操作。',
  removed_from_workspace: () => '你已被移出这个 workspace，请联系管理员。',
  not_found: () => '找不到了，它可能已被删除。刷新页面看看。',
  person_not_found: () => '这个邮箱还没登录过 Open Artifact。请对方先登录一次，再添加。',
  field_required: () => '这一项不能为空。',
  field_too_long: error => `最多 ${error.maxLength} 个字。`,
  too_large: () => '内容太大，请减小后再试。',
  last_admin: () => 'workspace 至少要有一位管理员。先把别人设为管理员。',
  cannot_remove_self: () => '不能移除自己，请另一位管理员操作。',
  author_always_sees: () => '作者自己一直能看到，不用添加。',
  public_links_off: () => '管理员已关闭公开链接。',
  version_conflict: () => '刚有人发布了新版本。刷新页面后再试。',
}

/**
 * What to tell a person about a failed call, in Chinese; use it for every toast, banner and field error, since
 * `error.message` stays in English for agents. When `error.field` names a field on the page, show it under that field.
 */
export function userMessageOf(error) {
  const message = error instanceof ApiError ? ERROR_MESSAGES[error.code] : undefined
  return message ? message(error) : FALLBACK_MESSAGE
}

/** Calls the app's JSON API with the session cookie; throws ApiError with the server's English message and its code. */
export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetch(path, init).catch(error => {
    throw new ApiError(0, `could not reach ${path}`, { code: 'network', cause: error })
  })
  if (response.status === 204) return null
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, responseBody.error ?? `request failed with ${response.status}`, responseBody)
  return responseBody
}

/** Builds an element; string children become text nodes, so nothing is parsed as HTML. */
export function element(tagName, attributes = {}, ...children) {
  const created = document.createElement(tagName)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue
    if (name.startsWith('on') && typeof value === 'function') created.addEventListener(name.slice(2).toLowerCase(), value)
    else if (name === 'className') created.className = value
    else created.setAttribute(name, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    created.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return created
}

export function readJsonData(elementId) {
  const dataElement = document.getElementById(elementId)
  return dataElement ? JSON.parse(dataElement.textContent) : null
}

/** The words alone; prefer timeElement, which also carries the full time on hover. */
export function timeAgo(timestamp) {
  return relativeTimeText(timestamp, Date.now())
}

/** <time> reading 「3 分钟前」, with the full time on hover. */
export function timeElement(timestamp) {
  return element('time', { datetime: new Date(timestamp).toISOString(), title: fullTimeText(timestamp), 'data-relative': true }, timeAgo(timestamp))
}

// The server writes these in its own time zone; the reader's zone decides 昨天 and the date.
function rerenderServerTimes() {
  for (const timeTag of document.querySelectorAll('time[data-relative]')) {
    const timestamp = Date.parse(timeTag.dateTime)
    timeTag.textContent = timeAgo(timestamp)
    timeTag.title = fullTimeText(timestamp)
  }
}

/** 下架 is an admin removing someone else's artifact; 删除 is the author removing their own. */
export function removalWord(takesDown) {
  return takesDown ? '下架' : '删除'
}

/** Asks before removing an artifact; the kit puts 取消 first and the danger action last. */
export function confirmArtifactRemoval(title, takesDown) {
  const word = removalWord(takesDown)
  return Xxd.confirmDialog({
    title: `${word}「${title}」？`,
    message: takesDown
      ? '下架后所有人都看不到它，作者也不能自己恢复。30 天内管理员可以在「最近删除」里恢复。'
      : '删除后所有人都看不到它。30 天内可以在「最近删除」里恢复。',
    confirmLabel: word,
    cancelLabel: '取消',
    closeLabel: '关闭',
    tone: 'danger',
  })
}

export function removeArtifact(artifactId) {
  return api(`/api/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' })
}

/** Resolves to { artifactId, title, url } of the restored artifact. */
export function restoreArtifact(artifactId) {
  return api(`/api/artifacts/${encodeURIComponent(artifactId)}/restore`, { method: 'POST' })
}

export function initialOf(name) {
  return Array.from((name ?? '').trim())[0]?.toUpperCase() ?? '?'
}

function wireSignOut() {
  for (const signOutButton of document.querySelectorAll('[data-sign-out]')) {
    signOutButton.addEventListener('click', async () => {
      await api('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => null)
      location.href = '/login'
    })
  }
}

function wireWorkspaceSwitcher() {
  const switcher = document.querySelector('[data-switch-workspace]')
  switcher?.addEventListener('change', async () => {
    await api('/api/me/workspace', { method: 'POST', body: { workspaceId: switcher.value } })
    location.href = '/'
  })
}

/** The bell in the top bar: the unread count, and the person's notifications as sentences, newest first. */
class NotificationBell {
  constructor(bell, panel) {
    this.bell = bell
    this.panel = panel
    this.list = panel.querySelector('[data-notification-list]')
    this.unreadCount = bell.querySelector('[data-unread-count]')
    this.markAllButton = panel.querySelector('[data-mark-all-read]')
    this.notifications = []
    this.markAllButton.addEventListener('click', () => this.#markAllRead())
    panel.addEventListener('toggle', event => { if (event.newState === 'open') this.refresh() })
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refresh() })
  }

  async refresh() {
    try {
      const { notifications } = await api('/api/notifications')
      this.notifications = notifications
      this.render()
    } catch (error) {
      this.list.replaceChildren(element('p', { className: 'app-notifications__status xxd-text', 'data-variant': 'secondary' }, `通知加载失败：${userMessageOf(error)}`))
    }
  }

  render() {
    const unreadCount = this.notifications.filter(notification => !notification.read).length
    this.unreadCount.hidden = unreadCount === 0
    this.unreadCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount)
    this.bell.setAttribute('aria-label', unreadCount === 0 ? '通知' : `通知，${unreadCount} 条未读`)
    this.markAllButton.hidden = unreadCount === 0
    if (this.notifications.length === 0) {
      this.list.replaceChildren(element('div', { className: 'xxd-empty', 'data-size': 'sm' },
        element('p', { className: 'xxd-empty__title' }, '还没有通知'),
        element('p', { className: 'xxd-empty__text' }, '有人评论你的 artifact、回复或解决你的评论时，会出现在这里。')))
      return
    }
    this.list.replaceChildren(element('ul', { className: 'xxd-list app-notifications__list', 'data-interactive': true }, this.notifications.map(notification => this.#item(notification))))
  }

  #item(notification) {
    const link = element('a', { className: 'xxd-list__main', href: notification.url, onClick: event => this.#open(event, notification) },
      element('span', { className: 'xxd-list__title app-notifications__text' }, notification.text),
      element('span', { className: 'xxd-list__meta' }, notification.read ? timeAgo(notification.createdAt) : `未读 · ${timeAgo(notification.createdAt)}`))
    return element('li', { className: 'xxd-list__item', 'data-unread': !notification.read },
      notification.read ? null : element('span', { className: 'xxd-dot', 'data-tone': 'action', 'aria-hidden': 'true' }), link)
  }

  // Marking read first means the count is right when the person comes back.
  async #open(event, notification) {
    if (notification.read) return
    event.preventDefault()
    await api(`/api/notifications/${encodeURIComponent(notification.notificationId)}/read`, { method: 'POST' }).catch(() => null)
    notification.read = true
    this.render()
    this.panel.hidePopover()
    location.href = notification.url
  }

  async #markAllRead() {
    try {
      await api('/api/notifications/read-all', { method: 'POST' })
      for (const notification of this.notifications) notification.read = true
      this.render()
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.panel })
    }
  }
}

function wireNotificationBell() {
  const bell = document.querySelector('[data-notification-bell]')
  const panel = document.getElementById('notification-panel')
  if (bell && panel) new NotificationBell(bell, panel).refresh()
}

rerenderServerTimes()
wireSignOut()
wireWorkspaceSwitcher()
wireNotificationBell()
