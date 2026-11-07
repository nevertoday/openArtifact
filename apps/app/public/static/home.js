import { readJsonData, removalWord, restoreArtifact, userMessageOf } from './common.js'

const homeConfig = readJsonData('home-config')

// Arriving from the viewer right after a removal: the address loses ?removed so a reload does not offer it again.
function offerUndo(justRemoved) {
  const homeUrl = new URL(location.href)
  homeUrl.searchParams.delete('removed')
  history.replaceState(null, '', homeUrl.pathname + homeUrl.search)
  Xxd.toast(`已${removalWord(justRemoved.removedAsAdmin)}「${justRemoved.title}」`, {
    tone: 'success',
    action: { label: '撤销', onClick: () => undoRemoval(justRemoved) },
  })
}

async function undoRemoval(justRemoved) {
  try {
    const { url } = await restoreArtifact(justRemoved.artifactId)
    location.href = url
  } catch (error) {
    Xxd.toast(`撤销失败：${userMessageOf(error)}`, { tone: 'danger' })
  }
}

async function restoreFromList(restoreButton) {
  restoreButton.setAttribute('aria-busy', 'true')
  try {
    const { url } = await restoreArtifact(restoreButton.dataset.restoreArtifact)
    restoreButton.closest('tr')?.remove()
    showOneFewerRemoved()
    Xxd.toast(`已恢复「${restoreButton.dataset.title}」`, { tone: 'success', action: { label: '打开', onClick: () => { location.href = url } } })
  } catch (error) {
    Xxd.toast(`恢复失败：${userMessageOf(error)}`, { tone: 'danger' })
  } finally {
    restoreButton.removeAttribute('aria-busy')
  }
}

function showOneFewerRemoved() {
  const removedCount = document.querySelector('[data-removed-count] .xxd-badge')
  if (removedCount) removedCount.textContent = String(Math.max(0, Number(removedCount.textContent) - 1))
}

if (homeConfig?.justRemoved) offerUndo(homeConfig.justRemoved)
for (const restoreButton of document.querySelectorAll('[data-restore-artifact]')) {
  restoreButton.addEventListener('click', () => restoreFromList(restoreButton))
}
