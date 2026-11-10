import { m, restoreArtifact, userMessageOf } from './common.js'

// The page of a removed artifact, for someone who may restore it: one press brings it back and opens it.
const restoreButton = document.querySelector('[data-restore-removed]')
const restoreStatus = document.querySelector('[data-restore-status]')

restoreButton.addEventListener('click', async () => {
  try {
    const { url } = await Xxd.runBusy(restoreButton, () => restoreArtifact(restoreButton.dataset.restoreRemoved))
    location.href = url
  } catch (error) {
    restoreStatus.textContent = m.client.restore.failed(userMessageOf(error))
  }
})
