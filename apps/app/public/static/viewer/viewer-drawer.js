import { m } from '../common.js'

const SHEET_LAYOUT = matchMedia('(max-width: 640px)')
const CLOSING_PULL_PX = 80
const OPENING_PULL_PX = 60
const TAP_PX = 4

/**
 * The panel beside the artifact: comments by default, the page's data when asked for. On a wide screen it pushes
 * the page aside; on a phone it is a sheet that rises half way, drags up to full height and drags down to close.
 * It does not hold focus: the page stays in reach while it is open.
 */
export class ViewerDrawer {
  #viewer
  #element
  #toggleButton
  #view = 'comments'
  #returnFocusTo = null
  /** The sheet put an entry in the history when it opened, so the phone's back button closes it. */
  #holdsHistoryEntry = false

  constructor(viewer, element, toggleButton) {
    this.#viewer = viewer
    this.#element = element
    this.#toggleButton = toggleButton
    element.querySelector('[data-close-drawer]').addEventListener('click', () => this.close())
    this.#wireSheetHandle(element.querySelector('[data-drawer-handle]'))
    window.addEventListener('popstate', () => {
      if (!this.#holdsHistoryEntry) return
      this.#holdsHistoryEntry = false
      this.close()
    })
    // Reloaded while the sheet was open: its entry is still on top with nothing to close, so step off it.
    if (history.state?.viewerSheet) history.back()
  }

  get isOpen() {
    return !this.#element.hidden
  }

  get view() {
    return this.#view
  }

  /** On a phone the drawer covers part of the page instead of sitting beside it. */
  get isSheet() {
    return SHEET_LAYOUT.matches
  }

  /** Opens on a view; `focusTitle` moves focus into the drawer, for when the person asked for it from the bar. */
  open(view, { focusTitle = false } = {}) {
    const wasOpen = this.isOpen
    this.#view = view
    for (const viewElement of this.#element.querySelectorAll('[data-drawer-view]')) viewElement.hidden = viewElement.dataset.drawerView !== view
    this.#element.querySelector('[data-drawer-title]').textContent = m.viewerClient.drawer.titles[view]
    this.#element.querySelector('[data-close-drawer]').setAttribute('aria-label', m.viewerClient.drawer.closeLabels[view])
    if (!wasOpen) {
      this.#returnFocusTo = document.activeElement
      this.#element.hidden = false
      this.#viewer.dataset.sheetHeight = 'half'
      if (this.isSheet) {
        history.pushState({ viewerSheet: true }, '')
        this.#holdsHistoryEntry = true
      }
    }
    if (focusTitle) this.#element.querySelector('[data-drawer-title]').focus({ preventScroll: true })
    this.#showToggleState()
  }

  toggle(view) {
    if (this.isOpen && this.#view === view) this.close()
    else this.open(view, { focusTitle: true })
  }

  close() {
    if (!this.isOpen) return
    const focusWasInside = this.#element.contains(document.activeElement)
    this.#element.hidden = true
    if (focusWasInside) (this.#toggleButton ?? this.#returnFocusTo)?.focus()
    this.#showToggleState()
    if (this.#holdsHistoryEntry) {
      this.#holdsHistoryEntry = false
      history.back()
    }
  }

  #showToggleState() {
    this.#toggleButton?.setAttribute('aria-expanded', String(this.isOpen && this.#view === 'comments'))
  }

  #setSheet(height) {
    this.#viewer.dataset.sheetHeight = height
  }

  // A short pull down closes the sheet, a pull up opens it fully, a tap switches between half and full height.
  #wireSheetHandle(handle) {
    let pull = null
    handle.addEventListener('pointerdown', event => {
      pull = { startY: event.clientY, startTop: this.#element.getBoundingClientRect().top, fullTop: this.#viewer.getBoundingClientRect().top + 24 }
      handle.setPointerCapture(event.pointerId)
      this.#element.setAttribute('data-dragging', '')
    })
    handle.addEventListener('pointermove', event => {
      if (!pull) return
      const top = Math.max(pull.fullTop, pull.startTop + event.clientY - pull.startY)
      this.#element.style.transform = `translateY(${top - pull.fullTop}px)`
    })
    const release = event => {
      if (!pull) return
      const moved = event.clientY - pull.startY
      pull = null
      this.#element.removeAttribute('data-dragging')
      this.#element.style.transform = ''
      if (moved > CLOSING_PULL_PX) this.close()
      else if (moved < -OPENING_PULL_PX) this.#setSheet('full')
      else if (Math.abs(moved) < TAP_PX) this.#setSheet(this.#viewer.dataset.sheetHeight === 'full' ? 'half' : 'full')
    }
    handle.addEventListener('pointerup', release)
    handle.addEventListener('pointercancel', release)
    handle.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp') this.#setSheet('full')
      if (event.key !== 'ArrowDown') return
      if (this.#viewer.dataset.sheetHeight === 'full') this.#setSheet('half')
      else this.close()
    })
  }
}
