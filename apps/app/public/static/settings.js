import { api, confirmArtifactRemoval, element, readJsonData, removalWord, removeArtifact, restoreArtifact, dateText, timeElement } from './common.js'

const settingsConfig = readJsonData('settings-config')
const TOKEN_SCOPE_LABELS = { publish: '仅发布', full: '完全权限' }

function secondaryText(text) {
  return element('span', { className: 'xxd-text', 'data-variant': 'secondary' }, text)
}

const POLL_INTERVAL_MS = 5000
const JUST_CREATED_HIGHLIGHT_MS = 2500

function tokenStateOf(accessToken) {
  if (accessToken.revokedAt) return { label: '已撤销', tone: undefined, isActive: false }
  if (accessToken.expiresAt && accessToken.expiresAt <= Date.now()) return { label: '已过期', tone: 'warning', isActive: false }
  return { label: '有效', tone: 'success', isActive: true }
}

// One entry per column, so a new column is one line here; the label also heads the cell on a phone.
const TOKEN_COLUMNS = [
  { label: '名称', cell: accessToken => accessToken.name },
  { label: '权限', cell: accessToken => secondaryText(TOKEN_SCOPE_LABELS[accessToken.scope]) },
  { label: '最近使用', cell: accessToken => secondaryText(accessToken.lastUsedAt ? timeElement(accessToken.lastUsedAt) : '还没用过') },
  { label: '到期', cell: accessToken => secondaryText(accessToken.expiresAt ? dateText(accessToken.expiresAt) : '永不过期') },
  {
    label: '状态',
    cell: accessToken => {
      const state = tokenStateOf(accessToken)
      return element('span', { className: 'xxd-badge', 'data-appearance': 'dot', 'data-tone': state.tone }, state.label)
    },
  },
]

/** The person's tokens: working ones in a table, revoked and expired ones folded away below it. */
class TokenTable {
  #onRevoked

  constructor(container, { onRevoked }) {
    this.container = container
    this.#onRevoked = onRevoked
  }

