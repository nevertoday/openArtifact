// @ts-check
export default {
  /** @param {{ name: string, count: number }} p */
  description: ({ name, count }) => `${name} 在 Open Artifact 上公开的 ${count} 篇页面`,
  /** @template T @param {T} product @returns {(string | T)[]} */
  colophon: product => ['用 ', product, ' 发布'],
  ownerBar: {
    text: '这是你的主页，别人看到的就是这样。在页面的「分享」里打开「列在我的主页」，它就会出现在这里。',
    back: '回到工作区',
  },
  /** @param {{ name: string, count: number }} p */
  shareLead: ({ name, count }) => `${name} 在 Open Artifact 上的 ${count} 篇文章：`,
  /** Each title as the list of the page's titles shows it; the place in the list matters to languages that separate them. @param {string} title @param {number} _index */
  shareQuote: (title, _index) => `《${title}》`,
  shareEntryOnX: '发到 X',
  copyEntryLink: '复制链接',
  linkCopied: '已复制链接',
  /** @param {number} count */
  entryCount: count => `${count} 篇`,
  sharePage: '分享主页',
  bio: {
    edit: '点一下修改介绍',
    add: '写一句话介绍自己',
    placeholder: '写一句话介绍自己…',
  },
  pinnedLabel: '置顶',
  read: '阅读',
  /** @param {number} version */
  version: version => `第 ${version} 版`,
  /** @param {number} year */
  year: year => `${year} 年`,
  justUpdated: '刚更新',
  pin: '置顶',
  unpin: '取消置顶',
  editSummary: '改摘要',
  empty: {
    ownerTitle: '你的主页还是空的',
    owner: '打开一篇页面，在「分享」里打开公开链接，再打开「列在我的主页」，它就会出现在这里。',
    ownerAction: '挑选要展示的页面',
    visitor: '这里还没有公开的页面。',
  },
}
