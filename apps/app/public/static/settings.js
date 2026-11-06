import { api, confirmArtifactRemoval, element, readJsonData, removalWord, removeArtifact, restoreArtifact, timeAgo } from './common.js'

const settingsConfig = readJsonData('settings-config')

function secondaryText(text) {
  return element('span', { className: 'xxd-text', 'data-variant': 'secondary' }, text)
}

class TokenTable {
  constructor(container) {
    this.container = container
  }

  render(accessTokens) {
    if (accessTokens.length === 0) {
      this.container.replaceChildren(element('div', { className: 'xxd-empty', 'data-size': 'sm' },
        element('p', { className: 'xxd-empty__title' }, '还没有 token。新建一个，填进 agent 的 MCP 配置。')))
      return
    }
    this.container.replaceChildren(element('div', { className: 'xxd-table-wrap' }, element('table', { className: 'xxd-table' },
      element('thead', {}, element('tr', {}, element('th', {}, '名称'), element('th', {}, '最近使用'), element('th', {}, '过期'), element('th', {}, '状态'), element('th', { className: 'xxd-table__actions' }, element('span', { className: 'xxd-sr-only' }, '操作')))),
      element('tbody', {}, accessTokens.map(accessToken => this.#row(accessToken))),
    )))
  }

  async refresh() {
    const { tokens } = await api('/api/tokens')
    this.render(tokens)
  }

  #row(accessToken) {
    const state = TokenTable.#stateOf(accessToken)
    return element('tr', {},
      element('td', {}, accessToken.name),
      element('td', {}, secondaryText(accessToken.lastUsedAt ? timeAgo(accessToken.lastUsedAt) : '从未')),
      element('td', {}, secondaryText(accessToken.expiresAt ? new Date(accessToken.expiresAt).toLocaleDateString('zh-CN') : '永不')),
      element('td', {}, element('span', { className: 'xxd-badge', 'data-appearance': 'dot', 'data-tone': state.tone }, state.label)),
      element('td', { className: 'xxd-table__actions' }, state.isActive
        ? element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'xs', onClick: () => this.#revoke(accessToken) }, '撤销')
        : null),
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
      await this.refresh()
    } catch (error) {
      Xxd.toast(error.message, { tone: 'danger' })
    }
  }

  static #stateOf(accessToken) {
    if (accessToken.revokedAt) return { label: '已撤销', tone: undefined, isActive: false }
    if (accessToken.expiresAt && accessToken.expiresAt <= Date.now()) return { label: '已过期', tone: 'warning', isActive: false }
    return { label: '有效', tone: 'success', isActive: true }
  }
}

function wireTokenCreation(tokenTable) {
  const createForm = document.getElementById('create-token-form')
  const reveal = document.getElementById('token-reveal')
  createForm.addEventListener('submit', async event => {
    event.preventDefault()
    const formData = new FormData(createForm)
    const expiryChoice = formData.get('expiresInDays')
    try {
      const createdToken = await api('/api/tokens', { method: 'POST', body: { name: formData.get('name'), expiresInDays: expiryChoice === 'never' ? null : Number(expiryChoice) } })
      reveal.querySelector('[data-token-reveal-title]').textContent = `「${createdToken.name}」已创建。这个 token 只显示这一次，请现在复制。`
      reveal.querySelector('[data-token-value]').textContent = createdToken.token
      reveal.hidden = false
      createForm.reset()
      await tokenTable.refresh()
    } catch (error) {
      Xxd.toast(`创建失败：${error.message}`, { tone: 'danger' })
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
    const expiry = new Date(invite.expiresAt).toLocaleDateString('zh-CN')
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

const tokenTableContainer = document.getElementById('token-table')
if (tokenTableContainer) {
  const tokenTable = new TokenTable(tokenTableContainer)
  tokenTable.render(settingsConfig.accessTokens)
  wireTokenCreation(tokenTable)
}
wireProfileForm()
wireWorkspaceNameForm()
wirePublicLinksSwitch()
wireMemberAdministration()
wireInvites()
wireContentAdministration()
