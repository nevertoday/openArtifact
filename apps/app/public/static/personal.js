import { api, element, m, readJsonData, renderServerTimes, userMessageOf } from './common.js'

const PREVIEW_DELAY_MS = 260
const PREVIEW_WIDTH = 320
const PREVIEW_HEIGHT = 210
const MAX_BIO_LENGTH = 200
const MAX_SUMMARY_LENGTH = 300
const CAN_PREVIEW = matchMedia('(hover: hover) and (min-width: 900px) and (prefers-reduced-motion: no-preference)')

/**
 * A small live picture of an entry's page, shown over the entry's right column once the pointer rests on it, so
 * it never covers the words being read. The page loads only when asked for and stays loaded while the pointer
 * moves between entries.
 */
class EntryPreview {
  #peek
  #loadedFrame = null
  #restTimer = null

  constructor(peek) {
    this.#peek = peek
    addEventListener('scroll', () => this.hide(), { passive: true })
  }

  watch(entry) {
    const link = entry.querySelector('.personal-entry__link')
    const previewUrl = entry.dataset.previewUrl
    if (!link || !previewUrl) return
    link.addEventListener('pointerenter', () => {
      if (!CAN_PREVIEW.matches) return
      clearTimeout(this.#restTimer)
      this.#restTimer = setTimeout(() => this.#show(entry, previewUrl), PREVIEW_DELAY_MS)
    })
    link.addEventListener('pointerleave', () => this.hide())
  }

  hide() {
    clearTimeout(this.#restTimer)
    this.#peek.removeAttribute('data-shown')
  }

  #show(entry, previewUrl) {
    const frame = this.#frame()
    if (frame.src !== previewUrl) frame.src = previewUrl
    const row = entry.getBoundingClientRect()
    const top = Math.min(Math.max(row.top + row.height / 2 - PREVIEW_HEIGHT / 2, 16), innerHeight - PREVIEW_HEIGHT - 16)
    this.#peek.style.translate = `${row.right - PREVIEW_WIDTH}px ${top}px`
    this.#peek.setAttribute('data-shown', '')
  }

  // Scripts may run so charts look right; without allow-same-origin the page stays as isolated as in the viewer.
  #frame() {
    this.#loadedFrame ??= this.#peek.appendChild(element('iframe', { sandbox: 'allow-scripts', tabindex: '-1', referrerpolicy: 'no-referrer', title: '' }))
    return this.#loadedFrame
  }
}

/** The owner's controls on their own page: the line about them, the pin and each entry's summary. */
class OwnerControls {
  wire(page) {
    page.querySelector('[data-edit-bio]')?.addEventListener('click', event => this.#editBio(event.currentTarget))
    for (const pinButton of page.querySelectorAll('[data-pin]')) pinButton.addEventListener('click', () => this.#setPin(pinButton))
    for (const summaryButton of page.querySelectorAll('[data-edit-summary]')) summaryButton.addEventListener('click', () => this.#editSummary(summaryButton))
  }

  #editBio(bioButton) {
    const savedBio = bioButton.dataset.empty === 'true' ? '' : bioButton.textContent
    const bioInput = element('input', { className: 'xxd-input personal-head__bio-input', value: savedBio, maxlength: String(MAX_BIO_LENGTH), placeholder: m.client.personal.bioLabel, 'aria-label': m.client.personal.bioLabel })
    const finish = async save => {
      bioInput.replaceWith(bioButton)
      if (!save || bioInput.value.trim() === savedBio) return bioButton.focus()
      try {
        const { bio } = await api('/api/me/profile', { method: 'PATCH', body: { bio: bioInput.value.trim() } })
        bioButton.textContent = bio || m.client.personal.bioEmpty
        bioButton.dataset.empty = String(bio === '')
        Xxd.toast(m.client.personal.bioSaved)
      } catch (error) {
        Xxd.toast(userMessageOf(error), { tone: 'danger' })
      }
      bioButton.focus()
    }
    bioInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') finish(true)
      if (event.key === 'Escape') finish(false)
    })
    bioInput.addEventListener('blur', () => bioInput.isConnected && finish(true))
    bioButton.replaceWith(bioInput)
    bioInput.focus()
    bioInput.select()
  }

  // The cover changes the whole layout, so the page is drawn again from the server.
  async #setPin(pinButton) {
    const pinning = pinButton.dataset.pin === 'on'
    pinButton.setAttribute('aria-busy', 'true')
    try {
      await api('/api/me/profile', { method: 'PATCH', body: { pinnedArtifactId: pinning ? pinButton.dataset.artifactId : null } })
      location.reload()
    } catch (error) {
      pinButton.removeAttribute('aria-busy')
      Xxd.toast(userMessageOf(error), { tone: 'danger' })
    }
  }

  #editSummary(summaryButton) {
    const entry = summaryButton.closest('[data-entry]')
    const shownSummary = entry.querySelector('[data-summary]')
    const tools = summaryButton.closest('.personal-tools')
    const summaryInput = element('textarea', { className: 'xxd-textarea', rows: '3', maxlength: String(MAX_SUMMARY_LENGTH), 'aria-label': m.client.personal.summaryLabel }, shownSummary?.textContent ?? '')
    const close = () => {
      editor.remove()
      tools.hidden = false
      if (shownSummary) shownSummary.hidden = false
      summaryButton.focus()
    }
    const save = async summary => {
      try {
        const saved = await api(`/api/artifacts/${encodeURIComponent(summaryButton.dataset.artifactId)}`, { method: 'PATCH', body: { summary } })
        OwnerControls.#showSummary(entry, shownSummary, saved.summary)
        Xxd.toast(summary === null ? m.client.personal.summaryReset : m.client.personal.summarySaved)
        close()
      } catch (error) {
        Xxd.toast(userMessageOf(error), { tone: 'danger' })
      }
    }
    const action = (label, onClick, variant) => element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', ...(variant ? { 'data-variant': variant } : {}), onClick }, label)
    const editor = element('div', { className: 'personal-summary-editor' },
      summaryInput,
      element('div', { className: 'personal-summary-editor__row' },
        action(m.client.personal.useOpening, () => save(null), 'ghost'),
        action(m.client.dialog.cancel, close),
        action(m.client.personal.save, () => save(summaryInput.value.trim() || null), 'primary')))
    summaryInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') close()
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save(summaryInput.value.trim() || null)
    })
    if (shownSummary) shownSummary.hidden = true
    tools.hidden = true
    tools.after(editor)
    summaryInput.focus()
  }

  static #showSummary(entry, shownSummary, summary) {
    if (shownSummary) {
      shownSummary.textContent = summary ?? ''
      shownSummary.hidden = !summary
      return
    }
    if (!summary) return
    const title = entry.querySelector('.personal-entry__title, .personal-cover__title')
    title.after(element('p', { className: title.classList.contains('personal-cover__title') ? 'personal-cover__summary' : 'personal-entry__summary', 'data-summary': '' }, summary))
  }
}

const page = document.querySelector('[data-personal]')
const config = readJsonData('personal-config')
renderServerTimes(page)
const preview = new EntryPreview(page.querySelector('[data-peek]'))
for (const entry of page.querySelectorAll('.personal-entry')) preview.watch(entry)
if (config.isOwner) new OwnerControls().wire(page)
