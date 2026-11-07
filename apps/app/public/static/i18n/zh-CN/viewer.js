// @ts-check
export default {
  stageLabel: '页面内容',
  /** @param {{ author: string, version: number, via: string }} p */
  description: ({ author, version, via }) => `${author} 发布 · v${version} · ${via}`,
  byline: {
    /** @param {string} name */
    authorPage: name => `${name} 的主页`,
    /** @template T @param {{ version: number, time: T }} p @returns {(string | T)[]} */
    updated: ({ version, time }) => [`第 ${version} 版 · `, time, '更新'],
    next: '下一篇',
    more: '更多文章',
  },
  full: { back: '返回查看页' },
  bar: {
    home: '返回首页',
    commentModeTooltip: '评论模式（C）',
    comment: '评论',
    share: '分享',
    comments: '评论',
    signInToComment: '登录后评论',
  },
  version: {
    /** @param {number} version */
    picker: version => `版本 ${version}，选择版本`,
    menu: '版本',
  },
  visibility: {
    tooltipManage: '谁能看到这个页面 · 点一下分享',
    tooltip: '谁能看到这个页面',
  },
  more: {
    label: '更多',
    openInNewTab: '在新标签页打开',
    data: '数据',
    rename: '重命名',
    copyLink: '复制链接',
    visibleTo: '可见范围：',
    isolation: '这个页面在隔离环境里运行，读不到你的登录信息',
  },
  compare: {
    label: '版本对比',
    previous: '上一处',
    next: '下一处',
    exit: '退出对比',
  },
  composer: {
    exitCommentMode: '退出',
    label: '写评论',
    placeholder: '写评论…',
    bodyLabel: '评论内容',
    bodyRequired: '写点什么再发送',
    agentNote: 'agent 会按这条评论修改页面，改完回复你。',
    forAgent: '给 agent',
    cancel: '取消',
    send: '发送',
  },
  coach: { dismiss: '知道了' },
  drawer: {
    loading: '正在加载评论…',
    handle: '拖动调整评论面板高度',
    title: '评论',
    close: '关闭',
  },
  shortcuts: {
    title: '快捷键',
    commentMode: '评论模式：点页面上的内容写评论',
    nextComment: '下一条评论',
    previousComment: '上一条评论',
    send: '发送评论或回复',
    escape: '关闭当前的浮层，退出评论模式',
    help: '打开这张表',
    close: '关闭',
  },
  share: {
    title: '分享',
    close: '关闭',
    loading: '正在加载…',
    linkCopied: '已复制链接',
    copyLink: '复制链接',
    save: '保存',
  },
}
