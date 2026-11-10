import { avatarStyle } from '../avatar.js'
import { api, dateText, element, icon, initialOf, m, submitOnce, userMessageOf } from '../common.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SHARE_LINK_PREFIX = '#share='
const GRANT_ROLES = ['viewer', 'commenter', 'editor']
const VISIBILITY_ICONS = { private: 'Lock', specified: 'UserRound', workspace: 'Users', public_link: 'Globe' }

// A person is known by their address, which names the same person before and after they sign up; only a deleted account has none.
function grantKeyOf(grant) {
  return grant.email?.toLowerCase() ?? `user:${grant.userId}`
}

/**
 * The sharing a change in the dialog asks for, beside what is saved. Each change is sent at once, so this holds one
 * change at a time. Only what the dialog shows for the chosen visibility counts: the people where the server says
 * they apply, the link settings for a public link.
 */
class SharingDraft {
  constructor(saved) {
    this.saved = saved
    this.visibility = saved.visibility
    this.grants = new Map(saved.grants.map(grant => [grantKeyOf(grant), { ...grant }]))
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

  /** `person` is the lookup's answer, an address and a name only for someone the author already works with. */
  addPerson(person, role) {
    const grantKey = grantKeyOf(person)
    const saved = this.saved.grants.find(grant => grantKeyOf(grant) === grantKey)
    this.grants.set(grantKey, saved ? { ...saved, role } : { userId: null, email: person.email, name: person.name, pending: false, role })
  }

  setRole(grantKey, role) {
    const grant = this.grants.get(grantKey)
    if (grant) grant.role = role
  }

  removePerson(grantKey) {
    this.grants.delete(grantKey)
  }

  /** The PUT body: the complete list of people wherever it counts, and only the link settings that changed. */
  toRequest() {
    const sharingUpdate = { visibility: this.visibility }
    if (this.peopleApply) sharingUpdate.grants = [...this.grants.values()].map(grant => (grant.userId === null ? { email: grant.email, role: grant.role } : { userId: grant.userId, role: grant.role }))
    if (this.visibility === 'public_link') Object.assign(sharingUpdate, this.#publicLinkChanges())
    return sharingUpdate
  }

  #grantsChanged() {
    const savedRoles = new Map(this.saved.grants.map(grant => [grantKeyOf(grant), grant.role]))
    const samePeopleCount = savedRoles.size === this.grants.size
    const anyRoleDiffers = [...this.grants].some(([grantKey, grant]) => savedRoles.get(grantKey) !== grant.role)
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

/**
 * Who can see the artifact and how far its public link reaches. Every change takes effect at once and announces
 * "saved" with the new visibility; only making the page public asks first, and what was changed by a slip of the
 * hand (the reach, a person removed) can be undone from the notice that follows it.
 */
export class ShareDialog extends EventTarget {
  #dialog
  #body
  #status
  #sharingPath
  #visibilityLabels
  #viewer
  #draft = null
  #emailToAdd = ''
  #peopleOpen = false

  constructor(dialog, config) {
    super()
    this.#dialog = dialog
    this.#body = dialog.querySelector('[data-share-body]')
    this.#status = dialog.querySelector('[data-share-status]')
    this.#sharingPath = `/api/artifacts/${encodeURIComponent(config.artifactId)}/sharing`
    this.#visibilityLabels = config.visibilityLabels
    this.#viewer = config.viewer
    dialog.querySelector('#share-form').addEventListener('submit', event => event.preventDefault())
    for (const closer of dialog.querySelectorAll('[data-close-share]')) closer.addEventListener('click', () => this.close())
    dialog.querySelector('[data-copy-link]').dataset.copy = location.origin + location.pathname
    this.showTitle(config.title)
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
    this.#peopleOpen = false
    this.#body.replaceChildren(element('p', { className: 'viewer-drawer__status' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), m.viewerClient.share.loading))
    this.#showStatus('')
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
    const alreadyAdded = member !== undefined && this.#draft.grants.has(grantKeyOf(member))
    if (!member || alreadyAdded) return
    if (!this.#draft.peopleApply) this.#draft.visibility = 'specified'
    this.#emailToAdd = member.email
  }

  // The control just used keeps the focus across the redraw that follows its change.
  #render() {
    const focusedId = this.#dialog.contains(document.activeElement) ? document.activeElement.id : ''
    this.#body.replaceChildren(...[this.#visibilityChoices(), this.#peopleSection(), this.#publicLinkSection()].filter(Boolean))
    if (focusedId) this.#body.querySelector(`#${CSS.escape(focusedId)}`)?.focus()
  }

  #showStatus(text) {
    this.#status.textContent = text
  }

  /**
   * Sends the change at once and shows what the server saved; a refusal puts the saved state back and says why.
   * With `undoText`, a notice says what changed and offers to put it back.
   */
  async #apply(undoText = null) {
    if (!this.#draft.hasChanges) return this.#render()
    const before = this.#draft.saved
    this.#body.inert = true
    this.#showStatus(m.viewerClient.share.saving)
    try {
      const saved = await api(this.#sharingPath, { method: 'PUT', body: this.#draft.toRequest() })
      this.#draft = new SharingDraft(saved)
      this.#showStatus(m.viewerClient.share.savedNow)
      this.dispatchEvent(new CustomEvent('saved', { detail: { label: this.#visibilityLabels[saved.visibility], visibility: saved.visibility } }))
      if (undoText) Xxd.toast(undoText, { within: this.#dialog, action: { label: m.viewerClient.share.undo, onClick: () => this.#putBack(before) } })
    } catch (error) {
      this.#draft = new SharingDraft(before)
      this.#showStatus('')
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    } finally {
      this.#body.inert = false
    }
    this.#render()
  }

  // Undo restores who could see the page and the people named on it, as they were before the change.
  #putBack(before) {
    this.#draft.visibility = before.visibility
    this.#draft.grants = new Map(before.grants.map(grant => [grantKeyOf(grant), { ...grant }]))
    return this.#apply()
  }

  // Anyone holding the link will see a public page, so making it public is always a deliberate second press.
  #confirmPublic() {
    const { confirmPublic } = m.viewerClient.share
    return Xxd.confirmDialog({ title: confirmPublic.title, message: confirmPublic.message, confirmLabel: confirmPublic.confirm, cancelLabel: m.viewerClient.actions.cancel, closeLabel: m.viewerClient.actions.close })
  }

  /** Closes the dialog; resolves to true, since nothing in it waits to be saved. */
  async close() {
    Xxd.closeDialog(this.#dialog)
    return true
  }

  #visibilityChoices() {
    const choice = visibility => {
      const isDisabled = visibility === 'public_link' && !this.#draft.saved.publicLink.allowedInWorkspace
      const radio = element('input', { type: 'radio', className: 'xxd-radio', name: 'visibility', id: `visibility-${visibility}`, value: visibility, checked: this.#draft.visibility === visibility, disabled: isDisabled })
      radio.addEventListener('change', async () => {
        const becomesPublic = visibility === 'public_link' && this.#draft.saved.visibility !== 'public_link'
        if (becomesPublic && !(await this.#confirmPublic())) return this.#render()
        this.#draft.visibility = visibility
        this.#apply(m.viewerClient.share.visibilityChanged(this.#visibilityLabels[visibility]))
      })
      return element('label', { className: 'share-reach', for: `visibility-${visibility}` }, radio, icon(VISIBILITY_ICONS[visibility], 18),
        element('span', { className: 'share-reach__text' }, element('b', {}, this.#visibilityLabels[visibility]), element('small', {}, isDisabled ? m.viewerClient.share.publicLinksOff : m.viewerClient.share.visibilityDescriptions[visibility])))
    }
    return element('fieldset', { className: 'share-section share-reaches' }, element('legend', { className: 'share-section__title' }, m.viewerClient.share.whoCanSee),
      choice('private'),
      choice('specified'),
      choice('workspace'),
      choice('public_link'),
    )
  }

  /** Everyone who can open the page, most able first: the author, the people named, then whoever the reach lets in. */
  #peopleSection() {
    const { share } = m.viewerClient
    const { saved, visibility, grants } = this.#draft
    const reachRow = (iconName, title, role) => element('li', { className: 'xxd-list__item share-person' },
      element('span', { className: 'share-person__reach', 'aria-hidden': 'true' }, icon(iconName, 14)),
      element('span', { className: 'xxd-list__main' }, element('span', { className: 'xxd-list__title' }, title)),
      element('span', { className: 'share-person__role' }, role))
    const everyoneInWorkspace = visibility === 'workspace' || visibility === 'public_link' ? reachRow('Users', share.access.workspaceEveryone(saved.members.length), share.access.workspaceRole) : null
    const anyoneWithLink = visibility === 'public_link' ? reachRow('Globe', share.access.anyoneWithLink, share.access.linkRole) : null
    const namedPeople = this.#draft.peopleApply ? [...grants].map(([grantKey, grant]) => this.#personRow(grantKey, grant)) : []
    const accessList = element('ul', { className: 'xxd-list share-access', 'data-share-access': true }, this.#authorRow(), namedPeople, everyoneInWorkspace, anyoneWithLink)
    return element('section', { className: 'xxd-stack share-section' },
      element('div', { className: 'xxd-text-pair' },
        element('h3', { className: 'share-section__title' }, share.access.title),
        this.#draft.peopleApply ? element('p', { className: 'xxd-text', 'data-variant': 'caption' }, visibility === 'specified' ? share.peopleHintSpecified : share.peopleHint) : null),
      accessList, ...this.#addPersonControls(),
    )
  }

  #authorRow() {
    const authorId = this.#draft.saved.author.userId
    const name = authorId === this.#viewer?.userId ? this.#viewer.name : this.#draft.saved.members.find(member => member.userId === authorId)?.name ?? m.viewerClient.share.access.author
    return element('li', { className: 'xxd-list__item share-person' },
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'data-avatar': '', style: avatarStyle(name), 'aria-hidden': 'true' }, initialOf(name)),
      element('span', { className: 'xxd-list__main' }, element('span', { className: 'xxd-list__title' }, name)),
      element('span', { className: 'share-person__role' }, m.viewerClient.share.access.author))
  }

  #addPersonControls() {
    if (!this.#draft.peopleApply) return []
    // The whole workspace already sees the page, so giving one person more stays one quiet click away until it is wanted.
    if (this.#draft.visibility !== 'specified' && this.#draft.grants.size === 0 && !this.#peopleOpen && !this.#emailToAdd) {
      const reveal = element('button', { type: 'button', className: 'xxd-btn share-people-reveal', 'data-variant': 'ghost', 'data-size': 'sm' }, icon('UserPlus', 14), m.viewerClient.share.givePersonMore)
      reveal.addEventListener('click', () => {
        this.#peopleOpen = true
        this.#render()
        this.#dialog.querySelector('#grant-email')?.focus()
      })
      return [reveal]
    }
    const emailInput = element('input', { className: 'xxd-input', 'data-size': 'sm', id: 'grant-email', type: 'email', required: true, placeholder: m.viewerClient.share.emailPlaceholder, 'aria-label': m.viewerClient.share.emailLabel, list: 'workspace-members', value: this.#emailToAdd, 'data-error-type': m.viewerClient.share.emailInvalid })
    const roleSelect = ShareDialog.#roleSelect(this.#draft.roleForNewPerson, 'grant-role')
    const addForm = element('form', { className: 'share-grant-form', 'data-xxd-validate': true },
      element('div', { className: 'xxd-field share-grant-form__email' }, emailInput), ShareDialog.#selectBox(roleSelect), element('button', { type: 'submit', className: 'xxd-btn', 'data-size': 'sm' }, m.viewerClient.share.add))
    submitOnce(addForm, () => this.#addPerson(emailInput, roleSelect.value))
    const memberOptions = element('datalist', { id: 'workspace-members' }, this.#draft.saved.members.map(member => element('option', { value: member.email }, member.name)))
    return [addForm, memberOptions]
  }

  // Someone the author does not work with is shown by address alone, since the lookup does not say who they are.
  #personRow(grantKey, grant) {
    const label = grant.name ?? grant.email
    const roleSelect = ShareDialog.#roleSelect(grant.role, `grant-role-${grantKey}`)
    roleSelect.setAttribute('aria-label', m.viewerClient.share.roleOf(label))
    roleSelect.addEventListener('change', () => {
      this.#draft.setRole(grantKey, roleSelect.value)
      this.#apply()
    })
    const badge = grant.pending ? element('span', { className: 'xxd-badge', 'data-share-pending': true }, m.viewerClient.share.invited) : null
    const remove = () => {
      this.#draft.removePerson(grantKey)
      this.#apply(m.viewerClient.share.personRemoved(label))
    }
    return element('li', { className: 'xxd-list__item share-person' },
      element('span', { className: 'xxd-avatar', 'data-size': 'sm', 'data-avatar': '', style: avatarStyle(label), 'aria-hidden': 'true' }, initialOf(label)),
      element('span', { className: 'xxd-list__main' }, element('span', { className: 'xxd-list__title xxd-cluster' }, label, badge), element('span', { className: 'xxd-list__meta' }, grant.name === null ? '' : grant.email ?? '')),
      ShareDialog.#selectBox(roleSelect),
      element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-icon-only': true, 'data-size': 'sm', 'aria-label': m.viewerClient.share.removePerson(label), 'data-tooltip': m.viewerClient.share.remove, onClick: remove }, icon('X', 14)),
    )
  }

  static #roleSelect(selectedRole, selectId) {
    return element('select', { id: selectId, 'aria-label': m.viewerClient.share.role }, GRANT_ROLES.map(role => element('option', { value: role, selected: role === selectedRole }, m.labels.grantRoles[role])))
  }

  static #selectBox(select) {
    return element('label', { className: 'xxd-select', 'data-size': 'sm' }, select)
  }

  #publicLinkSection() {
    if (this.#draft.visibility !== 'public_link') return null
    const expirySelect = element('select', { id: 'link-expiry' }, this.#expiryOptions())
    expirySelect.addEventListener('change', () => {
      this.#draft.expiryChoice = expirySelect.value
      this.#apply()
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
      case 'set': {
        const { hasPassword } = this.#draft.saved.publicLink
        const passwordInput = element('input', { className: 'xxd-input', id: 'link-password', type: 'password', autocomplete: 'new-password', placeholder: hasPassword ? m.viewerClient.share.newPassword : m.viewerClient.share.noPassword, value: this.#draft.newPassword })
        // A password takes effect when the field is left or Enter is pressed, not on every letter.
        passwordInput.addEventListener('change', () => {
          this.#draft.newPassword = passwordInput.value
          this.#apply()
        })
        if (hasPassword) queueMicrotask(() => passwordInput.focus())
        return hasPassword ? element('div', { className: 'xxd-cluster share-password' }, passwordInput, passwordAction(m.viewerClient.share.keepOldPassword, 'keep')) : passwordInput
      }
      default:
        throw new Error(`unknown password change ${this.#draft.passwordChange}`)
    }
  }

  // Taking the password off happens at once; changing it opens the field, and backing out keeps the old one.
  #choosePasswordChange(passwordChange) {
    this.#draft.passwordChange = passwordChange
    this.#draft.newPassword = ''
    this.#apply()
  }

  #draftSwitch(inputId, draftField, label, description) {
    const checkbox = element('input', { type: 'checkbox', className: 'xxd-check', id: inputId, checked: this.#draft[draftField] })
    checkbox.addEventListener('change', () => {
      this.#draft[draftField] = checkbox.checked
      this.#apply()
    })
    return element('label', { className: 'xxd-choice', for: inputId }, checkbox, element('span', {}, label, element('small', {}, description)))
  }

  // A person the dialog cannot add is explained under the email field, where the person typed it.
  async #addPerson(emailInput, role) {
    try {
      const person = await api(`${this.#sharingPath}/people?email=${encodeURIComponent(emailInput.value.trim())}`)
      Xxd.setFieldError(emailInput, '')
      this.#draft.addPerson(person, role)
      await this.#apply()
      this.#dialog.querySelector('#grant-email')?.focus()
    } catch (error) {
      if (error.field === 'email') Xxd.setFieldError(emailInput, userMessageOf(error), { focus: true })
      else Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    }
  }
}
