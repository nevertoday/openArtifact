import { describe, expect, it } from 'vitest'
import { AgentHandoff, type HandedOffThread } from '../public/static/viewer/agent-handoff.js'
import { messagesFor } from '../src/i18n/messages.ts'

const HAN = /[一-鿿]/
const artifact = { artifactId: 'a1', title: 'Pricing', version: 4, url: 'http://app.test/a/a1', guideUrl: 'http://app.test/llms.txt' }
const onSelectedWords: HandedOffThread = {
  number: 5,
  root: {
    commentId: 'c5',
    body: 'Split this into two sentences',
    author: { name: 'zhou' },
    anchor: { version: 4, selector: 'main > p:nth-of-type(1)', textQuote: 'Opening', quote: { exact: 'We promise refunds within seven days' } },
  },
}
const onWholePage: HandedOffThread = { number: 7, root: { commentId: 'c7', body: 'Tighten it overall', author: { name: 'lin' }, anchor: null } }

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') return []
  return Object.values(value as object).flatMap(stringsOf)
}

describe('the viewer in English', () => {
  it('hands comments to an agent in English, since the agent answers in the language it is asked in', () => {
    const prompt = new AgentHandoff(messagesFor('en').viewerClient.agentPrompt, artifact).promptFor([onSelectedWords, onWholePage])

    expect(prompt).toContain('Please revise “Pricing” based on 2 comments on Open Artifact.')
    expect(prompt).toContain('- Latest version: v4')
    expect(prompt).toContain('## Comment 5')
    expect(prompt).toContain('- Where: “We promise refunds within seven days” (element `main > p:nth-of-type(1)`, written on v4)')
    expect(prompt).toContain('- Where: The whole page')
    expect(prompt).toContain('Reply to each comment')
    expect(prompt).not.toMatch(HAN)
  })

  it('speaks of one comment when one is handed off', () => {
    const prompt = new AgentHandoff(messagesFor('en').viewerClient.agentPrompt, artifact).promptFor([onWholePage])

    expect(prompt).toContain('based on 1 comment on')
    expect(prompt).toContain('Reply to the comment')
  })

  it('words every label and message of the viewer without Chinese', () => {
    const { viewerClient } = messagesFor('en')
    const worded = [
      ...stringsOf(viewerClient),
      viewerClient.comments.threadLabel({ number: 3, author: 'lin', resolved: true }),
      viewerClient.comments.deleteMessage(1),
      viewerClient.versions.overwriteMessage({ next: 5, older: 2, latest: 4 }),
      viewerClient.share.expiresIn(1),
      ...viewerClient.versions.viewingOldPublished({ version: 2, time: 'yesterday', author: 'lin' }),
    ]

    expect(worded.filter(text => HAN.test(text))).toEqual([])
    expect(viewerClient.comments.deleteMessage(1)).toBe("Its 1 reply will be deleted too. This can't be undone.")
    expect(viewerClient.share.expiresIn(1)).toBe('Expires in 1 day')
  })
})
