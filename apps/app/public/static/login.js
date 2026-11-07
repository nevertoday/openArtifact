const loginCard = document.querySelector('[data-next-path]')
const nextPath = loginCard.dataset.nextPath
const sentNotice = document.getElementById('magic-link-sent')
const errorNotice = document.getElementById('login-error')
const emailInput = document.getElementById('login-email')
const magicLinkForm = document.getElementById('magic-link-form')
const sendButton = magicLinkForm.querySelector('[type="submit"]')
const SEND_LABEL = sendButton.textContent
const RESEND_COOLDOWN_SECONDS = 60
// The server refuses an address it may not admit with this code; the refusal belongs under the email field.
const EMAIL_NOT_ADMITTED = 'EMAIL_NOT_ADMITTED'
const SIGN_IN_ERRORS = {
  [EMAIL_NOT_ADMITTED]: emailInput.dataset.errorNotAdmitted,
  EXPIRED_TOKEN: '登录链接已过期，请重新发送。',
  INVALID_TOKEN: '登录链接无效或已用过，请重新发送。',
  rate_limited: '登录链接发得太频繁了，请等一分钟再试。',
}
const UNKNOWN_SIGN_IN_ERROR = '登录没有成功，请重新发送登录链接。'

class SignInError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function showError(code) {
  const message = SIGN_IN_ERRORS[code] ?? UNKNOWN_SIGN_IN_ERROR
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
  if (!response.ok) throw new SignInError(responseBody.code, responseBody.message ?? `sign-in failed with ${response.status}`)
  return responseBody
}

/** After a link is sent, 再发一次 waits a minute; typing another address makes it 发送登录链接 again at once. */
class ResendCooldown {
  #timer = null
  #sentTo = null

  start(email) {
    this.#sentTo = email
    this.#tick(RESEND_COOLDOWN_SECONDS)
  }

  /** The person is typing; a different address is a first send, not a resend. */
  emailChanged(email) {
    if (this.#sentTo === null || email === this.#sentTo) return
    this.#stop()
    this.#sentTo = null
    sentNotice.hidden = true
    sendButton.textContent = SEND_LABEL
  }

  #tick(secondsLeft) {
    const waiting = secondsLeft > 0
    sendButton.disabled = waiting
    sendButton.textContent = waiting ? `再发一次（${secondsLeft} 秒）` : '再发一次'
    if (waiting) this.#timer = setTimeout(() => this.#tick(secondsLeft - 1), 1000)
  }

  #stop() {
    clearTimeout(this.#timer)
    sendButton.disabled = false
  }
}

const resendCooldown = new ResendCooldown()
emailInput.addEventListener('input', () => resendCooldown.emailChanged(emailInput.value.trim()))

magicLinkForm.addEventListener('submit', async event => {
  event.preventDefault()
  const email = String(new FormData(magicLinkForm).get('email')).trim()
  errorNotice.hidden = true
  Xxd.setFieldError(emailInput, '')
  sendButton.disabled = true
  sendButton.setAttribute('aria-busy', 'true')
  try {
    await postAuth('/api/auth/sign-in/magic-link', { email, callbackURL: nextPath, errorCallbackURL: `/login?next=${encodeURIComponent(nextPath)}` })
    sentNotice.querySelector('[data-sent-to]').textContent = email
    sentNotice.hidden = false
    resendCooldown.start(email)
  } catch (error) {
    sendButton.disabled = false
    showError(error.code)
  } finally {
    sendButton.removeAttribute('aria-busy')
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
      showError(error.code)
    }
  })
}

// Only the error code is taken from the address, so a crafted link cannot put its own words on this page.
const signInError = new URLSearchParams(location.search).get('error')
if (signInError) showError(signInError)
