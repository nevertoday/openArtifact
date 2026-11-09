import { api, m, readJsonData, removalText, renderServerTimes, restoreArtifact, userMessageOf } from './common.js'

const homeConfig = readJsonData('home-config')
const SEARCH_DELAY_MS = 250

// Arriving from the viewer right after a removal: the address loses ?removed so a reload does not offer it again.
function offerUndo(justRemoved) {
  const homeUrl = new URL(location.href)
  homeUrl.searchParams.delete('removed')
  history.replaceState(null, '', homeUrl.pathname + homeUrl.search)
  Xxd.toast(removalText(justRemoved.removedAsAdmin).done(justRemoved.title), {
    tone: 'success',
    action: { label: m.client.home.undo, onClick: () => undoRemoval(justRemoved) },
  })
}

async function undoRemoval(justRemoved) {
  try {
    const { url } = await restoreArtifact(justRemoved.artifactId)
    location.href = url
  } catch (error) {
    Xxd.toast(m.client.home.undoFailed(userMessageOf(error)), { tone: 'danger' })
  }
}

async function restoreFromList(restoreButton) {
  restoreButton.setAttribute('aria-busy', 'true')
  try {
    const { url } = await restoreArtifact(restoreButton.dataset.restoreArtifact)
    restoreButton.closest('tr')?.remove()
    showOneFewerRemoved()
    Xxd.toast(m.client.restore.done(restoreButton.dataset.title), { tone: 'success', action: { label: m.client.restore.open, onClick: () => { location.href = url } } })
  } catch (error) {
    Xxd.toast(m.client.restore.failed(userMessageOf(error)), { tone: 'danger' })
  } finally {
    restoreButton.removeAttribute('aria-busy')
  }
}

async function purgeFromList(purgeButton) {
  const { title } = purgeButton.dataset
  const confirmed = await Xxd.confirmDialog({
    title: m.client.purge.confirmTitle(title),
    message: m.client.purge.confirmMessage,
    confirmLabel: m.client.purge.confirm,
    cancelLabel: m.client.dialog.cancel,
    closeLabel: m.client.dialog.close,
    tone: 'danger',
  })
  if (!confirmed) return
  purgeButton.setAttribute('aria-busy', 'true')
  try {
    await api(`/api/artifacts/${encodeURIComponent(purgeButton.dataset.purgeArtifact)}/purge`, { method: 'POST' })
    purgeButton.closest('tr')?.remove()
    showOneFewerRemoved()
    Xxd.toast(m.client.purge.done(title), { tone: 'success' })
  } catch (error) {
    Xxd.toast(m.client.purge.failed(userMessageOf(error)), { tone: 'danger' })
  } finally {
    purgeButton.removeAttribute('aria-busy')
  }
}

function showOneFewerRemoved() {
  const removedCount = document.querySelector('[data-removed-count] .xxd-badge')
  if (!removedCount) return
  const remaining = Math.max(0, Number(removedCount.textContent) - 1)
  removedCount.textContent = remaining > 0 ? String(remaining) : ''
  removedCount.title = m.client.home.artifactCount(remaining)
}

/**
 * Filters as the person types: the server renders the same page for the new address and its list, count and
 * sidebar links replace the current ones, so matching has one owner. Enter still submits the form as a plain GET.
 */
class LiveSearch {
  #searchInput
  #timer = null
  #latestRequest = 0

  constructor(searchForm) {
    this.#searchInput = searchForm.querySelector('input[name="q"]')
    this.#searchInput.addEventListener('input', () => this.#schedule())
    searchForm.addEventListener('submit', () => clearTimeout(this.#timer))
  }

  #schedule() {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#show(this.#searchInput.value.trim()), SEARCH_DELAY_MS)
  }

  async #show(searchText) {
    const resultUrl = new URL(location.href)
    if (searchText === '') resultUrl.searchParams.delete('q')
    else resultUrl.searchParams.set('q', searchText)
    const request = ++this.#latestRequest
    try {
      const response = await fetch(resultUrl, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`home page answered ${response.status}`)
      const resultPage = new DOMParser().parseFromString(await response.text(), 'text/html')
      if (request !== this.#latestRequest) return
      LiveSearch.#replace('#main', resultPage)
      LiveSearch.#replace('.home-sidebar', resultPage)
      renderServerTimes(document.getElementById('main'))
      history.replaceState(null, '', resultUrl.pathname + resultUrl.search)
    } catch (error) {
      console.error(new Error('could not filter the home page while typing', { cause: error }))
    }
  }

  static #replace(selector, resultPage) {
    const current = document.querySelector(selector)
    const replacement = resultPage.querySelector(selector)
    if (current && replacement) current.replaceChildren(...replacement.childNodes)
  }
}

if (homeConfig?.justRemoved) offerUndo(homeConfig.justRemoved)
// Delegated, because the live search replaces the list and its buttons.
document.addEventListener('click', event => {
  const restoreButton = event.target.closest('[data-restore-artifact]')
  if (restoreButton) restoreFromList(restoreButton)
  const purgeButton = event.target.closest('[data-purge-artifact]')
  if (purgeButton) purgeFromList(purgeButton)
})
document.addEventListener('change', event => {
  const sourcePicker = event.target.closest('[data-source-picker]')
  if (sourcePicker) location.href = sourcePicker.value
})
const searchForm = document.querySelector('[data-home-search]')
if (searchForm) new LiveSearch(searchForm)
