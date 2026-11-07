import { api, dateText, element, initialOf, m, submitOnce, userMessageOf } from '../common.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SHARE_LINK_PREFIX = '#share='
const GRANT_ROLES = ['viewer', 'commenter', 'editor']

/**
 * Every change made in the share dialog, kept until saving sends them in one request. Only what the dialog shows for
 * the chosen visibility counts: the people where the server says they apply, the link settings for a public link.
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
    this.listed = saved.publicLink.listed
  }

  /** A page with a password cannot go on the personal page; the server refuses it the same way. */
  get listable() {
    switch (this.passwordChange) {
      case 'keep':
        return !this.saved.publicLink.hasPassword
      case 'remove':
        return true
      case 'set':
        return this.newPassword === ''
      default:
        throw new Error(`unknown password change ${this.passwordChange}`)
    }
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
    const listedNow = this.listed && this.listable
    if (listedNow !== this.saved.publicLink.listed) changes.listed = listedNow
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
    this.#body.replaceChildren(element('p', { className: 'viewer-drawer__status' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), m.viewerClient.share.loading))
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

  // Someone who asked for access can only be added where the list of people counts, so specified people is chosen if needed.
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
        title: m.viewerClient.share.discardTitle,
        message: m.viewerClient.share.discardMessage,
        confirmLabel: m.viewerClient.share.discardConfirm,
        cancelLabel: m.viewerClient.actions.cancel,
        closeLabel: m.viewerClient.actions.close,
        tone: 'danger',
      })
      if (!discardConfirmed) return
    }
    Xxd.closeDialog(this.#dialog)
  }

  #visibilityChoices() {
    const choice = visibility => {
      const isDisabled = visibility === 'public_link' && !this.#draft.saved.publicLink.allowedInWorkspace
      const radio = element('input', { type: 'radio', className: 'xxd-radio', name: 'visibility', id: `visibility-${visibility}`, value: visibility, checked: this.#draft.visibility === visibility, disabled: isDisabled })
      radio.addEventListener('change', () => {
        this.#draft.visibility = visibility
        this.#render()
      })
      return element('label', { className: 'xxd-choice', for: `visibility-${visibility}` }, radio,
        element('span', {}, this.#visibilityLabels[visibility], element('small', {}, isDisabled ? m.viewerClient.share.publicLinksOff : m.viewerClient.share.visibilityDescriptions[visibility])))
    }
    return element('fieldset', { className: 'xxd-choices share-section' }, element('legend', { className: 'share-section__title' }, m.viewerClient.share.whoCanSee),
      choice('private'),
      choice('specified'),
      choice('workspace'),
      choice('public_link'),
    )
  }

  #peopleSection() {
    if (!this.#draft.peopleApply) return null
    const emailInput = element('input', { className: 'xxd-input', 'data-size': 'sm', id: 'grant-email', type: 'email', required: true, placeholder: m.viewerClient.share.emailPlaceholder, 'aria-label': m.viewerClient.share.emailLabel, list: 'workspace-members', value: this.#emailToAdd, 'data-error-type': m.viewerClient.share.emailInvalid })
    const roleSelect = ShareDialog.#roleSelect(this.#draft.roleForNewPerson, 'grant-role')
    const addForm = element('form', { className: 'share-grant-form', 'data-xxd-validate': true },
      element('div', { className: 'xxd-field share-grant-form__email' }, emailInput), ShareDialog.#selectBox(roleSelect), element('button', { type: 'submit', className: 'xxd-btn', 'data-size': 'sm' }, m.viewerClient.share.add))
    submitOnce(addForm, () => this.#addPerson(emailInput, roleSelect.value))
    const memberOptions = element('datalist', { id: 'workspace-members' }, this.#draft.saved.members.map(member => element('option', { value: member.email }, member.name)))
    const grants = [...this.#draft.grants.values()]
    const peopleList = grants.length > 0
      ? element('ul', { className: 'xxd-list' }, grants.map(grant => this.#personRow(grant)))
      : element('p', { className: 'xxd-text', 'data-variant': 'secondary' }, this.#draft.visibility === 'specified' ? m.viewerClient.share.nobodyYetSpecified : m.viewerClient.share.nobodyYet)
    return element('section', { className: 'xxd-stack share-section' },
      element('div', { className: 'xxd-text-pair' },
        element('h3', { className: 'share-section__title' }, m.viewerClient.share.peopleTitle),
        element('p', { className: 'xxd-text', 'data-variant': 'caption' }, this.#draft.visibility === 'specified' ? m.viewerClient.share.peopleHintSpecified : m.viewerClient.share.peopleHint)),
      addForm, memberOptions, peopleList,
    )
  }

  #personRow(grant) {
    const roleSelect = ShareDialog.#roleSelect(grant.role, `grant-role-${grant.userId}`)
    roleSelect.setAttribute('aria-label', m.viewerClient.share.roleOf(grant.name))
    roleSelect.addEventListener('change', () => {
      this.#draft.setRole(grant.userId, roleSelect.value)
      this.#refreshSaveButton()
    })
    const unsavedBadge = this.#draft.isNewPerson(grant.userId) ? element('span', { className: 'xxd-badge', 'data-tone': 'action' }, m.viewerClient.share.addedOnSave) : null
    return element('li', { className: 'xxd-list__item share-person' },
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'aria-hidden': 'true' }, initialOf(grant.name)),
      element('span', { className: 'xxd-list__main' }, element('span', { className: 'xxd-list__title xxd-cluster' }, grant.name, unsavedBadge), element('span', { className: 'xxd-list__meta' }, grant.email ?? '')),
      ShareDialog.#selectBox(roleSelect),
      element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'danger-outline', 'data-size': 'sm', onClick: () => { this.#draft.removePerson(grant.userId); this.#render() } }, m.viewerClient.share.remove),
    )
  }

  static #roleSelect(selectedRole, selectId) {
    return element('select', { id: selectId, 'aria-label': m.viewerClient.share.role }, GRANT_ROLES.map(role => element('option', { value: role, selected: role === selectedRole }, m.viewerClient.share.roles[role])))
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
    const anonymousWrite = this.#draftSwitch('anonymous-write', 'anonymousWriteEnabled', m.viewerClient.share.anonymousWrite, m.viewerClient.share.anonymousWriteHint)
    const showsComments = this.#draftSwitch('shows-comments', 'showsComments', m.viewerClient.share.showsComments, m.viewerClient.share.showsCommentsHint)
    const listed = this.#listedSwitch()
    return element('section', { className: 'xxd-stack share-section' },
      element('div', { className: 'xxd-text-pair' },
        element('h3', { className: 'share-section__title' }, m.viewerClient.share.publicLink),
        element('p', { className: 'xxd-text', 'data-variant': 'caption' }, m.viewerClient.share.publicLinkHint)),
      element('div', { className: 'xxd-layout', 'data-cols': '2up' },
        element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'link-expiry' }, m.viewerClient.share.expiry), element('label', { className: 'xxd-select' }, expirySelect)),
        element('div', { className: 'xxd-field' }, element('label', { className: 'xxd-label', for: 'link-password', 'data-optional': true }, m.viewerClient.share.password), this.#passwordControl())),
      listed, anonymousWrite, showsComments,
    )
  }

  // The personal page is for strangers to find, so the switch says so; a password rules it out.
  #listedSwitch() {
    const listedSwitch = this.#draftSwitch('listed', 'listed', m.viewerClient.share.listed, '')
    queueMicrotask(() => this.#refreshListedSwitch())
    return listedSwitch
  }

  #refreshListedSwitch() {
    const checkbox = this.#dialog.querySelector('#listed')
    if (!checkbox) return
    const { listable } = this.#draft
    const { personalPageUrl } = this.#draft.saved.publicLink
    checkbox.disabled = !listable
    checkbox.checked = this.#draft.listed && listable
    const description = checkbox.closest('label').querySelector('small')
    const pageLink = personalPageUrl ? element('a', { className: 'xxd-link', href: personalPageUrl, target: '_blank', rel: 'noopener' }, m.viewerClient.share.personalPage) : null
    description.replaceChildren(...(listable ? [m.viewerClient.share.listedHint, pageLink ? ' ' : '', pageLink ?? ''] : [m.viewerClient.share.notListable]))
  }

  // The saved expiry is the selected option, so never expiring appears once whichever way the link is set.
  #expiryOptions() {
    const { expiresAt } = this.#draft.saved.publicLink
    const option = (value, label) => element('option', { value, selected: this.#draft.expiryChoice === value }, label)
    if (expiresAt === null) return [option('current', m.viewerClient.share.neverExpires), option('7', m.viewerClient.share.expiresIn(7)), option('30', m.viewerClient.share.expiresIn(30))]
    const expiryDate = dateText(expiresAt)
    const savedLabel = expiresAt > Date.now() ? m.viewerClient.share.keepsExpiry(expiryDate) : m.viewerClient.share.expiredOn(expiryDate)
    return [option('current', savedLabel), option('7', m.viewerClient.share.expiresIn(7)), option('30', m.viewerClient.share.expiresIn(30)), option('never', m.viewerClient.share.neverExpires)]
  }

  #passwordControl() {
    const passwordAction = (label, passwordChange) => element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', onClick: () => this.#choosePasswordChange(passwordChange) }, label)
    switch (this.#draft.passwordChange) {
      case 'keep':
        return element('div', { className: 'xxd-cluster share-password' }, element('span', { className: 'xxd-text', id: 'link-password' }, m.viewerClient.share.passwordSet), passwordAction(m.viewerClient.share.changePassword, 'set'), passwordAction(m.viewerClient.share.removePassword, 'remove'))
      case 'remove':
        return element('div', { className: 'xxd-cluster share-password' }, element('span', { className: 'xxd-text', id: 'link-password', 'data-variant': 'secondary' }, m.viewerClient.share.passwordRemovedOnSave), passwordAction(m.viewerClient.share.keepPassword, 'keep'))
      case 'set': {
        const { hasPassword } = this.#draft.saved.publicLink
        const passwordInput = element('input', { className: 'xxd-input', id: 'link-password', type: 'password', autocomplete: 'new-password', placeholder: hasPassword ? m.viewerClient.share.newPassword : m.viewerClient.share.noPassword, value: this.#draft.newPassword })
        passwordInput.addEventListener('input', () => {
          this.#draft.newPassword = passwordInput.value
          this.#refreshListedSwitch()
          this.#refreshSaveButton()
        })
        if (hasPassword) queueMicrotask(() => passwordInput.focus())
        return hasPassword ? element('div', { className: 'xxd-cluster share-password' }, passwordInput, passwordAction(m.viewerClient.share.keepOldPassword, 'keep')) : passwordInput
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
      Xxd.toast(m.viewerClient.share.saved, { tone: 'success', within: this.#stage })
      this.dispatchEvent(new CustomEvent('saved', { detail: { label: this.#visibilityLabels[savedSharing.visibility] } }))
    } catch (error) {
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    }
  }
}
