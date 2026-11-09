import { avatarStyle } from './avatar.js'
import { api, confirmArtifactRemoval, element, initialOf, m, readJsonData, removalText, removeArtifact, restoreArtifact, dateText, timeElement, userMessageOf } from './common.js'

const settingsConfig = readJsonData('settings-config')
const tokenText = m.client.settings.tokens

function secondaryText(text) {
  return element('span', { className: 'xxd-text', 'data-variant': 'secondary' }, text)
}

const POLL_INTERVAL_MS = 5000
const JUST_CREATED_HIGHLIGHT_MS = 2500

function tokenStateOf(accessToken) {
  if (accessToken.revokedAt) return { label: tokenText.states.revoked, tone: undefined, isActive: false }
  if (accessToken.expiresAt && accessToken.expiresAt <= Date.now()) return { label: tokenText.states.expired, tone: 'warning', isActive: false }
  return { label: tokenText.states.active, tone: 'success', isActive: true }
}

// One entry per column, so a new column is one line here; the label also heads the cell on a phone.
const TOKEN_COLUMNS = [
  { label: tokenText.columns.name, cell: accessToken => accessToken.name },
  { label: tokenText.columns.scope, cell: accessToken => secondaryText(tokenText.scopes[accessToken.scope]) },
  { label: tokenText.columns.lastUsed, cell: accessToken => secondaryText(accessToken.lastUsedAt ? timeElement(accessToken.lastUsedAt) : tokenText.neverUsed) },
  { label: tokenText.columns.expires, cell: accessToken => secondaryText(accessToken.expiresAt ? dateText(accessToken.expiresAt) : tokenText.neverExpires) },
  {
    label: tokenText.columns.state,
    cell: accessToken => {
      const state = tokenStateOf(accessToken)
      return element('span', { className: 'xxd-badge', 'data-appearance': 'dot', 'data-tone': state.tone, 'data-token-state': accessToken.tokenId, tabindex: '-1' }, state.label)
    },
  },
]

/**
 * The person's tokens: working ones in a table, revoked and expired ones folded away below it, each deletable.
 * After a revoke the fold opens and focus lands on that token's new state, so keyboard users see what happened.
 */
class TokenTable {
  #onRevoked

  constructor(container, { onRevoked }) {
    this.container = container
    this.#onRevoked = onRevoked
  }

