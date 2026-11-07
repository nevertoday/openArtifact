import { api, userMessageOf } from './common.js'

// The no-access page: one click asks the author to share; the button then says it was sent and stays off.
const accessRequest = document.querySelector('[data-access-request]')
const requestButton = accessRequest.querySelector('[data-request-access]')
const requestStatus = accessRequest.querySelector('[data-access-request-status]')

requestButton.addEventListener('click', async () => {
  requestButton.disabled = true
  try {
    await Xxd.runBusy(requestButton, () => api(`/api/artifacts/${encodeURIComponent(accessRequest.dataset.accessRequest)}/access-requests`, { method: 'POST' }))
    requestButton.textContent = '已请作者分享'
    requestStatus.textContent = `已通知 ${accessRequest.dataset.authorName}。TA 分享给你后，你会收到通知。`
  } catch (error) {
    requestButton.disabled = false
    requestStatus.textContent = userMessageOf(error)
  }
})
