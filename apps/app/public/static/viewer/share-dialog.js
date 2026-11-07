import { api, dateText, element, initialOf, submitOnce, userMessageOf } from '../common.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SHARE_LINK_PREFIX = '#share='
const GRANT_ROLES = [['viewer', '可查看'], ['commenter', '可评论'], ['editor', '可编辑']]

/**
 * Every change made in the share dialog, kept until 保存 sends them in one request. Only what the dialog shows for
 * the chosen visibility counts: the people where the server says they apply, the link settings for 公开链接.
 */
class SharingDraft {
  constructor(saved) {
    this.saved = saved
    this.visibility = saved.visibility
    this.grants = new Map(saved.grants.map(grant => [grant.userId, { ...grant }]))
    // 'current' keeps the saved expiry; '7', '30' or 'never' replaces it on save.
    this.expiryChoice = 'current'
    // 'keep' the saved password, 'remove' it, or 'set' the one typed; without a saved password the field is open.
    this.passwordChange = saved.publicLink.hasPassword ? 'keep' : 'set'
    this.newPassword = ''
    this.anonymousWriteEnabled = saved.publicLink.anonymousWriteEnabled
    this.showsComments = saved.publicLink.showsComments
  }

  /** Whether the people list counts at the chosen level; the server owns that rule and sends the levels. */
  get peopleApply() {
    return this.saved.peopleApplyUnder.includes(this.visibility)
  }

  /** Where everyone may already look, adding someone is about letting them change the page. */
  get roleForNewPerson() {
    return this.visibility === 'specified' ? 'viewer' : 'editor'
  }

  get hasChanges() {
    const visibilityChanged = this.visibility !== this.saved.visibility
    const peopleChanged = this.peopleApply && this.#grantsChanged()
    const publicLinkChanged = this.visibility === 'public_link' && Object.keys(this.#publicLinkChanges()).length > 0
    return visibilityChanged || peopleChanged || publicLinkChanged
  }

  isNewPerson(userId) {
    return !this.saved.grants.some(grant => grant.userId === userId)
  }

  addPerson(person, role) {
    this.grants.set(person.userId, { ...person, role })
  }

  setRole(userId, role) {
    const grant = this.grants.get(userId)
    if (grant) grant.role = role
  }

  removePerson(userId) {
    this.grants.delete(userId)
  }

  /** The PUT body: the complete list of people wherever it counts, and only the link settings that changed. */
  toRequest() {
    const sharingUpdate = { visibility: this.visibility }
    if (this.peopleApply) sharingUpdate.grants = [...this.grants.values()].map(grant => ({ userId: grant.userId, role: grant.role }))
    if (this.visibility === 'public_link') Object.assign(sharingUpdate, this.#publicLinkChanges())
    return sharingUpdate
  }

  #grantsChanged() {
    const savedRoles = new Map(this.saved.grants.map(grant => [grant.userId, grant.role]))
    const samePeopleCount = savedRoles.size === this.grants.size
    const anyRoleDiffers = [...this.grants.values()].some(grant => savedRoles.get(grant.userId) !== grant.role)
    return !samePeopleCount || anyRoleDiffers
  }

  // Leaving the expiry out keeps it, so an author can still save after the link has expired.
  #publicLinkChanges() {
    const changes = {}
    if (this.expiryChoice === 'never') changes.publicLinkExpiresAt = null
    else if (this.expiryChoice !== 'current') changes.publicLinkExpiresAt = Date.now() + Number(this.expiryChoice) * DAY_MS
    switch (this.passwordChange) {
      case 'keep':
        break
      case 'remove':
        changes.publicLinkPassword = null
        break
      case 'set':
        if (this.newPassword) changes.publicLinkPassword = this.newPassword
        break
      default:
        throw new Error(`unknown password change ${this.passwordChange}`)
    }
    if (this.anonymousWriteEnabled !== this.saved.publicLink.anonymousWriteEnabled) changes.anonymousWriteEnabled = this.anonymousWriteEnabled
    if (this.showsComments !== this.saved.publicLink.showsComments) changes.publicLinkShowsComments = this.showsComments
    return changes
  }
}

/** Who can see the artifact and how far its public link reaches; announces "saved" with the new visibility. */
export class ShareDialog extends EventTarget {
  #dialog
  #body
  #saveButton
  #sharingPath
  #visibilityLabels
  #stage
  #draft = null
  #emailToAdd = ''