  render(accessTokens, { justCreatedTokenId = null, showInactive = false } = {}) {
    if (accessTokens.length === 0) {
      this.container.replaceChildren(secondaryText(tokenText.none))
      return
    }
    const activeTokens = accessTokens.filter(accessToken => tokenStateOf(accessToken).isActive)
    const inactiveTokens = accessTokens.filter(accessToken => !tokenStateOf(accessToken).isActive)
    const inactiveFold = element('details', { className: 'xxd-collapse token-fold', open: showInactive },
      element('summary', {}, tokenText.showInactive(inactiveTokens.length)), this.#table(inactiveTokens, null))
    // replaceChildren writes a null child out as the text "null", so the fold is left out rather than passed as null.
    this.container.replaceChildren(
      activeTokens.length > 0 ? this.#table(activeTokens, justCreatedTokenId) : secondaryText(tokenText.noneActive),
      ...(inactiveTokens.length > 0 ? [inactiveFold] : []),
    )
  }

  async refresh(changes = {}) {
    const { tokens } = await api('/api/tokens')
    this.render(tokens, changes)
    if (changes.justCreatedTokenId) setTimeout(() => this.container.querySelector('[data-just-created]')?.removeAttribute('data-just-created'), JUST_CREATED_HIGHLIGHT_MS)
  }

  #table(accessTokens, justCreatedTokenId) {
    const actionsHeader = element('th', { className: 'xxd-table__actions' }, element('span', { className: 'xxd-sr-only' }, tokenText.actions))
    return element('div', { className: 'xxd-table-wrap' }, element('table', { className: 'xxd-table token-table' },
      element('thead', {}, element('tr', {}, TOKEN_COLUMNS.map(column => element('th', {}, column.label)), actionsHeader)),
      element('tbody', {}, accessTokens.map(accessToken => this.#row(accessToken, accessToken.tokenId === justCreatedTokenId))),
    ))
  }

  #row(accessToken, justCreated) {
    const isActive = tokenStateOf(accessToken).isActive
    const action = isActive
      ? element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'xs', onClick: () => this.#revoke(accessToken) }, tokenText.revoke)
      : element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'xs', 'aria-label': tokenText.deleteLabel(accessToken.name), onClick: event => this.#delete(accessToken, event.currentTarget) }, tokenText.delete)
    return element('tr', { 'data-just-created': justCreated },
      TOKEN_COLUMNS.map(column => element('td', { 'data-label': column.label }, column.cell(accessToken))),
      element('td', { className: 'xxd-table__actions' }, action),
    )
  }

  async #revoke(accessToken) {
    const confirmed = await Xxd.confirmDialog({
      title: tokenText.revokeTitle(accessToken.name),
      message: tokenText.revokeMessage,
      confirmLabel: tokenText.revoke,
      cancelLabel: m.client.dialog.cancel,
      closeLabel: m.client.dialog.close,
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await api(`/api/tokens/${encodeURIComponent(accessToken.tokenId)}`, { method: 'DELETE' })
      Xxd.toast(tokenText.revoked(accessToken.name), { tone: 'success' })
      this.#onRevoked(accessToken.tokenId)
      await this.refresh({ showInactive: true })
      this.container.querySelector(`[data-token-state="${CSS.escape(accessToken.tokenId)}"]`)?.focus()
    } catch (error) {
      Xxd.toast(tokenText.revokeFailed(userMessageOf(error)), { tone: 'danger' })
    }
  }

  // A revoked or expired token no longer works, so deleting it from the list needs no confirmation.
  async #delete(accessToken, deleteButton) {
    try {
      await Xxd.runBusy(deleteButton, () => api(`/api/tokens/${encodeURIComponent(accessToken.tokenId)}`, { method: 'DELETE' }))
      Xxd.toast(tokenText.deleted(accessToken.name), { tone: 'success' })
      await this.refresh({ showInactive: true })
      this.container.focus()
    } catch (error) {
      Xxd.toast(tokenText.deleteFailed(userMessageOf(error)), { tone: 'danger' })
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
  #upcomingSteps = document.querySelector('[data-connect-upcoming]')
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
    this.#upcomingSteps.hidden = true
    this.#showStatus(AgentConnection.#waiting(m.client.settings.connection.waiting))
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
    this.#upcomingSteps.hidden = false
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
      this.#showStatus(AgentConnection.#waiting(m.client.settings.connection.waitingForPage))
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
      element('div', {}, element('p', { className: 'xxd-banner__title' }, m.client.settings.connection.connected({ agent: firstPage.publishedVia, title: firstPage.title }))),
      element('div', { className: 'xxd-banner__actions' }, element('a', { className: 'xxd-btn', 'data-size': 'sm', href: firstPage.url }, m.client.settings.connection.open)),
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
      await tokenTable.refresh({ justCreatedTokenId: createdToken.tokenId })
    } catch (error) {
      Xxd.toast(tokenText.createFailed(userMessageOf(error)), { tone: 'danger' })
    } finally {
      createButton.disabled = false
    }
  })
}

/** Shows a failed save under the field it concerns, in the page language. */
function showFieldError(input, error) {
  Xxd.setFieldError(input, userMessageOf(error))
  input.focus()
}

// Save stays off until the name differs from the saved one; after saving, the top bar shows the new name at once.
function wireProfileForm() {
  const profileForm = document.getElementById('profile-form')
  if (!profileForm) return
  const nameInput = document.getElementById('profile-name')
  const saveButton = profileForm.querySelector('[type="submit"]')
  let savedName = nameInput.value.trim()
  nameInput.addEventListener('input', () => { saveButton.disabled = nameInput.value.trim() === savedName })
  profileForm.addEventListener('submit', async event => {
    event.preventDefault()
    const name = nameInput.value.trim()
    nameInput.value = name
    if (name === '') return Xxd.setFieldError(nameInput, nameInput.dataset.errorRequired)
    saveButton.disabled = true
    try {
      await Xxd.runBusy(saveButton, () => api('/api/me', { method: 'PATCH', body: { name } }))
      savedName = name
      showAccountName(name)
      Xxd.toast(m.client.settings.profile.saved, { tone: 'success' })
    } catch (error) {
      saveButton.disabled = false
      showFieldError(nameInput, error)
    }
  })
}

