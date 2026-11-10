import { api, confirmArtifactRemoval, element, m, removeArtifact, userMessageOf } from '../common.js'

const MAX_TITLE_LENGTH = 200

/**
 * The bar above the artifact: the title, renamed in place; the count of open comments, rolling when it changes;
 * and the ⋯ menu with copying the link and removing the artifact. Announces "renamed" with the new title.
 */
export class ViewerTopBar extends EventTarget {
  #bar
  #config
  #stage

  constructor({ bar, config, stage, openData }) {
    super()
    this.#bar = bar
    this.#config = config
    this.#stage = stage
    // The menu hands focus back to its button as it closes; the title field opens once that has happened.
    bar.querySelector('[data-rename-artifact]')?.addEventListener('click', () => requestAnimationFrame(() => this.#rename()))
    bar.querySelector('[data-copy-artifact-link]')?.addEventListener('click', () => this.#copyLink())
    bar.querySelector('[data-remove-artifact]')?.addEventListener('click', () => this.#remove())
    bar.querySelector('[data-open-data]')?.addEventListener('click', openData)
    new ResizeObserver(() => this.#offerFullTitleWhenCut()).observe(this.#title)
  }

  get #title() {
    return this.#bar.querySelector('[data-artifact-title]')
  }

  /** The number of open comments; it rolls when it changes, so a change is seen without being read. */
  showOpenCount(count) {
    const badge = this.#bar.querySelector('[data-comment-count]')
    if (!badge) return
    badge.toggleAttribute('data-zero', count === 0)
    badge.closest('button').setAttribute('aria-label', m.viewerClient.topBar.openComments(count))
    const isFirstCount = badge.textContent === ''
    if (isFirstCount) badge.textContent = String(count)
    else Xxd.rollText(badge, String(count))
  }

  showVisibility({ label, visibility }) {
    for (const visibilityLabel of document.querySelectorAll('[data-visibility-label]')) visibilityLabel.textContent = label
    for (const badge of document.querySelectorAll('.viewer-visibility[data-visibility], .viewer-share-button')) badge.dataset.visibility = visibility
    document.querySelector('.viewer-share-button')?.setAttribute('data-tooltip', label)
  }

  showDataCount(count) {
    const dataItem = this.#bar.querySelector('[data-open-data]')
    if (dataItem) dataItem.lastChild.textContent = count > 0 ? m.viewerClient.topBar.dataCount(count) : m.viewerClient.topBar.data
  }

  // The full title shows on hover and focus only when the bar had to cut it.
  #offerFullTitleWhenCut() {
    const title = this.#title
    if (title.scrollWidth > title.clientWidth) title.dataset.tooltip = this.#config.title
    else delete title.dataset.tooltip
  }

  #showTitle(title) {
    this.#config.title = title
    document.title = `${title} · Open Artifact`
    this.#title.textContent = title
    this.#offerFullTitleWhenCut()
    this.dispatchEvent(new CustomEvent('renamed', { detail: { title } }))
  }

  // The title turns into a field where it stands: Enter or leaving the field saves, Esc keeps the old title.
  #rename() {
    const title = this.#title
    const input = element('input', { className: 'xxd-input viewer-bar__rename', 'data-size': 'sm', value: this.#config.title, maxlength: String(MAX_TITLE_LENGTH), 'aria-label': m.viewerClient.topBar.newTitle, autocomplete: 'off' })
    title.hidden = true
    title.after(input)
    input.focus()
    input.select()
    let finished = false
    const finish = save => {
      if (finished) return
      finished = true
      input.remove()
      title.hidden = false
      title.focus()
      if (save) this.#saveTitle(input.value.trim())
    }
    input.addEventListener('keydown', event => {
      if (event.isComposing) return
      if (event.key === 'Enter') finish(true)
      if (event.key !== 'Escape') return
      event.stopPropagation()
      finish(false)
    })
    input.addEventListener('blur', () => finish(true))
  }

  async #saveTitle(newTitle) {
    const titleChanged = newTitle !== '' && newTitle !== this.#config.title
    if (!titleChanged) return
    const previousTitle = this.#config.title
    this.#showTitle(newTitle)
    try {
      const { title } = await api(`/api/artifacts/${encodeURIComponent(this.#config.artifactId)}`, { method: 'PATCH', body: { title: newTitle } })
      this.#showTitle(title)
      Xxd.toast(m.viewerClient.topBar.renamed, { tone: 'success', within: this.#stage })
    } catch (error) {
      this.#showTitle(previousTitle)
      Xxd.toast(userMessageOf(error), { tone: 'danger', within: this.#stage })
    }
  }

  async #copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${location.search}`)
      Xxd.toast(m.viewerClient.topBar.linkCopied, { tone: 'success', within: this.#stage })
    } catch {
      Xxd.toast(m.viewerClient.topBar.linkCopyFailed, { tone: 'danger', within: this.#stage })
    }
  }

  // After removing, home offers to undo it for this artifact.
  async #remove() {
    const takesDown = this.#config.removalTakesDown
    const confirmed = await confirmArtifactRemoval(this.#config.title, takesDown)
    if (!confirmed) return
    try {
      await removeArtifact(this.#config.artifactId)
      location.href = `/?removed=${encodeURIComponent(this.#config.artifactId)}`
    } catch (error) {
      Xxd.toast(m.viewerClient.topBar.removeFailed({ takesDown, reason: userMessageOf(error) }), { tone: 'danger', within: this.#stage })
    }
  }
}