  constructor(dialog, config, stage) {
    super()
    this.#dialog = dialog
    this.#stage = stage
    this.#body = dialog.querySelector('[data-share-body]')
    this.#saveButton = dialog.querySelector('[data-save-sharing]')
    this.#sharingPath = `/api/artifacts/${encodeURIComponent(config.artifactId)}/sharing`
    this.#visibilityLabels = config.visibilityLabels
    submitOnce(dialog.querySelector('#share-form'), () => this.#save())
    dialog.querySelector('[data-close-share]').addEventListener('click', () => this.#close())
    // Chrome may ignore preventDefault on a dialog's cancel event, so Escape is caught before it becomes one.
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      this.#close()
    })
    dialog.addEventListener('cancel', event => {
      event.preventDefault()
      this.#close()
    })
    dialog.querySelector('[data-copy-link]').dataset.copy = location.origin + location.pathname
    this.showTitle(config.title)
    dialog.querySelector('[data-share-url]').textContent = location.host + location.pathname
  }

  /** A request for access links here with #share=<the member's id>; the link is used once, then cleared. */
  openFromLink() {
    if (!location.hash.startsWith(SHARE_LINK_PREFIX)) return
    const askedBy = decodeURIComponent(location.hash.slice(SHARE_LINK_PREFIX.length))
    history.replaceState(history.state, '', `${location.pathname}${location.search}`)
    this.open({ askedBy })
  }

  showTitle(title) {
    this.#dialog.querySelector('[data-share-subtitle]').textContent = title
  }

  /** Opens the dialog; with `askedBy`, the member who asked for access is filled in, one click from being added. */
  async open({ askedBy = null } = {}) {
    this.#draft = null
    this.#body.replaceChildren(element('p', { className: 'viewer-drawer__status' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), '正在加载…'))
    this.#refreshSaveButton()
    Xxd.openDialog(this.#dialog)
    try {
      this.#draft = new SharingDraft(await api(this.#sharingPath))
      if (askedBy) this.#prepareToAdd(askedBy)
      this.#render()
      if (this.#emailToAdd) this.#dialog.querySelector('.share-grant-form [type="submit"]')?.focus()
      this.#emailToAdd = ''
    } catch (error) {
      this.#body.replaceChildren(element('div', { className: 'xxd-banner', 'data-tone': 'danger', role: 'alert' }, element('p', { className: 'xxd-banner__text' }, userMessageOf(error))))
    }
  }

  // Someone who asked for access can only be added where the list of people counts, so 指定的人 is chosen if needed.
  #prepareToAdd(userId) {
    const member = this.#draft.saved.members.find(candidate => candidate.userId === userId)
    const alreadyAdded = this.#draft.grants.has(userId)
    if (!member || alreadyAdded) return
    if (!this.#draft.peopleApply) this.#draft.visibility = 'specified'
    this.#emailToAdd = member.email
  }

  #render() {
    this.#body.replaceChildren(...[this.#visibilityChoices(), this.#peopleSection(), this.#publicLinkSection()].filter(Boolean))
    this.#refreshSaveButton()
  }

  #refreshSaveButton() {
    this.#saveButton.disabled = !this.#draft?.hasChanges
  }

  async #close() {
    const hasUnsavedChanges = this.#draft?.hasChanges ?? false
    if (hasUnsavedChanges) {
      const discardConfirmed = await Xxd.confirmDialog({
        title: '放弃未保存的修改？',
        message: '分享设置有修改还没有保存。关闭后，这些修改不会生效。',
        confirmLabel: '放弃修改',
        cancelLabel: '取消',
        closeLabel: '关闭',
        tone: 'danger',
      })
      if (!discardConfirmed) return
    }
    Xxd.closeDialog(this.#dialog)
  }