function showAccountName(name) {
  for (const accountName of document.querySelectorAll('[data-account-name]')) accountName.textContent = name
  for (const accountInitial of document.querySelectorAll('[data-account-initial]')) {
    accountInitial.textContent = initialOf(name)
    accountInitial.setAttribute('style', avatarStyle(name))
  }
  document.querySelector('[data-account-button]')?.setAttribute('aria-label', m.shell.accountMenu(name))
}

function wireThemeChoice() {
  const themeInputs = document.querySelectorAll('input[name="theme"]')
  const currentTheme = globalThis.XxdTheme?.read().theme ?? 'system'
  for (const themeInput of themeInputs) {
    themeInput.checked = themeInput.value === currentTheme
    themeInput.addEventListener('change', () => globalThis.XxdTheme?.set({ theme: themeInput.value }))
  }
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
      showFieldError(document.getElementById('workspace-name'), error)
      saveButton.disabled = false
      saveButton.removeAttribute('aria-busy')
    }
  })
}

// Everyone outside the workspace who holds one of those links loses the page at once, so it asks first.
function confirmPublicLinksOff(publicLinkCount) {
  if (publicLinkCount === 0) return Promise.resolve(true)
  return Xxd.confirmDialog({
    title: m.client.settings.publicLinks.offTitle,
    message: m.client.settings.publicLinks.offMessage(publicLinkCount),
    confirmLabel: m.client.settings.publicLinks.offConfirm,
    cancelLabel: m.client.dialog.cancel,
    closeLabel: m.client.dialog.close,
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
      Xxd.toast(publicLinksSwitch.checked ? m.client.settings.publicLinks.allowed : m.client.settings.publicLinks.turnedOff, { tone: 'success' })
    } catch (error) {
      publicLinksSwitch.checked = !publicLinksSwitch.checked
      Xxd.toast(userMessageOf(error), { tone: 'danger' })
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
        Xxd.toast(m.client.settings.members.roleChanged({ name: memberName, role: roleSelect.selectedOptions[0].textContent }), { tone: 'success' })
      } catch (error) {
        roleSelect.value = savedRole
        Xxd.toast(m.client.settings.members.roleChangeFailed(userMessageOf(error)), { tone: 'danger' })
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
    title: m.client.settings.members.removeTitle(memberName),
    message: m.client.settings.members.removeMessage,
    confirmLabel: m.client.settings.members.remove,
    cancelLabel: m.client.dialog.cancel,
    closeLabel: m.client.dialog.close,
    tone: 'danger',
  })
  if (!confirmed) return
  try {
    await api(`/api/workspace/members/${encodeURIComponent(removeButton.dataset.removeMember)}`, { method: 'DELETE' })
    removeButton.closest('tr')?.remove()
    Xxd.toast(m.client.settings.members.removed(memberName), { tone: 'success' })
  } catch (error) {
    Xxd.toast(m.client.settings.members.removeFailed(userMessageOf(error)), { tone: 'danger' })
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
      this.container.replaceChildren(secondaryText(m.client.settings.invites.none))
      return
    }
    this.container.replaceChildren(
      element('h3', { className: 'xxd-text', 'data-variant': 'body' }, m.client.settings.invites.heading(invites.length)),
      element('ul', { className: 'xxd-list' }, invites.map(invite => this.#item(invite))),
    )
  }

  #item(invite) {
    const subject = invite.email ?? m.client.settings.invites.anyoneLink
    const expiry = invite.expiresAt === null ? null : dateText(invite.expiresAt)
    return element('li', { className: 'xxd-list__item' },
      element('span', { className: 'xxd-list__main' },
        element('span', { className: 'xxd-list__title' }, subject),
        element('span', { className: 'xxd-list__meta' }, m.client.settings.invites.meta({ inviter: invite.invitedBy.name, expiry })),
      ),
      element('span', { className: 'xxd-cluster invite-actions' },
        element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'xs', 'data-copy': invite.url, 'data-copy-done': m.client.settings.invites.copyDone }, m.client.settings.invites.copy),
        element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'xs', onClick: () => this.#revoke(invite, subject) }, m.client.settings.invites.revoke),
      ),
    )
  }

  async #revoke(invite, subject) {
    try {
      await api(`/api/workspace/invites/${encodeURIComponent(invite.inviteId)}`, { method: 'DELETE' })
      Xxd.toast(m.client.settings.invites.revoked(subject), { tone: 'success' })
      await this.refresh()
    } catch (error) {
      Xxd.toast(m.client.settings.invites.revokeFailed(userMessageOf(error)), { tone: 'danger' })
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
  pendingInvites.refresh().catch(error => Xxd.toast(m.client.settings.invites.loadFailed(userMessageOf(error)), { tone: 'danger' }))

  const linkButton = document.getElementById('create-invite-link')
  linkButton.addEventListener('click', async () => {
    linkButton.disabled = true
    try {
      const chosenExpiry = document.getElementById('invite-link-expiry').value
      const expiresInDays = chosenExpiry === 'never' ? null : Number(chosenExpiry)
      await Xxd.runBusy(linkButton, () => api('/api/workspace/invites/link', { method: 'POST', body: { expiresInDays } }))
      Xxd.toast(m.client.settings.invites.linkCreated, { tone: 'success' })
      await pendingInvites.refresh()
    } catch (error) {
      Xxd.toast(m.client.settings.invites.linkFailed(userMessageOf(error)), { tone: 'danger' })
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
    if (emails.length === 0) return Xxd.setFieldError(emailsInput, m.client.settings.invites.emailsRequired)
    if (malformedEmail) return Xxd.setFieldError(emailsInput, m.client.settings.invites.notAnEmail(malformedEmail))
    Xxd.setFieldError(emailsInput, '')
    const sendButton = event.submitter
    sendButton.disabled = true
    try {
      const { invites, alreadyMembers } = await Xxd.runBusy(sendButton, () => api('/api/workspace/invites/email', { method: 'POST', body: { emails } }))
      emailForm.reset()
      Xxd.toast(m.client.settings.invites.sent({ invitedCount: invites.length, alreadyMembers }), { tone: 'success' })
      await pendingInvites.refresh()
    } catch (error) {
      Xxd.setFieldError(emailsInput, userMessageOf(error))
    } finally {
      sendButton.disabled = false
    }
  })
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
        Xxd.toast(removalText(takesDown).failed(userMessageOf(error)), { tone: 'danger' })
      }
    })
  }
  for (const restoreButton of document.querySelectorAll('[data-restore-artifact]')) {
    restoreButton.addEventListener('click', async () => {
      try {
        await restoreArtifact(restoreButton.dataset.restoreArtifact)
        location.reload()
      } catch (error) {
        Xxd.toast(m.client.restore.failed(userMessageOf(error)), { tone: 'danger' })
      }
    })
  }
}

