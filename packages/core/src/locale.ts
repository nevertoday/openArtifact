/** The languages Open Artifact's own interface speaks. The first is the default when nothing else decides. */
export const LOCALES = ['zh-CN', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = LOCALES[0]

export function parseLocale(value: string | null | undefined): Locale | null {
  return LOCALES.find(locale => locale === value) ?? null
}