  #visibilityChoices() {
    const choice = (visibility, description) => {
      const isDisabled = visibility === 'public_link' && !this.#draft.saved.publicLink.allowedInWorkspace
      const radio = element('input', { type: 'radio', className: 'xxd-radio', name: 'visibility', id: `visibility-${visibility}`, value: visibility, checked: this.#draft.visibility === visibility, disabled: isDisabled })
      radio.addEventListener('change', () => {
        this.#draft.visibility = visibility
        this.#render()
      })
      return element('label', { className: 'xxd-choice', for: `visibility-${visibility}` }, radio,
        element('span', {}, this.#visibilityLabels[visibility], element('small', {}, isDisabled ? 'workspace 管理员已关闭公开链接' : description)))
    }
    return element('fieldset', { className: 'xxd-choices share-section' }, element('legend', { className: 'share-section__title' }, '谁能看到'),
      choice('private', '只有你自己'),
      choice('specified', '只有你在下面添加的人'),
      choice('workspace', '默认。成员可以查看、评论，也能读写页面里的共享数据'),
      choice('public_link', '拿到链接的人不用登录就能打开，只看到页面本身'),
    )
  }

  #peopleSection() {
    if (!this.#draft.peopleApply) return null
    const emailInput = element('input', { className: 'xxd-input', 'data-size': 'sm', id: 'grant-email', type: 'email', required: true, placeholder: '输入成员邮箱', 'aria-label': '成员邮箱', list: 'workspace-members', value: this.#emailToAdd, 'data-error-type': '请输入有效的邮箱，比如 name@example.com' })
    const roleSelect = ShareDialog.#roleSelect(this.#draft.roleForNewPerson, 'grant-role')
    const addForm = element('form', { className: 'share-grant-form', 'data-xxd-validate': true },
      element('div', { className: 'xxd-field share-grant-form__email' }, emailInput), ShareDialog.#selectBox(roleSelect), element('button', { type: 'submit', className: 'xxd-btn', 'data-size': 'sm' }, '添加'))
    submitOnce(addForm, () => this.#addPerson(emailInput, roleSelect.value))
    const memberOptions = element('datalist', { id: 'workspace-members' }, this.#draft.saved.members.map(member => element('option', { value: member.email }, member.name)))
    const grants = [...this.#draft.grants.values()]
    const peopleList = grants.length > 0
      ? element('ul', { className: 'xxd-list' }, grants.map(grant => this.#personRow(grant)))
      : element('p', { className: 'xxd-text', 'data-variant': 'secondary' }, this.#draft.visibility === 'specified' ? '还没有添加任何人，现在只有你能看到。' : '还没有单独添加任何人。')
    return element('section', { className: 'xxd-stack share-section' },
      element('div', { className: 'xxd-text-pair' },
        element('h3', { className: 'share-section__title' }, '添加的人'),
        element('p', { className: 'xxd-text', 'data-variant': 'caption' }, this.#draft.visibility === 'specified' ? '保存后，新添加的人会收到邮件。可查看：使用页面；可评论：再加评论；可编辑：还能发布新版本。' : '给某个人比其他人更多的权限，比如可编辑：还能发布新版本。保存后，新添加的人会收到邮件。')),
      addForm, memberOptions, peopleList,
    )
  }

  #personRow(grant) {
    const roleSelect = ShareDialog.#roleSelect(grant.role, `grant-role-${grant.userId}`)
    roleSelect.setAttribute('aria-label', `${grant.name} 的权限`)
    roleSelect.addEventListener('change', () => {
      this.#draft.setRole(grant.userId, roleSelect.value)
      this.#refreshSaveButton()
    })
    const unsavedBadge = this.#draft.isNewPerson(grant.userId) ? element('span', { className: 'xxd-badge', 'data-tone': 'action' }, '保存后添加') : null
    return element('li', { className: 'xxd-list__item share-person' },
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'aria-hidden': 'true' }, initialOf(grant.name)),
      element('span', { className: 'xxd-list__main' }, element('span', { className: 'xxd-list__title xxd-cluster' }, grant.name, unsavedBadge), element('span', { className: 'xxd-list__meta' }, grant.email ?? '')),
      ShareDialog.#selectBox(roleSelect),
      element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'sm', onClick: () => { this.#draft.removePerson(grant.userId); this.#render() } }, '移除'),
    )
  }

  static #roleSelect(selectedRole, selectId) {
    return element('select', { id: selectId, 'aria-label': '权限' }, GRANT_ROLES.map(([role, label]) => element('option', { value: role, selected: role === selectedRole }, label)))
  }

  static #selectBox(select) {
    return element('label', { className: 'xxd-select', 'data-size': 'sm' }, select)
  }

  #publicLinkSection() {
    if (this.#draft.visibility !== 'public_link') return null
    const expirySelect = element('select', { id: 'link-expiry' }, this.#expiryOptions())
    expirySelect.addEventListener('change', () => {
      this.#draft.expiryChoice = expirySelect.value
      this.#refreshSaveButton()
    })
    const anonymousWrite = this.#draftSwitch('anonymous-write', 'anonymousWriteEnabled', '允许匿名访客写入共享数据', '适合对外的报名表。')
    const showsComments = this.#draftSwitch('shows-comments', 'showsComments', '对外显示评论', '访客可以看到评论和评论人的名字，但不能发表评论。')
    return element('section', { className: 'xxd-stack share-section' },
      element('div', { className: 'xxd-text-pair' },
        element('h3', { className: 'share-section__title' }, '公开链接'),
        element('p', { className: 'xxd-text', 'data-variant': 'caption' }, '访客只看到最新版本的页面，看不到版本记录和数据。')),
      element('div', { className: 'xxd-layout', 'data-cols': '2up' },
        element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'link-expiry' }, '有效期'), element('label', { className: 'xxd-select' }, expirySelect)),
        element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'link-password', 'data-optional': true }, '访问密码'), this.#passwordControl())),
      anonymousWrite, showsComments,
    )
  }

  // The saved expiry is the selected option, so 永不过期 appears once whichever way the link is set.
  #expiryOptions() {
    const { expiresAt } = this.#draft.saved.publicLink
    const option = (value, label) => element('option', { value, selected: this.#draft.expiryChoice === value }, label)
    if (expiresAt === null) return [option('current', '永不过期'), option('7', '7 天后过期'), option('30', '30 天后过期')]
    const expiryDate = dateText(expiresAt)
    const savedLabel = expiresAt > Date.now() ? `保持 ${expiryDate} 过期` : `已于 ${expiryDate} 过期`
    return [option('current', savedLabel), option('7', '7 天后过期'), option('30', '30 天后过期'), option('never', '永不过期')]
  }

  #passwordControl() {
    const passwordAction = (label, passwordChange) => element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', onClick: () => this.#choosePasswordChange(passwordChange) }, label)
    switch (this.#draft.passwordChange) {
      case 'keep':
        return element('div', { className: 'xxd-cluster share-password' }, element('span', { className: 'xxd-text', id: 'link-password' }, '已设置访问密码'), passwordAction('更改', 'set'), passwordAction('取消密码', 'remove'))
      case 'remove':
        return element('div', { className: 'xxd-cluster share-password' }, element('span', { className: 'xxd-text', id: 'link-password', 'data-variant': 'secondary' }, '保存后取消访问密码'), passwordAction('保留密码', 'keep'))
      case 'set': {
        const { hasPassword } = this.#draft.saved.publicLink
        const passwordInput = element('input', { className: 'xxd-input', id: 'link-password', type: 'password', autocomplete: 'new-password', placeholder: hasPassword ? '输入新密码' : '不设置', value: this.#draft.newPassword })
        passwordInput.addEventListener('input', () => {
          this.#draft.newPassword = passwordInput.value
          this.#refreshSaveButton()
        })
        if (hasPassword) queueMicrotask(() => passwordInput.focus())
        return hasPassword ? element('div', { className: 'xxd-cluster share-password' }, passwordInput, passwordAction('保留原密码', 'keep')) : passwordInput
      }
      default:
        throw new Error(`unknown password change ${this.#draft.passwordChange}`)
    }
  }

  #choosePasswordChange(passwordChange) {
    this.#draft.passwordChange = passwordChange
    this.#draft.newPassword = ''
    this.#render()
  }

  #draftSwitch(inputId, draftField, label, description) {
    const checkbox = element('input', { type: 'checkbox', className: 'xxd-check', id: inputId, checked: this.#draft[draftField] })
    checkbox.addEventListener('change', () => {
      this.#draft[draftField] = checkbox.checked
      this.#refreshSaveButton()
    })
    return element('label', { className: 'xxd-choice', for: inputId }, checkbox, element('span', {}, label, element('small', {}, description)))
  }

  // A person the dialog cannot add is explained under the email field, where the person typed it.
  async #addPerson(emailInput, role) {
    try {
      const person = await api(`${this.#sharingPath}/people?email=${encodeURIComponent(emailInput.value.trim())}`)
      Xxd.setFieldError(emailInput, '')
      this.#draft.addPerson(person, role)
      this.#render()
      this.#dialog.querySelector('#grant-email')?.focus()
    } catch (error) {
      if (error.field === 'email') Xxd.setFieldError(emailInput, userMessageOf(error), { focus: true })
      else Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    }
  }

  async #save() {
    if (!this.#draft?.hasChanges) return
    try {
      const savedSharing = await api(this.#sharingPath, { method: 'PUT', body: this.#draft.toRequest() })
      this.#draft = new SharingDraft(savedSharing)
      Xxd.closeDialog(this.#dialog)
      Xxd.toast('分享设置已保存', { tone: 'success', within: this.#stage })
      this.dispatchEvent(new CustomEvent('saved', { detail: { label: this.#visibilityLabels[savedSharing.visibility] } }))
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    }
  }
}
