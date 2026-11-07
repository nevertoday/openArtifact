// Helpers shared by the page scripts. Text from people and agents is only ever set through textContent.
// Toasts, copy buttons, menus, tabs and dialogs come from the UI kit's global `Xxd`.
import { dateText, dayText, fullTimeText, relativeTimeText } from './time-text.js'

/** The page language's messages, which PageShell preloads; every page script words itself with them. */
export const m = (await import(`./i18n/${document.documentElement.lang}.js`)).default

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

/**
 * What to tell a person about a failed call, in the page language; use it for every toast, banner and field error,
 * since `error.message` stays in English for agents. When `error.field` names a field on the page, show it under that field.
 */
export function userMessageOf(error) {
  const known = error instanceof ApiError && Object.hasOwn(m.client.errors, error.code)
  if (!known) return m.client.errorFallback
  const message = m.client.errors[error.code]
  return typeof message === 'function' ? message(error) : message
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

/** A kit icon built in the browser; it is decoration, so screen readers skip it. */
export function icon(name, size = 16) {
  const template = document.createElement('template')
  template.innerHTML = XxdIcons.iconSVG(name, { size })
  return template.content.firstElementChild
}

/**
 * Sends a form once per submit, however it was submitted (the button, Enter, or ⌘↵ through requestSubmit): its
 * submit button turns busy at once and a second submit waits for the first. `send` shows its own failures to people;
 * anything it lets escape is a bug and goes to the console.
 */
export function submitOnce(form, send) {
  form.addEventListener('submit', event => {
    if (event.target !== form) return
    event.preventDefault()
    const submitButton = event.submitter ?? [...form.elements].find(control => control.type === 'submit')
    Xxd.runBusy(submitButton, send).catch(reportError)
  })
}

export function readJsonData(elementId) {
  const dataElement = document.getElementById(elementId)
  return dataElement ? JSON.parse(dataElement.textContent) : null
}

/** The words alone; prefer timeElement, which also carries the full time on hover. */
export function timeAgo(timestamp) {
  return relativeTimeText(m.time, timestamp, Date.now())
}

/** <time> reading how long ago, with the full time on hover. */
export function timeElement(timestamp) {
  return element('time', { datetime: new Date(timestamp).toISOString(), title: fullTimeText(timestamp), 'data-relative': true }, timeAgo(timestamp))
}

/** Re-renders the server's <time data-relative> and <time data-day> under `root` in the reader's time zone, which decides yesterday and the date. */
export function renderServerTimes(root = document) {
  for (const timeTag of root.querySelectorAll('time[data-relative], time[data-day]')) {
    const timestamp = Date.parse(timeTag.dateTime)
    timeTag.textContent = timeTag.hasAttribute('data-day') ? dayText(m.time, timestamp) : timeAgo(timestamp)
    timeTag.title = fullTimeText(timestamp)
  }
}

/** The words for removing an artifact: taking it down as an admin, or deleting it as its author. */
export function removalText(takesDown) {
  return takesDown ? m.client.removal.takeDown : m.client.removal.delete
}

export function removalWord(takesDown) {
  return removalText(takesDown).word
}

/** Asks before removing an artifact; the kit puts Cancel first and the danger action last. */
export function confirmArtifactRemoval(title, takesDown) {
  const removal = removalText(takesDown)
  return Xxd.confirmDialog({
    title: removal.confirmTitle(title),
    message: removal.confirmMessage,
    confirmLabel: removal.word,
    cancelLabel: m.client.dialog.cancel,
    closeLabel: m.client.dialog.close,
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
      this.list.replaceChildren(element('p', { className: 'app-notifications__status xxd-text', 'data-variant': 'secondary' }, m.client.notifications.loadFailed(userMessageOf(error))))
    }
  }

  render() {
    const unreadCount = this.notifications.filter(notification => !notification.read).length
    this.unreadCount.hidden = unreadCount === 0
    this.unreadCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount)
    this.bell.setAttribute('aria-label', unreadCount === 0 ? m.shell.notifications : m.client.notifications.bellUnread(unreadCount))
    this.markAllButton.hidden = unreadCount === 0
    if (this.notifications.length === 0) {
      this.list.replaceChildren(element('div', { className: 'xxd-empty', 'data-size': 'sm' },
        element('p', { className: 'xxd-empty__title' }, m.client.notifications.emptyTitle),
        element('p', { className: 'xxd-empty__text' }, m.client.notifications.emptyText)))
      return
    }
    this.list.replaceChildren(element('ul', { className: 'xxd-list app-notifications__list', 'data-interactive': true }, this.notifications.map(notification => this.#item(notification))))
  }

  #item(notification) {
    // The dot shows unread to the eye; a screen reader hears it at the start of the sentence instead.
    const link = element('a', { className: 'xxd-list__main', href: notification.url, onClick: event => this.#open(event, notification) },
      element('span', { className: 'xxd-list__title app-notifications__text' }, notification.read ? null : element('span', { className: 'xxd-sr-only' }, m.client.notifications.unreadPrefix), notification.text),
      element('span', { className: 'xxd-list__meta' }, timeElement(notification.createdAt)))
    const marker = element('span', { className: 'app-notifications__marker', 'aria-hidden': 'true' }, notification.read ? null : element('span', { className: 'xxd-dot', 'data-tone': 'action' }))
    return element('li', { className: 'xxd-list__item', 'data-unread': !notification.read }, marker, link)
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

renderServerTimes()
wireSignOut()
wireWorkspaceSwitcher()
wireNotificationBell()
