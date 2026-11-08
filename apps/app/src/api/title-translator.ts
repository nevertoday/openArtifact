const TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b'
// Publishing waits for the translation, so a slow one costs the address its words rather than the publisher their time.
const TRANSLATION_TIMEOUT_MS = 2500
// m2m100 must be told the source language; a title in any other script keeps the words it has.
const SOURCE_LANGUAGES: readonly (readonly [RegExp, string])[] = [
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'ja'],
  [/\p{Script=Hangul}/u, 'ko'],
  [/\p{Script=Han}/u, 'zh'],
  [/\p{Script=Cyrillic}/u, 'ru'],
]

/** Puts a title into English for the words of its address; null when it cannot, and the address keeps the title's own words. */
export interface TitleTranslator {
  toEnglish(title: string): Promise<string | null>
}

/** The part of the Workers AI binding that translates. */
export interface TranslationModels {
  run(model: typeof TRANSLATION_MODEL, input: { text: string; source_lang: string; target_lang: string }): Promise<{ translated_text?: string }>
}

class WorkersAiTitleTranslator implements TitleTranslator {
  readonly #models: TranslationModels

  constructor(models: TranslationModels) {
    this.#models = models
  }

  async toEnglish(title: string): Promise<string | null> {
    const sourceLanguage = SOURCE_LANGUAGES.find(([script]) => script.test(title))?.[1]
    if (sourceLanguage === undefined) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`translation took over ${TRANSLATION_TIMEOUT_MS} ms`)), TRANSLATION_TIMEOUT_MS)
    })
    try {
      const output = await Promise.race([this.#models.run(TRANSLATION_MODEL, { text: title, source_lang: sourceLanguage, target_lang: 'en' }), timeout])
      return output.translated_text ?? null
    } catch (error) {
      console.error(new Error('could not translate a title for its address', { cause: error }))
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

const NO_TRANSLATION: TitleTranslator = { toEnglish: async () => null }

export class TitleTranslators {
  /** Workers AI when the app is bound to it, as in production; local development goes without. */
  static fromEnv(env: { AI?: TranslationModels }): TitleTranslator {
    return env.AI ? new WorkersAiTitleTranslator(env.AI) : NO_TRANSLATION
  }
}