  render(accessTokens, justCreatedTokenId = null) {
    if (accessTokens.length === 0) {
      this.container.replaceChildren(secondaryText('还没有 token。'))
      return
    }
    const activeTokens = accessTokens.filter(accessToken => tokenStateOf(accessToken).isActive)
    const inactiveTokens = accessTokens.filter(accessToken => !tokenStateOf(accessToken).isActive)
    const inactiveFold = element('details', { className: 'xxd-collapse' }, element('summary', {}, `显示已失效的 token（${inactiveTokens.length}）`), this.#table(inactiveTokens, null))
    this.container.replaceChildren(
      activeTokens.length > 0 ? this.#table(activeTokens, justCreatedTokenId) : secondaryText('没有有效的 token。'),
      inactiveTokens.length > 0 ? inactiveFold : null,
    )
  }

  async refresh(justCreatedTokenId = null) {
    const { tokens } = await api('/api/tokens')
    this.render(tokens, justCreatedTokenId)
    if (justCreatedTokenId !== null) setTimeout(() => this.container.querySelector('[data-just-created]')?.removeAttribute('data-just-created'), JUST_CREATED_HIGHLIGHT_MS)
  }

  #table(accessTokens, justCreatedTokenId) {
    const actionsHeader = element('th', { className: 'xxd-table__actions' }, element('span', { className: 'xxd-sr-only' }, '操作'))
    return element('div', { className: 'xxd-table-wrap' }, element('table', { className: 'xxd-table token-table' },
      element('thead', {}, element('tr', {}, TOKEN_COLUMNS.map(column => element('th', {}, column.label)), actionsHeader)),
      element('tbody', {}, accessTokens.map(accessToken => this.#row(accessToken, accessToken.tokenId === justCreatedTokenId))),
    ))
  }

  #row(accessToken, justCreated) {
    const revokeButton = element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'xs', onClick: () => this.#revoke(accessToken) }, '撤销')
    return element('tr', { 'data-just-created': justCreated },
      TOKEN_COLUMNS.map(column => element('td', { 'data-label': column.label }, column.cell(accessToken))),
      element('td', { className: 'xxd-table__actions' }, tokenStateOf(accessToken).isActive ? revokeButton : null),
    )
  }

  async #revoke(accessToken) {
    const confirmed = await Xxd.confirmDialog({
      title: `撤销「${accessToken.name}」？`,
      message: '用这个 token 的 agent 会立即失去访问权限。撤销后不能恢复，只能新建一个。',
      confirmLabel: '撤销',
      cancelLabel: '取消',
      closeLabel: '关闭',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await api(`/api/tokens/${encodeURIComponent(accessToken.tokenId)}`, { method: 'DELETE' })
      Xxd.toast(`已撤销「${accessToken.name}」`, { tone: 'success' })
      this.#onRevoked(accessToken.tokenId)
      await this.refresh()
      this.container.focus()
    } catch (error) {
      Xxd.toast(error.message, { tone: 'danger' })
    }
  }
}

/** The person's newest page published through an agent since `since`, or undefined. */
function pagePublishedByAgentSince(artifacts, authorId, since) {
  const publishedByAgent = artifacts.filter(artifact => artifact.author.userId === authorId && artifact.publishedVia !== null && artifact.updatedAt >= since)
  return publishedByAgent.sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

/**
 * The token created on this page: its value fills every snippet, and the page watches until the agent using it
 * publishes. The value lives only here, so leaving the page loses it.
 */
class AgentConnection {
  #createdToken = null
  #pollTimer = null
  #setupStep = document.getElementById('connect-setup')
  #checkStep = document.getElementById('connect-check')
  #status = document.getElementById('connect-status')

  constructor() {
    document.addEventListener('visibilitychange', () => this.#checkWhileVisible())
  }

  show(createdToken) {
    this.#createdToken = createdToken
    this.#fillToken(createdToken.token)
    this.#setupStep.querySelector('[data-token-name]').textContent = createdToken.name
    this.#setupStep.hidden = false
    this.#checkStep.hidden = false
    this.#showStatus(AgentConnection.#waiting('等 agent 连上…'))
    this.#stopWatching()
    this.#pollTimer = setInterval(() => this.#checkWhileVisible(), POLL_INTERVAL_MS)
    this.#setupStep.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** A revoked token must not stay on screen as if it still worked. */
  forget(tokenId) {
    if (this.#createdToken?.tokenId !== tokenId) return
    this.#createdToken = null
    this.#stopWatching()
    this.#fillToken('')
    this.#setupStep.hidden = true
    this.#checkStep.hidden = true
  }

  #fillToken(tokenValue) {
    for (const tokenSlot of document.querySelectorAll('[data-token-slot]')) tokenSlot.textContent = tokenValue
  }

  #stopWatching() {
    clearInterval(this.#pollTimer)
    this.#pollTimer = null
  }

  async #checkWhileVisible() {
    const watching = this.#pollTimer !== null && document.visibilityState === 'visible'
    if (!watching) return
    try {
      await this.#check(this.#createdToken)
    } catch (error) {
      console.error(new Error('could not check whether the agent connected', { cause: error }))
    }
  }

  // The token's first use says the agent connected; a page by this person, published through an agent since the token was made, says it works.
  async #check(watchedToken) {
    const { tokens } = await api('/api/tokens')
    const tokenNow = tokens.find(accessToken => accessToken.tokenId === watchedToken.tokenId)
    if (!tokenNow?.lastUsedAt) return
    const { artifacts } = await api('/api/artifacts')
    const firstPage = pagePublishedByAgentSince(artifacts, settingsConfig.userId, watchedToken.createdAt)
    const stillWatched = watchedToken === this.#createdToken
    if (!stillWatched) return
    if (!firstPage) {
      this.#showStatus(AgentConnection.#waiting('agent 已经连上了，等它发布测试页…'))
      return
    }
    this.#stopWatching()
    this.#showStatus(AgentConnection.#connected(firstPage))
  }

  #showStatus(statusElement) {
    this.#status.replaceChildren(statusElement)
  }

  static #waiting(text) {
    return element('p', { className: 'xxd-cluster xxd-text', 'data-variant': 'secondary' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), text)
  }

