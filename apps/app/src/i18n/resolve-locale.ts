import { DEFAULT_LOCALE, LOCALES, parseLocale, type Locale } from '@open-artifact/core'
import { HttpCookies } from '../http-cookies.ts'

/** Set when a person picks a language in this browser; it decides for visitors who are not signed in. */
export const LOCALE_COOKIE = 'oa_locale'

export interface LocaleSignals {
  /** What a signed-in person chose for their account, which follows them to every device. */
  account: Locale | null
  /** What was chosen in this browser. */
  browser: Locale | null
  acceptLanguage: string | null
  fallback: Locale
}

/** The deployment's language for requests that say nothing: DEFAULT_LOCALE when it names a language, else the default. */
export function fallbackLocaleOf(env: { DEFAULT_LOCALE?: string | undefined }): Locale {
  return parseLocale(env.DEFAULT_LOCALE) ?? DEFAULT_LOCALE
}

/** What a request's headers say about language: the browser's choice and its Accept-Language. */
export function requestLocaleSignals(headers: Headers | null): Pick<LocaleSignals, 'browser' | 'acceptLanguage'> {
  return {
    browser: headers ? parseLocale(HttpCookies.read({ headers }, LOCALE_COOKIE)) : null,
    acceptLanguage: headers?.get('Accept-Language') ?? null,
  }
}

/** A choice someone made wins over what the browser asks for; the deployment's default comes last. */
export function resolveLocale(signals: LocaleSignals): Locale {
  return signals.account ?? signals.browser ?? localeFromAcceptLanguage(signals.acceptLanguage) ?? signals.fallback
}

// Matched on the primary subtag, so zh-TW and en-GB find the one Chinese and the one English there are.
function localeFromAcceptLanguage(header: string | null): Locale | null {
  const ranges = (header ?? '')
    .split(',')
    .map(part => {
      const [tag = '', ...parameters] = part.trim().split(';')
      const quality = parameters.map(parameter => /^\s*q=([\d.]+)\s*$/.exec(parameter)?.[1]).find(value => value !== undefined)
      return { primary: tag.trim().toLowerCase().split('-')[0] ?? '', quality: quality === undefined ? 1 : Number(quality) }
    })
    .filter(range => range.primary !== '' && range.quality > 0)
    .sort((left, right) => right.quality - left.quality)
  for (const range of ranges) {
    const locale = LOCALES.find(candidate => candidate.toLowerCase().split('-')[0] === range.primary)
    if (locale) return locale
  }
  return null
}
