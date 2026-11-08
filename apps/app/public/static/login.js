import { m } from './common.js'

const loginCard = document.querySelector('[data-next-path]')
const nextPath = loginCard.dataset.nextPath
const errorNotice = document.getElementById('login-error')
const emailStep = document.getElementById('email-step')
const emailInput = document.getElementById('login-email')
const sendButton = emailStep.querySelector('[type="submit"]')
const codeStep = document.getElementById('code-step')
const codeBox = codeStep.querySelector('.login-code')
const codeInput = document.getElementById('login-code')
const codeCells = [...codeStep.querySelectorAll('.login-code__cell')]
const resendButton = codeStep.querySelector('[data-resend]')
const emailStepIntro = loginCard.querySelector('[data-email-step-intro]')
const SEND_CODE_PATH = '/api/auth/sign-in/send-code'
const CHECK_CODE_PATH = '/api/auth/sign-in/email-otp'
const RESEND_COOLDOWN_SECONDS = 60
// The server refuses an address it may not admit with this code; the refusal belongs under the email field.
const EMAIL_NOT_ADMITTED = 'EMAIL_NOT_ADMITTED'
const SIGN_IN_ERRORS = {
  [EMAIL_NOT_ADMITTED]: emailInput.dataset.errorNotAdmitted,
  ...m.client.login.errors,
}

class SignInError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function showError(code) {
  const message = SIGN_IN_ERRORS[code] ?? m.client.login.unknownError
  if (code === EMAIL_NOT_ADMITTED && !emailStep.hidden) {
    Xxd.setFieldError(emailInput, message)
    emailInput.focus()
    return
  }
  errorNotice.querySelector('[data-error-text]').textContent = message
  errorNotice.hidden = false
}

function clearErrors() {
  errorNotice.hidden = true
  Xxd.setFieldError(emailInput, '')
  delete codeBox.dataset.invalid
}

async function postAuth(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const responseBody = await response.json().catch(() => ({}))
  if (!response.ok) throw new SignInError(responseBody.code, responseBody.message ?? `sign-in failed with ${response.status}`)
  return responseBody
}

/** After a code is sent, sending another waits a minute. */
class ResendCooldown {
  #timer = null

  start() {
    this.stop()
    this.#tick(RESEND_COOLDOWN_SECONDS)
  }

  stop() {
    clearTimeout(this.#timer)
  }

  #tick(secondsLeft) {
    const waiting = secondsLeft > 0
    resendButton.disabled = waiting
    resendButton.textContent = waiting ? m.client.login.resendIn(secondsLeft) : m.client.login.resend
    if (waiting) this.#timer = setTimeout(() => this.#tick(secondsLeft - 1), 1000)
  }
}

const resendCooldown = new ResendCooldown()
/** The address the code on screen was sent to; null while the person is still on the email step. */
let codeSentTo = null

function paintCode() {
  const digits = codeInput.value
  const typing = document.activeElement === codeInput
  codeCells.forEach((cell, index) => {
    cell.textContent = digits[index] ?? ''
    cell.toggleAttribute('data-current', typing && index === Math.min(digits.length, codeCells.length - 1))
  })
}

function showCodeStep(email) {
  codeSentTo = email
  codeStep.querySelector('[data-sent-to]').textContent = email
  emailStep.hidden = true
  if (emailStepIntro) emailStepIntro.hidden = true
  codeStep.hidden = false
  codeInput.value = ''
  codeInput.focus()
  paintCode()
  resendCooldown.start()
}

function showEmailStep() {
  codeSentTo = null
  resendCooldown.stop()
  clearErrors()
  codeStep.hidden = true
  if (emailStepIntro) emailStepIntro.hidden = false
  emailStep.hidden = false
  emailInput.focus()
  emailInput.select()
}

async function checkCode() {
  codeInput.readOnly = true
  codeBox.setAttribute('aria-busy', 'true')
  try {
    await postAuth(CHECK_CODE_PATH, { email: codeSentTo, otp: codeInput.value })
    location.assign(nextPath)
  } catch (error) {
    codeBox.dataset.invalid = ''
    codeInput.value = ''
    paintCode()
    showError(error.code)
  } finally {
    codeInput.readOnly = false
    codeBox.removeAttribute('aria-busy')
  }
}

emailStep.addEventListener('submit', async event => {
  event.preventDefault()
  const email = String(new FormData(emailStep).get('email')).trim()
  clearErrors()
  sendButton.disabled = true
  sendButton.setAttribute('aria-busy', 'true')
  try {
    await postAuth(SEND_CODE_PATH, { email })
    showCodeStep(email)
  } catch (error) {
    showError(error.code)
  } finally {
    sendButton.disabled = false
    sendButton.removeAttribute('aria-busy')
  }
})

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, codeCells.length)
  clearErrors()
  paintCode()
  if (codeInput.value.length === codeCells.length) checkCode()
})
codeInput.addEventListener('focus', paintCode)
codeInput.addEventListener('blur', paintCode)
codeStep.addEventListener('submit', event => event.preventDefault())
codeStep.querySelector('[data-change-email]').addEventListener('click', showEmailStep)

resendButton.addEventListener('click', async () => {
  clearErrors()
  resendButton.disabled = true
  try {
    await postAuth(SEND_CODE_PATH, { email: codeSentTo })
    codeInput.value = ''
    codeInput.focus()
    paintCode()
    resendCooldown.start()
  } catch (error) {
    resendButton.disabled = false
    showError(error.code)
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
