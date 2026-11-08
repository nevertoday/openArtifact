import { describe, expect, it } from 'vitest'
import { TitleTranslators, type TranslationModels } from '../src/api/title-translator.ts'

function modelsAnswering(answer: (input: { text: string; source_lang: string }) => Promise<{ translated_text?: string }>): TranslationModels & { asked: { text: string; source_lang: string }[] } {
  const asked: { text: string; source_lang: string }[] = []
  return {
    asked,
    run: async (_model, input) => {
      asked.push({ text: input.text, source_lang: input.source_lang })
      return answer(input)
    },
  }
}

describe('translating a title through Workers AI', () => {
  it('names the language of the title to the model', async () => {
    const models = modelsAnswering(async () => ({ translated_text: 'Quarterly sales review' }))
    const translator = TitleTranslators.fromEnv({ AI: models })

    expect(await translator.toEnglish('季度销售复盘')).toBe('Quarterly sales review')
    await translator.toEnglish('ロードマップ計画')
    expect(models.asked.map(input => input.source_lang)).toEqual(['zh', 'ja'])
  })

  it('leaves a title in a script it cannot name to its own words', async () => {
    const models = modelsAnswering(async () => ({ translated_text: 'never asked' }))

    expect(await TitleTranslators.fromEnv({ AI: models }).toEnglish('Ελληνικά')).toBeNull()
    expect(models.asked).toEqual([])
  })

  it('answers nothing when the model fails or is slow, so publishing goes on', async () => {
    const failing = TitleTranslators.fromEnv({ AI: modelsAnswering(async () => { throw new Error('Workers AI is unavailable') }) })
    const hanging = TitleTranslators.fromEnv({ AI: modelsAnswering(() => new Promise(() => {})) })

    expect(await failing.toEnglish('季度销售复盘')).toBeNull()
    expect(await hanging.toEnglish('季度销售复盘')).toBeNull()
  })

  it('answers nothing without the binding, as in local development', async () => {
    expect(await TitleTranslators.fromEnv({}).toEnglish('季度销售复盘')).toBeNull()
  })
})
