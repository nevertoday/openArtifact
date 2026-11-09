import { api, dateText, element, m, userMessageOf } from '../common.js'
import { MAX_POST_WEIGHT, composeShareText, postWeight } from '../share-text.js'

const X_POST_INTENT = 'https://x.com/intent/post'
const STYLES = ['title_summary', 'title_only', 'custom']
const SHAREABLE = new Set(['ready', 'expires'])
const BANNER_TONES = { ready: 'success', expires: 'warning', not_listed: 'warning', not_public: 'danger', has_password: 'danger', public_links_off: 'danger', removed: 'danger' }
// What one click sets to make the link shareable: public to anyone, on the personal page, no password, never expiring.
const MAKE_SHAREABLE = { visibility: 'public_link', listed: true, publicLinkExpiresAt: null, publicLinkPassword: null }
const FIXABLE = new Set(['expires', 'not_listed', 'not_public', 'has_password'])
const RING_RADIUS = 9
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
// The ring turns amber this close to the limit, so the author slows down before going over.
const NEAR_LIMIT = MAX_POST_WEIGHT - 20

/**
 * The author's panel for posting the artifact on X: whether its link can go out (and a fix when it cannot), the
 * words before the link with X's own count, and the real card picture X will show. Announces "saved" with the
 * new visibility label when its fix changes the sharing.
 */
export class ShareXPanel extends EventTarget {
  #dialog
  #body
  #sharingPath
  #artifactPath
  #visibilityLabels
  #copyText
  #copyLink
  #openOnX
  #share = null
  #style = 'title_summary'
  #text = ''

  constructor(dialog, config) {
    super()
    this.#dialog = dialog
    this.#body = dialog.querySelector('[data-share-x-body]')
    this.#sharingPath = `/api/artifacts/${encodeURIComponent(config.artifactId)}/sharing`
    this.#artifactPath = `/api/artifacts/${encodeURIComponent(config.artifactId)}`
    this.#visibilityLabels = config.visibilityLabels
    this.#copyText = dialog.querySelector('[data-share-x-copy-text]')
    this.#copyLink = dialog.querySelector('[data-share-x-copy-link]')
    this.#openOnX = dialog.querySelector('[data-share-x-open]')
    this.showTitle(config.title)
  }

  showTitle(title) {
    this.#dialog.querySelector('[data-share-x-subtitle]').textContent = title
  }

  async open() {
    this.#share = null
    this.#body.replaceChildren(element('p', { className: 'viewer-drawer__status' }, element('span', { className: 'xxd-spinner', 'aria-hidden': 'true' }), m.viewerClient.share.loading))
    this.#refreshActions()
    Xxd.openDialog(this.#dialog)
    try {
      const { share } = await api(this.#sharingPath)
      this.#share = share
      this.#style = share.savedText === null ? 'title_summary' : 'custom'
      this.#text = share.x.text
      this.#render()
    } catch (error) {
      this.#body.replaceChildren(element('div', { className: 'xxd-banner', 'data-tone': 'danger', role: 'alert' }, element('p', { className: 'xxd-banner__text' }, userMessageOf(error))))
    }
  }

  get #shareable() {
    return this.#share !== null && SHAREABLE.has(this.#share.readiness.kind)
  }

  get #weight() {
    return postWeight(this.#text)
  }

  #render() {
    this.#body.replaceChildren(this.#readinessBanner(), this.#styleChoice(), this.#textField(), this.#savedTextRow(), this.#preview())
    this.#refreshCount()
  }

  #readinessBanner() {
    const { readiness } = this.#share
    const words = m.viewerClient.shareX.readiness
    const text = readiness.kind === 'expires' ? words.expires(dateText(readiness.at)) : words[readiness.kind]
    const fix = FIXABLE.has(readiness.kind)
      ? element('div', { className: 'xxd-banner__actions' }, element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', onClick: event => this.#makeShareable(event.currentTarget) }, m.viewerClient.shareX.fix[readiness.kind]))
      : null
    return element('div', { className: 'xxd-banner share-x__readiness', 'data-tone': BANNER_TONES[readiness.kind], role: 'status', 'data-share-x-readiness': readiness.kind }, element('p', { className: 'xxd-banner__title' }, text), fix)
  }