// Leaving and deleting both end in the personal workspace, which the answer has already switched to.
function wireWorkspaceLifecycle() {
  const { lifecycle } = m.client.settings
  const actions = [
    { button: document.querySelector('[data-leave-workspace]'), title: lifecycle.leaveTitle, message: lifecycle.leaveMessage, label: m.settings.workspace.lifecycle.leave, request: { path: '/api/workspace/leave', method: 'POST' } },
    { button: document.querySelector('[data-delete-workspace]'), title: lifecycle.deleteTitle, message: lifecycle.deleteMessage, label: m.settings.workspace.lifecycle.delete, request: { path: '/api/workspace', method: 'DELETE' } },
  ]
  for (const { button, title, message, label, request } of actions) {
    button?.addEventListener('click', async () => {
      const confirmed = await Xxd.confirmDialog({ title: title(button.dataset.name), message, confirmLabel: label, cancelLabel: m.client.dialog.cancel, closeLabel: m.client.dialog.close, tone: 'danger' })
      if (!confirmed) return
      try {
        await Xxd.runBusy(button, () => api(request.path, { method: request.method }))
        location.href = '/'
      } catch (error) {
        Xxd.toast(lifecycle.failed(userMessageOf(error)), { tone: 'danger' })
      }
    })
  }
}

wireAgentConnection()
wireProfileForm()
wireThemeChoice()
wireWorkspaceNameForm()
wirePublicLinksSwitch()
wireMemberAdministration()
wireInvites()
wireContentAdministration()
wireWorkspaceLifecycle()
