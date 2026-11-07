import { describe, expect, it } from 'vitest'
import { BlockDiff, type Block } from '../public/static/viewer/block-diff.js'

const MAIN = 'body > main:nth-of-type(1)'
const block = (path: string, tag: string, text: string): Block => ({ path: `${MAIN} > ${path}`, tag, text })
const cell = (row: number, column: number, text: string): Block => block(`table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(${row}) > td:nth-of-type(${column})`, 'td', text)

const reviewV3: Block[] = [
  block('h1:nth-of-type(1)', 'h1', '产品评审'),
  block('div:nth-of-type(1)', 'div', 'P0：安全、数据丢失或生产环境走不通'),
  cell(1, 1, '标注位置清空评论草稿'), cell(1, 2, '待修复'),
  cell(2, 1, '邮件失败导致评论返回 500'), cell(2, 2, '待修复'),
  block('p:nth-of-type(1)', 'p', '修复进度每天更新一次，以本地实例实测为准。'),
  block('p:nth-of-type(2)', 'p', '产品有五类使用者。'),
]
const reviewV4: Block[] = [
  block('h1:nth-of-type(1)', 'h1', '产品评审'),
  block('div:nth-of-type(1)', 'div', 'P0：安全、数据丢失或生产环境走不通'),
  cell(1, 1, '标注位置清空评论草稿'), cell(1, 2, '已修复'),
  cell(2, 1, '邮件失败导致评论返回 500'), cell(2, 2, '已修复'),
  cell(3, 1, '删不掉内容、移不走成员'), cell(3, 2, '进行中'),
  block('p:nth-of-type(1)', 'p', '产品有五类使用者。'),
]

describe('what changed between two versions of a page', () => {
  it('pairs an edited block with the block it replaced, reads a whole new table row as one, and places what was removed', () => {
    const diff = BlockDiff.between(reviewV3, reviewV4)

    expect(diff.changed).toEqual([
      { path: cell(1, 2, '').path, before: '待修复', after: '已修复' },
      { path: cell(2, 2, '').path, before: '待修复', after: '已修复' },
    ])
    expect(diff.added).toEqual([`${MAIN} > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(3)`])
    expect(diff.removed).toEqual([{ afterPath: cell(3, 2, '').path, text: '修复进度每天更新一次，以本地实例实测为准。' }])
  })

  it('walks the changes in the order they appear on the newer page, each place once', () => {
    const diff = BlockDiff.between(reviewV3, reviewV4)

    expect(BlockDiff.stepsOf(diff, reviewV4)).toEqual([cell(1, 2, '').path, cell(2, 2, '').path, `${MAIN} > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(3)`, cell(3, 2, '').path])
  })

  it('flashes only what changed when one block of a long page is edited', () => {
    const longPage = Array.from({ length: 400 }, (_, index) => block(`p:nth-of-type(${index + 1})`, 'p', `第 ${index + 1} 段`))
    const edited = longPage.map((paragraph, index) => (index === 200 ? { ...paragraph, text: '改过的第 201 段' } : paragraph))

    const diff = BlockDiff.between(longPage, edited)

    expect(BlockDiff.changedPaths(diff)).toEqual([`${MAIN} > p:nth-of-type(201)`])
    expect(BlockDiff.isEmpty(BlockDiff.between(longPage, longPage))).toBe(true)
  })

  it('tells a new block from an edited one by its kind', () => {
    const before = [block('h2:nth-of-type(1)', 'h2', '下一步')]
    const after = [block('h2:nth-of-type(1)', 'h2', '下一步'), block('p:nth-of-type(1)', 'p', '先把查看页做好。')]

    expect(BlockDiff.between(before, after)).toEqual({ changed: [], added: [`${MAIN} > p:nth-of-type(1)`], removed: [] })
    expect(BlockDiff.between(after, before)).toEqual({ changed: [], added: [], removed: [{ afterPath: `${MAIN} > h2:nth-of-type(1)`, text: '先把查看页做好。' }] })
  })
})
