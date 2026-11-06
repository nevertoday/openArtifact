// Helpers shared by the page scripts. Text from people and agents is only ever set through textContent.
// Toasts, copy buttons, menus, tabs and dialogs come from the UI kit's global `Xxd`.

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Calls the app's JSON API with the session cookie; throws ApiError with the server's message. */
export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetch(path, init)
  if (response.status === 204) return null
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, responseBody.error ?? `请求失败（${response.status}）`)
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

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function timeAgo(timestamp) {
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`
  if (elapsed < 2 * DAY) return '昨天'
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
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
      this.list.replaceChildren(element('p', { className: 'app-notifications__status xxd-text', 'data-variant': 'secondary' }, `通知加载失败：${error.message}`))
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
      Xxd.toast(error.message, { tone: 'danger', within: this.panel })
    }
  }
}

function wireNotificationBell() {
  const bell = document.querySelector('[data-notification-bell]')
  const panel = document.getElementById('notification-panel')
  if (bell && panel) new NotificationBell(bell, panel).refresh()
}

wireSignOut()
wireWorkspaceSwitcher()
wireNotificationBell()
