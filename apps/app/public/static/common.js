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

wireSignOut()
wireWorkspaceSwitcher()
