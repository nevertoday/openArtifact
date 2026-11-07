const loginCard = document.querySelector('[data-next-path]')
const nextPath = loginCard.dataset.nextPath
const sentNotice = document.getElementById('magic-link-sent')
const errorNotice = document.getElementById('login-error')
const emailInput = document.getElementById('login-email')
// The server refuses an address it may not admit with this code; the refusal belongs under the email field.
const EMAIL_NOT_ADMITTED = 'EMAIL_NOT_ADMITTED'
const SIGN_IN_ERRORS = {
  [EMAIL_NOT_ADMITTED]: emailInput.dataset.errorNotAdmitted,
  EXPIRED_TOKEN: '登录链接已过期，请重新发送。',
  INVALID_TOKEN: '登录链接无效或已用过，请重新发送。',
}

class SignInError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function showError(code, message) {
  if (code === EMAIL_NOT_ADMITTED) {
    Xxd.setFieldError(emailInput, message)
    emailInput.focus()
    return
  }
  errorNotice.querySelector('[data-error-text]').textContent = message
  errorNotice.hidden = false
}

async function postAuth(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) throw new SignInError(responseBody.code, responseBody.message ?? `登录失败（${response.status}）`)
  return responseBody
}

document.getElementById('magic-link-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submitButton = event.submitter
  const email = new FormData(event.target).get('email')
  errorNotice.hidden = true
  Xxd.setFieldError(emailInput, '')
  submitButton.setAttribute('aria-busy', 'true')
  try {
    await postAuth('/api/auth/sign-in/magic-link', { email, callbackURL: nextPath, errorCallbackURL: `/login?next=${encodeURIComponent(nextPath)}` })
    sentNotice.querySelector('[data-sent-to]').textContent = email
    sentNotice.hidden = false
    submitButton.textContent = '再发一次'
  } catch (error) {
    showError(error.code, error.message)
  } finally {
    submitButton.removeAttribute('aria-busy')
  }
})

for (const providerButton of document.querySelectorAll('[data-provider-id]')) {
  providerButton.addEventListener('click', async () => {
    const { providerId, providerKind } = providerButton.dataset
    const signInPath = providerKind === 'oidc' ? '/api/auth/sign-in/oauth2' : '/api/auth/sign-in/social'
    const providerField = providerKind === 'oidc' ? { providerId } : { provider: providerId }
    try {
      const { url } = await postAuth(signInPath, { ...providerField, callbackURL: nextPath })
      location.href = url
    } catch (error) {
      showError(error.code, error.message)
    }
  })
}

// Only the error code is taken from the address, so a crafted link cannot put its own words on this page.
const signInError = new URLSearchParams(location.search).get('error')
if (signInError) showError(signInError, SIGN_IN_ERRORS[signInError] ?? `登录失败：${signInError}`)