  static #connected(firstPage) {
    return element('div', { className: 'xxd-banner', 'data-tone': 'success' },
      element('div', {}, element('p', { className: 'xxd-banner__title' }, `连上了：${firstPage.publishedVia} 刚刚发布了「${firstPage.title}」`)),
      element('div', { className: 'xxd-banner__actions' }, element('a', { className: 'xxd-btn', 'data-size': 'sm', href: `/a/${encodeURIComponent(firstPage.artifactId)}` }, '打开')),
    )
  }
}

function expiresInDaysOf(expiryChoice) {
  return expiryChoice === 'never' ? null : Number(expiryChoice)
}

function wireAgentConnection() {
  const tokenTableContainer = document.getElementById('token-table')
  if (!tokenTableContainer) return
  const agentConnection = new AgentConnection()
  const tokenTable = new TokenTable(tokenTableContainer, { onRevoked: tokenId => agentConnection.forget(tokenId) })
  tokenTableContainer.tabIndex = -1
  tokenTable.render(settingsConfig.accessTokens)

  // Submitted once: the button stays busy and disabled until the token exists, so a double click cannot make two.
  const createForm = document.getElementById('create-token-form')
  const createButton = createForm.querySelector('[type="submit"]')
  createForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (createButton.disabled) return
    const formData = new FormData(createForm)
    const newToken = { name: formData.get('name'), scope: formData.get('scope'), expiresInDays: expiresInDaysOf(formData.get('expiresInDays')) }
    createButton.disabled = true
    try {
      const createdToken = await Xxd.runBusy(createButton, () => api('/api/tokens', { method: 'POST', body: newToken }))
      createForm.reset()
      agentConnection.show(createdToken)
      await tokenTable.refresh(createdToken.tokenId)
    } catch (error) {
      Xxd.toast(`新建失败：${error.message}`, { tone: 'danger' })
    } finally {
      createButton.disabled = false
    }
  })
}

function wireProfileForm() {
  const profileForm = document.getElementById('profile-form')
  profileForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const saveButton = event.submitter
    saveButton.setAttribute('aria-busy', 'true')
    try {
      await api('/api/me', { method: 'PATCH', body: { name: new FormData(profileForm).get('name') } })
      Xxd.toast('已保存', { tone: 'success' })
    } catch (error) {
      Xxd.toast(`保存失败：${error.message}`, { tone: 'danger' })
    } finally {
      saveButton.removeAttribute('aria-busy')
    }
  })
}

function wireWorkspaceNameForm() {
  const workspaceNameForm = document.getElementById('workspace-name-form')
  workspaceNameForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const saveButton = event.submitter
    saveButton.disabled = true
    saveButton.setAttribute('aria-busy', 'true')
    try {
      await api('/api/workspace', { method: 'PATCH', body: { name: new FormData(workspaceNameForm).get('name') } })
      location.reload()
    } catch (error) {
      Xxd.setFieldError(document.getElementById('workspace-name'), error.message)
      saveButton.disabled = false
      saveButton.removeAttribute('aria-busy')
    }
  })
}

// Everyone outside the workspace who holds one of those links loses the page at once, so it asks first.
function confirmPublicLinksOff(publicLinkCount) {
  if (publicLinkCount === 0) return Promise.resolve(true)
  return Xxd.confirmDialog({
    title: '关闭公开链接？',
    message: `关闭后，${publicLinkCount} 个公开链接立即失效。`,
    confirmLabel: '关闭公开链接',
    cancelLabel: '取消',
    closeLabel: '关闭',
    tone: 'danger',
  })
}

