import type { HTMLElement } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { FramedPage } from './framed-page.ts'

const REVIEW_PAGE = `<main>
  <h1>产品评审</h1>
  <p id="intro">发布侧已经顺手，<b>团队侧</b>的回路还没闭合。</p>
  <p>产品有五类使用者。前两类是付出时间的人。</p>
  <div style="display: grid"><div class="tile">4 P0</div><div class="tile">9 P1</div></div>
  <h2>修复进度</h2>
  <table><tbody><tr><td>问题</td><td>状态</td></tr><tr><td>标注位置清空评论草稿</td><td>已修复</td></tr></tbody></table>
  <input id="search">
</main>`

let page: FramedPage

afterEach(async () => {
  await page.close()
})

async function commenting(): Promise<void> {
  await page.tell('mode', { commentable: true, commenting: true })
}

describe('the SDK in an artifact page', () => {
  it('reports the page as blocks of its own text once the page has loaded', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)

    const ready = page.lastMessageNamed('ready')

    expect(ready?.blocks).toEqual(expect.arrayContaining([
      { path: 'body > main:nth-of-type(1) > h1:nth-of-type(1)', tag: 'h1', text: '产品评审' },
      { path: '#intro', tag: 'p', text: '发布侧已经顺手，团队侧的回路还没闭合。' },
      { path: 'body > main:nth-of-type(1) > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(2) > td:nth-of-type(2)', tag: 'td', text: '已修复' },
    ]))
    expect((ready?.blocks as { tag: string }[]).map(block => block.tag)).not.toContain('tr')
  })

  it('picks a whole table from any of its cells, named by its heading and quoted by its first row', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)
    await commenting()

    await page.click('table tr:nth-of-type(2) td')

    expect(page.lastMessageNamed('target-picked')).toMatchObject({
      source: 'click',
      label: '表格 · 修复进度',
      excerpt: '问题 · 状态',
      anchor: { selector: 'body > main:nth-of-type(1) > table:nth-of-type(1)', textQuote: '问题 · 状态', quote: null },
    })
  })

  it('picks a card of a grid as one target', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)
    await commenting()

    await page.click('.tile')

    expect(page.lastMessageNamed('target-picked')).toMatchObject({ label: '区块 · 4 P0', anchor: { selector: 'body > main:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1)' } })
  })

  it('picks nothing on the blank margins of the page\'s column', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)
    await commenting()

    await page.click('main')

    expect(page.messagesNamed('target-picked')).toEqual([])
  })

  it('leaves clicks to the page outside comment mode, and when the viewer may not comment', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)

    await page.click('h1')
    await page.tell('mode', { commentable: false, commenting: true })
    await page.click('h1')

    expect(page.messagesNamed('target-picked')).toEqual([])
  })

  it('listens only to the viewer page on the app origin', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)

    await page.tell('mode', { commentable: true, commenting: true }, 'http://elsewhere.test')
    await page.click('h1')

    expect(page.messagesNamed('target-picked')).toEqual([])
  })

  it('draws a pin for each comment it finds and reports the comments whose spot is gone', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)

    await page.tell('pins', {
      pins: [
        { commentId: 'c1', number: 1, state: 'agent', active: false, anchor: { x: 0, y: 0, selector: '#intro', textQuote: '发布侧已经顺手', quote: null } },
        { commentId: 'c2', number: 2, state: 'resolved', active: false, anchor: { x: 0, y: 0, selector: 'body > aside:nth-of-type(1)', textQuote: '一段删掉的话', quote: null } },
      ],
    })

    const pinLabels = [...(page.overlay?.querySelectorAll('.pin') ?? [])].map(pin => pin.getAttribute('aria-label'))
    expect(page.lastMessageNamed('pins-placed')).toMatchObject({ placed: ['c1'], orphaned: ['c2'] })
    expect(pinLabels).toEqual(['评论 1'])
    expect(page.overlay?.querySelector('.pins')?.getAttribute('aria-label')).toBe('评论标注')
  })

  it('finds a commented paragraph again after the paragraph before it was removed', async () => {
    page = await FramedPage.loaded('<main><p>第一段</p><p>产品有五类使用者。</p><p>第三段</p></main>')
    const scrolledTo: string[] = []
    page.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolledTo.push(this.textContent ?? '')
    }

    page.document.querySelector('p')?.remove()
    await page.tell('scroll-to', { anchor: { x: 0, y: 0, selector: 'body > main:nth-of-type(1) > p:nth-of-type(2)', textQuote: '产品有五类使用者。', quote: null } })

    expect(scrolledTo).toEqual(['产品有五类使用者。'])
  })

  it('offers a 评论 button for selected words and sends them with the text around them', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)
    await page.tell('mode', { commentable: true, commenting: false })
    const paragraph = page.document.querySelectorAll('p')[1]
    const words = paragraph?.firstChild
    const range = page.document.createRange()
    range.setStart(words as never, 3)
    range.setEnd(words as never, 8)
    page.window.getSelection()?.addRange(range)
    page.document.dispatchEvent(new page.window.Event('selectionchange'))
    await page.settle(200)

    const selectButton = page.overlay?.querySelector('.select-button')
    expect(selectButton?.hasAttribute('data-shown')).toBe(true)
    selectButton?.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }))
    await page.settle()

    expect(page.lastMessageNamed('target-picked')).toMatchObject({
      source: 'selection',
      label: '选中的文字',
      excerpt: '五类使用者',
      anchor: { selector: 'body > main:nth-of-type(1) > p:nth-of-type(2)', quote: { exact: '五类使用者', prefix: '产品有', suffix: '。前两类是付出时间的人。' } },
    })
  })

  it('passes C, J, K, ? and Escape to the viewer, but not while someone types or holds a modifier', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)

    await page.press('c')
    await page.press('j', { metaKey: true })
    await page.press('k', { repeat: true })
    await page.press('c', { on: '#search' })
    await page.press('Escape')
    await page.press('x')

    expect(page.messagesNamed('key').map(message => message.key)).toEqual(['c', 'Escape'])
  })

  it('puts the block that was at the top back in place, and says when it has', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)

    await page.tell('restore-place', { place: { path: 'body > main:nth-of-type(1) > h2:nth-of-type(1)', text: '修复进度', offset: 12 } })

    expect(page.messagesNamed('scrolled')).toHaveLength(1)
  })

  it('says ready again when the viewer starts listening after the page has loaded', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE)
    const readyBefore = page.messagesNamed('ready').length

    await page.tell('sync')

    expect(page.messagesNamed('ready')).toHaveLength(readyBefore + 1)
    expect(page.lastMessageNamed('ready')?.blocks).toEqual(expect.arrayContaining([{ path: '#intro', tag: 'p', text: '发布侧已经顺手，团队侧的回路还没闭合。' }]))
  })

  it('stays out of the way on a home-page preview', async () => {
    page = await FramedPage.loaded(REVIEW_PAGE, 'http://usercontent.test/s/signature/artifact-1/v1/index.html?preview')

    expect(page.sent).toEqual([])
    expect(page.overlay).toBeNull()
  })
})