  // Going public is the one thing here that reaches strangers, so it is confirmed first.
  async #makeShareable(fixButton) {
    const confirmed = await Xxd.confirmDialog({
      title: m.viewerClient.shareX.fixConfirm.title,
      message: m.viewerClient.shareX.fixConfirm.message,
      confirmLabel: m.viewerClient.shareX.fixConfirm.confirm,
      cancelLabel: m.viewerClient.actions.cancel,
      closeLabel: m.viewerClient.actions.close,
    })
    if (!confirmed) return
    fixButton.setAttribute('aria-busy', 'true')
    try {
      const savedSharing = await api(this.#sharingPath, { method: 'PUT', body: MAKE_SHAREABLE })
      this.#share = savedSharing.share
      this.#render()
      Xxd.toast(m.viewerClient.shareX.fixed, { tone: 'success', within: this.#dialog })
      this.dispatchEvent(new CustomEvent('saved', { detail: { label: this.#visibilityLabels[savedSharing.visibility], visibility: savedSharing.visibility } }))
    } catch (error) {
      fixButton.removeAttribute('aria-busy')
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    }
  }

  #styleChoice() {
    const choice = style => {
      const button = element('button', { type: 'button', role: 'radio', 'aria-checked': String(this.#style === style), 'data-share-x-style': style }, m.viewerClient.shareX.styles[style])
      button.addEventListener('click', () => this.#chooseStyle(style))
      return button
    }
    return element('div', { className: 'xxd-segmented share-x__styles', 'data-size': 'sm', role: 'radiogroup', 'aria-label': m.viewerClient.shareX.styles.label }, STYLES.map(choice))
  }

  // Writing your own starts from the saved words, or else from the words on screen.
  #chooseStyle(style) {
    this.#style = style
    this.#text = style === 'custom' ? (this.#share.savedText ?? this.#text) : composeShareText({ title: this.#share.title, summary: this.#share.summary }, style)
    this.#render()
    if (style === 'custom') this.#dialog.querySelector('[data-share-x-text]')?.focus()
  }

  #textField() {
    const textarea = element('textarea', { className: 'xxd-textarea share-x__text', id: 'share-x-text', rows: '5', 'data-share-x-text': true }, this.#text)
    textarea.addEventListener('input', () => {
      this.#text = textarea.value
      if (this.#style !== 'custom') {
        this.#style = 'custom'
        for (const button of this.#dialog.querySelectorAll('[data-share-x-style]')) button.setAttribute('aria-checked', String(button.dataset.shareXStyle === 'custom'))
        this.#dialog.querySelector('[data-share-x-saved-row]')?.replaceWith(this.#savedTextRow())
      }
      this.#refreshCount()
    })
    const counter = element('div', { className: 'share-x__counter', 'data-share-x-counter': true },
      element('span', { className: 'share-x__ring', 'aria-hidden': 'true' }),
      element('span', { className: 'xxd-num share-x__count', 'data-share-x-count': true }),
      element('span', { className: 'share-x__hint' }, m.viewerClient.shareX.counterHint))
    return element('div', { className: 'xxd-field share-x__field' },
      element('label', { className: 'xxd-label', for: 'share-x-text' }, m.viewerClient.shareX.textLabel),
      textarea,
      element('p', { className: 'share-x__url xxd-mono' }, this.#share.url),
      counter,
      element('p', { className: 'share-x__over', role: 'alert', 'data-share-x-over': true, hidden: true }))
  }

  #savedTextRow() {
    const { savedText } = this.#share
    const row = element('div', { className: 'share-x__saved', 'data-share-x-saved-row': true })
    if (this.#style === 'custom') {
      const saveButton = element('button', { type: 'button', className: 'xxd-btn', 'data-size': 'sm', 'data-share-x-save': true, onClick: event => this.#saveText(this.#text.trim() || null, event.currentTarget) }, m.viewerClient.shareX.saveCustom)
      row.append(saveButton)
    }
    if (savedText !== null) {
      row.append(element('span', { className: 'xxd-text', 'data-variant': 'caption' }, m.viewerClient.shareX.usesSaved),
        element('button', { type: 'button', className: 'xxd-btn', 'data-variant': 'ghost', 'data-size': 'sm', onClick: event => this.#saveText(null, event.currentTarget) }, m.viewerClient.shareX.useGenerated))
    }
    return row
  }

  // Saved words are what readers' "Share on X" posts too; null goes back to words made from the title and summary.
  async #saveText(shareText, button) {
    button.setAttribute('aria-busy', 'true')
    try {
      const { share } = await api(this.#artifactPath, { method: 'PATCH', body: { shareText } })
      this.#share = share
      if (shareText === null) {
        this.#style = 'title_summary'
        this.#text = share.x.text
      }
      this.#render()
      Xxd.toast(shareText === null ? m.viewerClient.shareX.generatedRestored : m.viewerClient.shareX.customSaved, { tone: 'success', within: this.#dialog })
    } catch (error) {
      button.removeAttribute('aria-busy')
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#dialog })
    }
  }

  // Asking for the real picture also draws and keeps it, so it is ready before X comes to fetch it.
  #preview() {
    const figure = element('figure', { className: 'share-x__preview' }, element('figcaption', { className: 'xxd-label' }, m.viewerClient.shareX.previewLabel))
    if (!this.#shareable) {
      figure.append(element('p', { className: 'share-x__preview-missing' }, m.viewerClient.shareX.previewMissing))
      return figure
    }
    const picture = element('img', { src: this.#share.imageUrl, alt: this.#share.title, width: '1200', height: '630', 'data-share-x-card': true })
    picture.addEventListener('error', () => picture.replaceWith(element('p', { className: 'share-x__preview-missing' }, m.viewerClient.shareX.previewMissing)), { once: true })
    figure.append(picture)
    return figure
  }

  #refreshCount() {
    const weight = this.#weight
    const over = weight - MAX_POST_WEIGHT
    const counter = this.#dialog.querySelector('[data-share-x-counter]')
    if (!counter) return
    counter.dataset.level = over > 0 ? 'over' : weight >= NEAR_LIMIT ? 'near' : 'ok'
    counter.querySelector('[data-share-x-count]').textContent = m.viewerClient.shareX.counter({ used: weight, max: MAX_POST_WEIGHT })
    counter.querySelector('.share-x__ring').replaceChildren(ShareXPanel.#ring(Math.min(weight / MAX_POST_WEIGHT, 1)))
    const overMessage = this.#dialog.querySelector('[data-share-x-over]')
    overMessage.hidden = over <= 0
    overMessage.textContent = over > 0 ? m.viewerClient.shareX.overLimit(over) : ''
    const saveButton = this.#dialog.querySelector('[data-share-x-save]')
    if (saveButton) saveButton.disabled = over > 0 || this.#text.trim() === (this.#share.savedText ?? '')
    this.#refreshActions()
  }

  #refreshActions() {
    const loaded = this.#share !== null
    const fits = loaded && this.#weight <= MAX_POST_WEIGHT
    this.#copyText.disabled = !loaded
    this.#copyLink.disabled = !loaded
    if (loaded) {
      this.#copyText.dataset.copy = `${this.#text.trim()} ${this.#share.url}`
      this.#copyLink.dataset.copy = this.#share.url
    }
    const canOpen = fits && this.#shareable
    this.#openOnX.setAttribute('aria-disabled', String(!canOpen))
    if (canOpen) this.#openOnX.href = `${X_POST_INTENT}?${new URLSearchParams({ text: this.#text.trim(), url: this.#share.url })}`
    else this.#openOnX.removeAttribute('href')
  }

  static #ring(share) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '22')
    svg.setAttribute('height', '22')
    for (const [className, dash] of [['share-x__ring-track', RING_LENGTH], ['share-x__ring-fill', share * RING_LENGTH]]) {
      const circle = document.createElementNS(ns, 'circle')
      circle.setAttribute('class', className)
      circle.setAttribute('cx', '12')
      circle.setAttribute('cy', '12')
      circle.setAttribute('r', String(RING_RADIUS))
      circle.setAttribute('stroke-dasharray', `${dash} ${RING_LENGTH}`)
      svg.append(circle)
    }
    return svg
  }
}
