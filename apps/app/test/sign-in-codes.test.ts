import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { SignInGuesses } from '../src/auth/sign-in-guesses.ts'
import { TestApp } from './test-app.ts'

const app = new TestApp()

async function mailedCode(email: string): Promise<string> {
  const sent = await app.sendCode(email)
  expect(sent.status).toBe(200)
  return app.mailer.lastCodeTo(email)
}

function wrongCodeFor(code: string): string {
  return code === '000000' ? '111111' : '000000'
}

async function errorCodeOf(response: Response): Promise<string> {
  return ((await response.json()) as { code: string }).code
}

describe('signing in with a mailed code', () => {
  it('mails six digits that sign the person in once, and puts the code in the subject', async () => {
    const code = await mailedCode('code@example.com')
    const mail = app.mailer.lastTo('code@example.com')

    const signedIn = await app.enterCode('code@example.com', code)
    const replayed = await app.enterCode('code@example.com', code)

    expect(code).toMatch(/^\d{6}$/)
    expect(mail?.subject).toBe(`${code} 是你的 Open Artifact 验证码`)
    expect(mail?.text).toContain('10 分钟内有效')
    expect(mail?.text).not.toMatch(/https?:\/\//)
    expect(signedIn.status).toBe(200)
    expect(signedIn.headers.getSetCookie().join()).toContain('session_token')
    expect(await errorCodeOf(replayed)).toBe('INVALID_OTP')
  })

  it('refuses a wrong code without a session, and still takes the right one after it', async () => {
    const code = await mailedCode('typo@example.com')

    const wrong = await app.enterCode('typo@example.com', wrongCodeFor(code))
    const right = await app.enterCode('typo@example.com', code)

    expect(wrong.status).toBe(400)
    expect(await errorCodeOf(wrong)).toBe('INVALID_OTP')
    expect(wrong.headers.getSetCookie().join()).not.toContain('session_token')
    expect(right.status).toBe(200)
  })

  it('spends a code after three wrong tries, so guessing stops at three in a million', async () => {
    const code = await mailedCode('guesser@example.com')

    for (let attempt = 0; attempt < 3; attempt++) await app.enterCode('guesser@example.com', wrongCodeFor(code))
    const rightButTooLate = await app.enterCode('guesser@example.com', code)

    expect(rightButTooLate.status).toBe(403)
    expect(await errorCodeOf(rightButTooLate)).toBe('TOO_MANY_ATTEMPTS')
  })

  it('lets only the newest code work after the person asks again', async () => {
    const first = await mailedCode('again@example.com')
    let second = await mailedCode('again@example.com')
    while (second === first) second = await mailedCode('again@example.com')

    const withFirst = await app.enterCode('again@example.com', first)
    const withSecond = await app.enterCode('again@example.com', second)

    expect(withFirst.status).toBe(400)
    expect(withSecond.status).toBe(200)
  })

  it('refuses a code older than ten minutes', async () => {
    const code = await mailedCode('late@example.com')
    await env.DB.prepare(`UPDATE verification SET "expiresAt" = ? WHERE identifier LIKE ?`).bind(new Date(Date.now() - 1000).toISOString(), '%late@example.com%').run()

    const expired = await app.enterCode('late@example.com', code)

    expect(expired.status).toBe(400)
    expect(await errorCodeOf(expired)).toBe('OTP_EXPIRED')
  })

  it('keeps only a hash of the code in the database', async () => {
    const code = await mailedCode('hashed@example.com')
    const { results } = await env.DB.prepare(`SELECT value FROM verification WHERE identifier LIKE ?`).bind('%hashed@example.com%').all<{ value: string }>()

    expect(results.length).toBe(1)
    expect(results[0]?.value).not.toContain(code)
  })

  it('mails a code only when asked from this site', async () => {
    const fromElsewhere = await app.sendCode('crosssite@example.com', { origin: 'https://evil.example' })

    expect(fromElsewhere.status).toBe(403)
    expect(app.mailer.lastTo('crosssite@example.com')).toBeUndefined()
  })

  it.each([
    '/email-otp/send-verification-otp',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/request-email-change',
    '/email-otp/change-email',
  ])('leaves no other code endpoint open, so every code passes admission, the limits and the guess cap (%s)', async path => {
    const answer = await app.request(`/api/auth${path}`, { method: 'POST', body: { email: 'stranger@other.org', type: 'sign-in', otp: '000000' } })

    expect(answer.status).toBe(404)
    expect(app.mailer.lastTo('stranger@other.org')).toBeUndefined()
  })

  it('stops code sign-in for an address after ten wrong codes in a day, even with the right code', async () => {
    let code = ''
    for (let wrong = 0; wrong < 10; wrong++) {
      if (wrong % 3 === 0) code = await mailedCode('target@example.com')
      await app.enterCode('target@example.com', wrongCodeFor(code))
    }
    const askedAgain = await app.sendCode('target@example.com')
    const rightCode = await app.enterCode('target@example.com', code)
    const someoneElse = await mailedCode('bystander@example.com')

    expect(askedAgain.status).toBe(429)
    expect(await errorCodeOf(askedAgain)).toBe('SIGN_IN_LOCKED')
    expect(rightCode.status).toBe(429)
    expect(rightCode.headers.getSetCookie().join()).not.toContain('session_token')
    expect(someoneElse).toMatch(/^\d{6}$/)
  })

  it('counts wrong codes across letter case and spaces, as one address', async () => {
    let code = ''
    for (let wrong = 0; wrong < 10; wrong++) {
      if (wrong % 3 === 0) code = await mailedCode('cased@example.com')
      await app.enterCode(wrong % 2 === 0 ? ' Cased@Example.com ' : 'CASED@example.com', wrongCodeFor(code))
    }

    expect(await errorCodeOf(await app.sendCode('cased@example.com'))).toBe('SIGN_IN_LOCKED')
  })

  it('does not count a right code as a guess', async () => {
    for (let round = 0; round < 12; round++) {
      const code = await mailedCode('honest@example.com')
      expect((await app.enterCode('honest@example.com', code)).status).toBe(200)
    }

    expect((await app.sendCode('honest@example.com')).status).toBe(200)
  })

  it('says so when the code could not be mailed, instead of claiming it was sent', async () => {
    const outage = new TestApp()
    outage.mailer.goOutOfService()

    const asked = await outage.sendCode('unlucky@example.com')

    expect(asked.status).toBe(503)
    expect(await errorCodeOf(asked)).toBe('CODE_NOT_MAILED')
  })

  it('refuses an address that is not an email', async () => {
    const asked = await app.sendCode('not-an-email')

    expect(asked.status).toBe(400)
    expect(await errorCodeOf(asked)).toBe('INVALID_EMAIL')
  })
})

describe('the cap on wrong codes', () => {
  it('lifts a day after the wrong codes were typed', async () => {
    let now = Date.UTC(2026, 10, 8, 9)
    const guesses = new SignInGuesses(app.repositories.signInCodeFailures, () => now)
    for (let wrong = 0; wrong < SignInGuesses.LIMIT; wrong++) await guesses.recordWrong('aged@example.com')

    const lockedAtFirst = await guesses.isLocked('aged@example.com')
    now += SignInGuesses.WINDOW_MS - 1
    const lockedJustBefore = await guesses.isLocked('aged@example.com')
    now += 1
    const lockedAfterADay = await guesses.isLocked('aged@example.com')

    expect([lockedAtFirst, lockedJustBefore, lockedAfterADay]).toEqual([true, true, false])
  })
})
