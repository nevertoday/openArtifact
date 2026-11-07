const TYPING_FIELDS = 'input, textarea, select, [contenteditable]'

/**
 * The viewer's keys, whether the viewer page or the artifact frame has focus: C, J, K and ? run their actions;
 * Esc closes the topmost layer the viewer drew, in the order of `layers`; ⌘↵ or Ctrl+↵ sends the form being typed
 * in. Menus, popovers and dialogs handle their own Esc first, and nothing here fires while someone is typing.
 */
export class ViewerKeys {
  #actions
  #layers
  #shortcutSheet

  constructor({ frame, actions, layers, shortcutSheet }) {
    this.#actions = actions
    this.#layers = layers
    this.#shortcutSheet = shortcutSheet
    document.addEventListener('keydown', event => this.#onKeydown(event))
    frame.addEventListener('key', event => this.#run(event.detail.key))
  }

  openShortcutSheet() {
    Xxd.openDialog(this.#shortcutSheet)
  }

  #onKeydown(event) {
    if (event.repeat || event.isComposing) return
    const sendsForm = event.key === 'Enter' && (event.metaKey || event.ctrlKey)
    const form = event.target.closest?.('form')
    if (sendsForm && form) {
      event.preventDefault()
      return form.requestSubmit()
    }
    if (event.key === 'Escape') return this.#escape(event)
    const typing = event.target.closest?.(TYPING_FIELDS)
    if (event.metaKey || event.ctrlKey || event.altKey || typing) return
    if (this.#run(event.key)) event.preventDefault()
  }

  #escape(event) {
    const ownLayerIsOpen = document.querySelector('[popover]:popover-open, dialog[open]')
    if (ownLayerIsOpen) return
    if (this.#closeTopLayer()) event.preventDefault()
  }

  #closeTopLayer() {
    const topLayer = this.#layers.find(layer => layer.isOpen())
    topLayer?.close()
    return Boolean(topLayer)
  }

  /** Runs the key's action; true when the key meant something here. */
  #run(key) {
    if (key === 'Escape') return this.#closeTopLayer()
    const action = this.#actions.get(key.toLowerCase())
    action?.()
    return Boolean(action)
  }
}
