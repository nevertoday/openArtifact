import { describe, expect, it } from 'vitest'
import { composePageShareText, composeShareText, postWeight, weightedLength } from '../public/static/share-text.js'

describe('weightedLength, by the twitter-text v3 rules', () => {
  it('counts Latin, Cyrillic and common punctuation as 1 and other scripts as 2', () => {
    expect(weightedLength('Hello, world')).toBe(12)
    expect(weightedLength('a'.repeat(280))).toBe(280)
    expect(weightedLength('привет')).toBe(6)
    expect(weightedLength('我'.repeat(140))).toBe(280)
    expect(weightedLength('こんにちは')).toBe(10)
    expect(weightedLength('안녕')).toBe(4)
    expect(weightedLength('–“”')).toBe(3)
    expect(weightedLength('…')).toBe(2)
    expect(weightedLength('，。　')).toBe(6)
  })

  it('counts an emoji sequence as 2 however many code points make it', () => {
    expect(weightedLength('😷')).toBe(2)
    expect(weightedLength('👨‍👩‍👧‍👦')).toBe(2)
    expect(weightedLength('🇯🇵')).toBe(2)
    expect(weightedLength('1️⃣')).toBe(2)
    expect(weightedLength('👍🏽ok')).toBe(4)
  })

  it('counts text the way X stores it, composed', () => {
    expect(weightedLength('café')).toBe(weightedLength('café'))
    expect(weightedLength('café')).toBe(4)
  })

  it('counts every link as 23, bare domains included', () => {
    expect(weightedLength('https://artifact.xiaoxiaodong.ai/a/claude-code-commands-beginner-guide-87iis9i3abvr')).toBe(23)
    expect(weightedLength('http://x.co')).toBe(23)
    expect(weightedLength('read example.com now')).toBe(23 + 9)
    expect(weightedLength('看 https://example.com/路径 吧')).toBe(2 + 1 + 23 + 1 + 2)
    expect(weightedLength('version v1.2 of index')).toBe(21)
  })
})

describe('composeShareText', () => {
  const longChinese = '以 agent 循环为主线，讲清核心命令、hooks、skills、子 agent 和长任务 harness。给刚起步的人，也给想精通的人。'.repeat(8)
  const longEnglish = 'This guide walks through every command, one agent loop at a time, and shows when each one earns its place. '.repeat(20)
  const emojiHeavy = '🚀✨👨‍👩‍👧‍👦🇨🇳'.repeat(80)
  const overlongTitle = '超长标题'.repeat(40)

  it('never lets a post with the link weigh over 280', () => {
    for (const article of [
      { title: 'Claude Code 命令：入门到精通', summary: longChinese },
      { title: 'A Field Guide', summary: longEnglish },
      { title: '表情 🎉', summary: emojiHeavy },
      { title: overlongTitle, summary: longChinese },
      { title: 'x'.repeat(400), summary: null },
    ]) {
      for (const style of ['title_summary', 'title_only'] as const) {
        const text = composeShareText(article, style)
        expect(postWeight(text), `${style}: ${text}`).toBeLessThanOrEqual(280)
        expect(text.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps a short article whole: the title, a blank line, the summary', () => {
    expect(composeShareText({ title: 'pstack 使用指南', summary: '给 Claude Code 和 Cursor 的工程技能包。' })).toBe('pstack 使用指南\n\n给 Claude Code 和 Cursor 的工程技能包。')
    expect(composeShareText({ title: 'pstack 使用指南', summary: '给 Claude Code 和 Cursor 的工程技能包。' }, 'title_only')).toBe('pstack 使用指南')
    expect(composeShareText({ title: 'pstack 使用指南', summary: null })).toBe('pstack 使用指南')
  })

  it('cuts a long summary after a sentence', () => {
    const text = composeShareText({ title: 'Claude Code 命令：入门到精通', summary: longChinese })
    expect(text.startsWith('Claude Code 命令：入门到精通\n\n以 agent 循环为主线')).toBe(true)
    expect(text.endsWith('。')).toBe(true)
  })

  it('cuts after a clause, or mid-word with an ellipsis, when no sentence ends in time', () => {
    const clauses = '先读代码，再写测试，然后改实现，最后复查一遍，'.repeat(20)
    const clauseCut = composeShareText({ title: '流程', summary: clauses })
    expect(clauseCut.endsWith('…')).toBe(true)
    expect(clauseCut.endsWith('，…')).toBe(false)
    const hardCut = composeShareText({ title: 'Words', summary: 'word '.repeat(100).replaceAll(' ', '') })
    expect(hardCut.endsWith('…')).toBe(true)
  })

  it('drops the summary and cuts the title when the title alone does not fit', () => {
    const text = composeShareText({ title: overlongTitle, summary: '这句不该出现。' })
    expect(text).not.toContain('这句不该出现')
    expect(text.endsWith('…')).toBe(true)
  })

  it('never splits an emoji sequence', () => {
    const text = composeShareText({ title: 'Family', summary: '👨‍👩‍👧‍👦'.repeat(200) })
    const withoutEllipsis = text.replace(/…$/, '').split('\n\n')[1] ?? ''
    expect(withoutEllipsis.replaceAll('👨‍👩‍👧‍👦', '')).toBe('')
  })
})

describe('composePageShareText', () => {
  const quote = (title: string, index: number) => (index === 0 ? `《${title}》` : `《${title}》`)

  it('names as many titles as fit and marks the rest', () => {
    const text = composePageShareText('xxd 在 Open Artifact 上的 40 篇文章：', Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 篇很长的文章标题，写得足够长`), quote)
    expect(postWeight(text)).toBeLessThanOrEqual(280)
    expect(text.startsWith('xxd 在 Open Artifact 上的 40 篇文章：《第 1 篇')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
  })

  it('names every title when they all fit', () => {
    expect(composePageShareText('xxd 的 2 篇：', ['甲', '乙'], quote)).toBe('xxd 的 2 篇：《甲》《乙》')
  })
})