function wirePublicLinksSwitch() {
  const publicLinksSwitch = document.getElementById('public-links-enabled')
  publicLinksSwitch?.addEventListener('change', async () => {
    const turningOff = !publicLinksSwitch.checked
    const confirmed = turningOff ? await confirmPublicLinksOff(Number(publicLinksSwitch.dataset.publicLinkCount)) : true
    if (!confirmed) {
      publicLinksSwitch.checked = true
      return
    }
    try {
      await api('/api/workspace', { method: 'PATCH', body: { publicLinksEnabled: publicLinksSwitch.checked } })
      Xxd.toast(publicLinksSwitch.checked ? '已允许公开链接' : '已关闭公开链接', { tone: 'success' })
    } catch (error) {
      publicLinksSwitch.checked = !publicLinksSwitch.checked
      Xxd.toast(error.message, { tone: 'danger' })
    }
  })
}

function wireMemberAdministration() {
  for (const roleSelect of document.querySelectorAll('[data-member-role]')) {
    let savedRole = roleSelect.value
    roleSelect.addEventListener('change', async () => {
      const memberName = roleSelect.dataset.name
      try {
        await api(`/api/workspace/members/${encodeURIComponent(roleSelect.dataset.memberRole)}`, { method: 'PATCH', body: { role: roleSelect.value } })
        savedRole = roleSelect.value
        Xxd.toast(`已把 ${memberName} 设为${roleSelect.selectedOptions[0].textContent}`, { tone: 'success' })
      } catch (error) {
        roleSelect.value = savedRole
        Xxd.toast(`修改角色失败：${error.message}`, { tone: 'danger' })
      }
    })
  }
  for (const removeButton of document.querySelectorAll('[data-remove-member]')) {
    removeButton.addEventListener('click', () => removeMember(removeButton))
  }
}

async function removeMember(removeButton) {
  const memberName = removeButton.dataset.name
  const confirmed = await Xxd.confirmDialog({
    title: `移除 ${memberName}？`,
    message: 'TA 会立即失去访问权限，个人 API token 也会被撤销，再次登录也不会自动加入，除非你用邮箱重新邀请 TA。TA 发布的 artifact 会留在 workspace 里。',
    confirmLabel: '移除',
    cancelLabel: '取消',
    closeLabel: '关闭',
    tone: 'danger',
  })
  if (!confirmed) return
  try {
    await api(`/api/workspace/members/${encodeURIComponent(removeButton.dataset.removeMember)}`, { method: 'DELETE' })
    removeButton.closest('tr')?.remove()
    Xxd.toast(`已移除 ${memberName}`, { tone: 'success' })
  } catch (error) {
    Xxd.toast(`移除失败：${error.message}`, { tone: 'danger' })
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The admin's pending invites: links anyone may use, and addresses that have not joined yet. */
class PendingInvites {
  constructor(container) {
    this.container = container
  }

  async refresh() {
    const { invites } = await api('/api/workspace/invites')
    this.render(invites)
  }

  render(invites) {
    if (invites.length === 0) {
      this.container.replaceChildren(secondaryText('没有待接受的邀请。'))
      return
    }
    this.container.replaceChildren(
      element('h3', { className: 'xxd-text', 'data-variant': 'body' }, `待接受的邀请（${invites.length}）`),
      element('ul', { className: 'xxd-list' }, invites.map(invite => this.#item(invite))),
    )
  }

  #item(invite) {
    const subject = invite.email ?? '邀请链接 · 任何人可用'
    const expiry = dateText(invite.expiresAt)
    return element('li', { className: 'xxd-list__item' },
      element('span', { className: 'xxd-list__main' },
        element('span', { className: 'xxd-list__title' }, subject),
        element('span', { className: 'xxd-list__meta' }, `${invite.invitedBy.name} 邀请 · ${expiry} 到期`),
      ),
      element('span', { className: 'xxd-cluster invite-actions' },
        element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'xs', 'data-copy': invite.url, 'data-copy-done': '已复制邀请链接' }, '复制链接'),
        element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'xs', onClick: () => this.#revoke(invite, subject) }, '撤销'),
      ),
    )
  }

  async #revoke(invite, subject) {
    try {
      await api(`/api/workspace/invites/${encodeURIComponent(invite.inviteId)}`, { method: 'DELETE' })
      Xxd.toast(`已撤销「${subject}」`, { tone: 'success' })
      await this.refresh()
    } catch (error) {
      Xxd.toast(`撤销失败：${error.message}`, { tone: 'danger' })
    }
  }
}

