// @ts-check
export default {
  /** @param {{ name: string, count: number }} p */
  description: ({ name, count }) => `${name} 在 Open Artifact 上公开的 ${count} 篇文档`,
  /** @template T @param {T} product @returns {(string | T)[]} */
  colophon: product => ['用 ', product, ' 发布'],
  ownerBar: {
    text: '这是你的主页，别人看到的就是这样。在文档的「分享」里打开「列在我的主页」，它就会出现在这里。',
    back: '回到工作台',
  },
  /** @param {string} name */
  shareText: name => `${name} 的文章`,
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
    owner: '还没有列出的文档。打开一篇文档，在「分享」里打开公开链接，再打开「列在我的主页」。',
    visitor: '这里还没有公开的文档。',
  },
}
