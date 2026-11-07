import { describe, expect, it } from 'vitest'
import { resolveLocale } from '../src/i18n/resolve-locale.ts'
import { APP_ORIGIN, TestApp } from './test-app.ts'

const app = new TestApp()

const signals = { account: null, browser: null, acceptLanguage: null, fallback: 'zh-CN' } as const

describe('which language a request is answered in', () => {
  it('follows the browser’s preferred languages in order, matching any region of a language', () => {
    expect(resolveLocale({ ...signals, acceptLanguage: 'en-GB,en;q=0.9' })).toBe('en')
    expect(resolveLocale({ ...signals, acceptLanguage: 'fr-FR, en;q=0.8, zh-TW;q=0.9' })).toBe('zh-CN')
    expect(resolveLocale({ ...signals, acceptLanguage: 'de, en;q=0' })).toBe('zh-CN')
    expect(resolveLocale({ ...signals, acceptLanguage: '*' })).toBe('zh-CN')
  })

  it('lets a choice made in this browser win over the browser’s languages, and an account’s choice win over both', () => {
    expect(resolveLocale({ ...signals, browser: 'en', acceptLanguage: 'zh-CN' })).toBe('en')
    expect(resolveLocale({ ...signals, account: 'zh-CN', browser: 'en', acceptLanguage: 'en' })).toBe('zh-CN')
  })

  it('falls back to the deployment’s default', () => {
    expect(resolveLocale({ ...signals, fallback: 'en' })).toBe('en')
  })
})

describe('the language switch', () => {
  const htmlLang = async (response: Response) => /<html lang="([^"]+)">/.exec(await response.text())?.[1]

  it('answers in Chinese by default and in English for a browser that asks for it', async () => {
    expect(await htmlLang(await app.request('/login'))).toBe('zh-CN')
    expect(await htmlLang(await app.request('/login', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }))).toBe('en')
  })

  it('remembers a visitor’s choice in the browser and goes back to the page they switched on', async () => {
    const switched = await app.request('/locale', { method: 'POST', form: { locale: 'en' }, headers: { Referer: `${APP_ORIGIN}/login?next=/settings` } })

    expect(switched.status).toBe(303)
    expect(switched.headers.get('Location')).toBe(`${APP_ORIGIN}/login?next=/settings`)
    const localeCookie = switched.headers.get('Set-Cookie')?.split(';')[0] ?? ''
    expect(localeCookie).toBe('oa_locale=en')
    expect(await htmlLang(await app.request('/login', { cookie: localeCookie, headers: { 'Accept-Language': 'zh-CN' } }))).toBe('en')
  })

  it('keeps a signed-in person’s choice on their account, so it follows them to another browser', async () => {
    const laptop = await app.signIn('locale-switcher@example.com')
    await app.request('/locale', { method: 'POST', form: { locale: 'en' }, cookie: laptop })
    const phone = await app.signIn('locale-switcher@example.com')

    expect(await htmlLang(await app.request('/', { cookie: phone, headers: { 'Accept-Language': 'zh-CN' } }))).toBe('en')
    const profile = await app.repositories.users.findByEmail('locale-switcher@example.com')
    expect(profile?.locale).toBe('en')
  })

  it('never sends anyone off the site, and refuses a language it does not offer', async () => {
    const offSite = await app.request('/locale', { method: 'POST', form: { locale: 'en' }, headers: { Referer: 'https://evil.example/' } })
    expect(offSite.headers.get('Location')).toBe(`${APP_ORIGIN}/`)

    const unknown = await app.request('/locale', { method: 'POST', form: { locale: 'fr' } })
    expect(unknown.status).toBe(400)
  })

  it('offers every language, each named in itself, and marks the current one', async () => {
    const markup = await (await app.request('/login', { headers: { 'Accept-Language': 'en' } })).text()

    expect(markup).toContain('<form method="post" action="/locale"')
    expect(markup).toMatch(/value="zh-CN" lang="zh-CN" aria-pressed="false">中文</)
    expect(markup).toMatch(/value="en" lang="en" aria-pressed="true">English</)
  })
})