function emailsIn(text) {
  return text.split(/[\s,，;；]+/).filter(email => email.length > 0)
}

function wireInvites() {
  const pendingContainer = document.getElementById('pending-invites')
  if (!pendingContainer) return
  const pendingInvites = new PendingInvites(pendingContainer)
  pendingInvites.refresh().catch(error => Xxd.toast(`读取邀请失败：${error.message}`, { tone: 'danger' }))

  const linkButton = document.getElementById('create-invite-link')
  linkButton.addEventListener('click', async () => {
    linkButton.disabled = true
    try {
      await Xxd.runBusy(linkButton, () => api('/api/workspace/invites/link', { method: 'POST' }))
      Xxd.toast('已生成邀请链接。点「复制链接」发给同事。', { tone: 'success' })
      await pendingInvites.refresh()
    } catch (error) {
      Xxd.toast(`生成失败：${error.message}`, { tone: 'danger' })
    } finally {
      linkButton.disabled = false
    }
  })

  const emailForm = document.getElementById('invite-email-form')
  const emailsInput = document.getElementById('invite-emails')
  emailForm.addEventListener('submit', async event => {
    event.preventDefault()
    const emails = emailsIn(emailsInput.value)
    const malformedEmail = emails.find(email => !EMAIL_SHAPE.test(email))
    if (emails.length === 0) return Xxd.setFieldError(emailsInput, '填一个或多个邮箱')
    if (malformedEmail) return Xxd.setFieldError(emailsInput, `「${malformedEmail}」不是邮箱地址`)
    Xxd.setFieldError(emailsInput, '')
    const sendButton = event.submitter
    sendButton.disabled = true
    try {
      const { invites, alreadyMembers } = await Xxd.runBusy(sendButton, () => api('/api/workspace/invites/email', { method: 'POST', body: { emails } }))
      emailForm.reset()
      Xxd.toast(invitationSummary(invites.length, alreadyMembers), { tone: 'success' })
      await pendingInvites.refresh()
    } catch (error) {
      Xxd.setFieldError(emailsInput, error.message)
    } finally {
      sendButton.disabled = false
    }
  })
}

function invitationSummary(invitedCount, alreadyMembers) {
  const invited = invitedCount > 0 ? `已邀请 ${invitedCount} 人。` : ''
  const skipped = alreadyMembers.length > 0 ? `${alreadyMembers.join('、')} 已经是成员。` : ''
  return invited + skipped
}

// The table and the audit log below it both change, so the page reloads after each action.
function wireContentAdministration() {
  for (const removeButton of document.querySelectorAll('[data-remove-artifact]')) {
    removeButton.addEventListener('click', async () => {
      const takesDown = 'takesDown' in removeButton.dataset
      const confirmed = await confirmArtifactRemoval(removeButton.dataset.title, takesDown)
      if (!confirmed) return
      try {
        await removeArtifact(removeButton.dataset.removeArtifact)
        location.reload()
      } catch (error) {
        Xxd.toast(`${removalWord(takesDown)}失败：${error.message}`, { tone: 'danger' })
      }
    })
  }
  for (const restoreButton of document.querySelectorAll('[data-restore-artifact]')) {
    restoreButton.addEventListener('click', async () => {
      try {
        await restoreArtifact(restoreButton.dataset.restoreArtifact)
        location.reload()
      } catch (error) {
        Xxd.toast(`恢复失败：${error.message}`, { tone: 'danger' })
      }
    })
  }
}

wireAgentConnection()
wireProfileForm()
wireWorkspaceNameForm()
wirePublicLinksSwitch()
wireMemberAdministration()
wireInvites()
wireContentAdministration()
