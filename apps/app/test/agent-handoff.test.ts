import { describe, expect, it } from 'vitest'
import { AgentHandoff, type HandedOffThread } from '../public/static/viewer/agent-handoff.js'
import { messagesFor } from '../src/i18n/messages.ts'

const words = messagesFor('zh-CN').viewerClient.agentPrompt

const artifact = { artifactId: 'a1', title: '定价页', version: 4, url: 'http://app.test/a/a1', guideUrl: 'http://app.test/llms.txt' }

const pinnedOnTable: HandedOffThread = {
  number: 2,
  root: {
    commentId: 'c2',
    body: '专业版价格应该是 ¥129',
    author: { name: 'lin' },
    anchor: { version: 3, selector: '#plans > p:nth-of-type(2)', textQuote: '专业版 ¥99 / 月', quote: null },
  },
}
const onSelectedWords: HandedOffThread = {
  number: 5,
  root: {
    commentId: 'c5',
    body: '这句话太长，拆成两句',
    author: { name: 'zhou' },
    anchor: { version: 4, selector: 'main > p:nth-of-type(1)', textQuote: '整段开头', quote: { exact: '我们承诺七天无理由退款并且全年无休' } },
  },
}
const onWholePage: HandedOffThread = { number: 7, root: { commentId: 'c7', body: '整体再精简一点', author: { name: 'lin' }, anchor: null } }

describe('handing comments to an agent', () => {
  it('names the page, the version to build on, and how to answer', () => {
    const prompt = new AgentHandoff(words, artifact).promptFor([pinnedOnTable])

    expect(prompt).toContain('「定价页」')
    expect(prompt).toContain('http://app.test/a/a1')
    expect(prompt).toContain('artifactId：a1')
    expect(prompt).toContain('最新版本：v4')
    expect(prompt).toContain('reply_comment')
    expect(prompt).toContain('resolve')
    expect(prompt).toContain('http://app.test/llms.txt')
  })

  it('lists each comment with where it points and its id, in the order given', () => {
    const prompt = new AgentHandoff(words, artifact).promptFor([pinnedOnTable, onSelectedWords, onWholePage])

    expect(prompt).toContain('3 条评论')
    expect(prompt.indexOf('评论 2')).toBeLessThan(prompt.indexOf('评论 5'))
    expect(prompt.indexOf('评论 5')).toBeLessThan(prompt.indexOf('评论 7'))
    expect(prompt).toContain('「专业版 ¥99 / 月」（元素 `#plans > p:nth-of-type(2)`，写于 v3）')
    expect(prompt).toContain('「我们承诺七天无理由退款并且全年无休」（元素 `main > p:nth-of-type(1)`，写于 v4）')
    expect(prompt).toContain('整个页面')
    expect(prompt).toContain('commentId：c5')
    expect(prompt).toContain('lin：专业版价格应该是 ¥129')
  })

  it('speaks of one comment when one is handed off', () => {
    const prompt = new AgentHandoff(words, artifact).promptFor([onWholePage])

    expect(prompt).toContain('1 条评论')
    expect(prompt).not.toContain('每条评论')
  })

  it('refuses to hand off nothing, since an empty prompt would send the agent off with no work', () => {
    expect(() => new AgentHandoff(words, artifact).promptFor([])).toThrow('no comments to hand off')
  })
})
