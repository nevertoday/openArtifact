import { api, m, readJsonData, removalText, renderServerTimes, restoreArtifact, userMessageOf } from './common.js'

const homeConfig = readJsonData('home-config')

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
 * The rest of a long list arrives as the person nears its end: the server renders the next screenful at the "load
 * more" link's address, and its cards join the grid. Without scripts the link is plain paging.
 */
class MoreCards {
  #grid
  #loading = false
  #nearEnd = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) this.#load() }, { rootMargin: '600px' })

  constructor(grid) {
    this.#grid = grid
    document.addEventListener('click', event => {
      if (!event.target.closest('[data-load-more]')) return
      event.preventDefault()
      this.#load()
    })
    this.#watch()
  }

  get #link() {
    return document.querySelector('[data-load-more]')
  }

  #watch() {
    this.#nearEnd.disconnect()
    if (this.#link) this.#nearEnd.observe(this.#link)
  }

  async #load() {
    const link = this.#link
    if (!link || this.#loading) return
    this.#loading = true
    link.setAttribute('aria-busy', 'true')
    try {
      const response = await fetch(link.href, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`home page answered ${response.status}`)
      const nextPage = new DOMParser().parseFromString(await response.text(), 'text/html')
      const cards = [...nextPage.querySelectorAll('[data-artifact-grid] > *')]
      this.#grid.append(...cards)
      renderServerTimes(this.#grid)
      const nextLink = nextPage.querySelector('[data-load-more]')
      if (nextLink) link.replaceWith(nextLink)
      else link.closest('.home-more').remove()
    } catch (error) {
      // The link stays, so pressing it tries again or, failing that, pages the plain way.
      link.removeAttribute('aria-busy')
      console.error(new Error('could not load more of the home page', { cause: error }))
    } finally {
      this.#loading = false
      this.#watch()
    }
  }
}

if (homeConfig?.justRemoved) offerUndo(homeConfig.justRemoved)
// Delegated, because more cards and rows arrive after the page loads.
document.addEventListener('click', event => {
  const restoreButton = event.target.closest('[data-restore-artifact]')
  if (restoreButton) restoreFromList(restoreButton)
  const purgeButton = event.target.closest('[data-purge-artifact]')
  if (purgeButton) purgeFromList(purgeButton)
})
document.addEventListener('change', event => {
  const navigatingSelect = event.target.closest('select[data-navigate]')
  if (navigatingSelect) location.href = navigatingSelect.value
})
const grid = document.querySelector('[data-artifact-grid]')
if (grid) new MoreCards(grid)
