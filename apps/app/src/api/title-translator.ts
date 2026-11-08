const TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b'
// Publishing waits for the translation, so a slow one costs the address its words rather than the publisher their time.
const TRANSLATION_TIMEOUT_MS = 2500

/** The part of the Workers AI binding that translates. */
export interface TranslationModels {
  run(model: typeof TRANSLATION_MODEL, input: { text: string; source_lang: string; target_lang: string }): Promise<{ translated_text?: string }>
}

/**
 * Puts a Chinese title into English for the words of its address. Without the AI binding, as in local development,
 * or when translation fails, the answer is null and the address keeps only the title's own English words.
 */
export class TitleTranslator {
  readonly #models: TranslationModels | undefined

  constructor(models: TranslationModels | undefined) {
    this.#models = models
  }

  async toEnglish(title: string): Promise<string | null> {
    if (!this.#models) return null
    try {
      const translation = await this.#models.run(TRANSLATION_MODEL, { text: title, source_lang: 'zh', target_lang: 'en' })
        .then(output => output.translated_text ?? null)
      return await Promise.race([translation, TitleTranslator.#timeout()])
    } catch (error) {
      console.error(new Error('could not translate a title for its address', { cause: error }))
      return null
    }
  }

  static #timeout(): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(`translation took over ${TRANSLATION_TIMEOUT_MS} ms`)), TRANSLATION_TIMEOUT_MS))
  }
}
