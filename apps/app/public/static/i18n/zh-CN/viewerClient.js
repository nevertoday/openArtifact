// @ts-check
export default {
  actions: {
    cancel: '取消',
    close: '关闭',
    undo: '撤销',
    view: '查看',
  },
  /** @param {string} text */
  quoted: text => `「${text}」`,
  blockKinds: {
    heading: '标题',
    table: '表格',
    figure: '图',
    image: '图片',
    video: '视频',
    code: '代码',
    quote: '引用',
    listItem: '列表项',
    paragraph: '段落',
    term: '术语',
    definition: '释义',
    block: '区块',
    selection: '选中的文字',
  },
  commentMode: {
    hintTouch: '点页面上的内容写评论',
    hintPointer: '点页面上任意内容写评论',
    coachTouch: '长按页面任何地方留言',
    /** @template T @param {T} key @returns {(string | T)[]} */
    coachKeys: key => ['按 ', key, '，在页面任何地方留言'],
  },
  comments: {
    /** @param {string} reason */
    loadFailed: reason => `评论没有加载出来：${reason}`,
    /** @param {number} number */
    sent: number => `评论 ${number} 已发送`,
    filters: { open: '待处理', agent: '给 agent', all: '全部' },
    filterLabel: '筛选评论',
    noneOpen: '没有待处理的评论',
    footTouch: '长按页面上的内容写评论。',
    /** @template T @param {T} c @param {T} j @param {T} k @returns {(string | T)[]} */
    footKeys: (c, j, k) => ['按 ', c, ' 再点页面写评论，', j, ' ', k, ' 切换评论。'],
    /** @param {number} count */
    arrived: count => `有 ${count} 条新评论`,
    noCommentsYet: '还没有评论。',
    writeFirstTouch: '还没有评论。长按页面上的内容写第一条。',
    writeFirstPointer: '还没有评论。按 C，点页面上的内容写第一条。',
    emptyOpen: '没有待处理的评论。',
    emptyAgent: '没有给 agent 的评论。勾上「给 agent」，agent 会按评论修改页面。',
    /** @param {{ number: number, author: string, resolved: boolean }} p */
    threadLabel: ({ number, author, resolved }) => `评论 ${number}，${author}${resolved ? '，已解决' : ''}`,
    /** @param {number} number */
    showPin: number => `在页面上显示评论 ${number}`,
    forAgent: '给 agent',
    lostSpot: '位置已失效',
    reply: '回复',
    /** @param {number} number */
    replyTo: number => `回复评论 ${number}`,
    replyPlaceholder: '回复…',
    /** @param {number} number */
    more: number => `评论 ${number} 的更多操作`,
    copyLink: '复制链接',
    linkCopied: '已复制评论链接',
    /** @param {number} number */
    reopenLabel: number => `重新打开评论 ${number}`,
    /** @param {number} number */
    resolveLabel: number => `解决评论 ${number}`,
    delete: '删除',
    /** @param {number} number */
    deleteLabel: number => `删除评论 ${number}`,
    /** @param {string} name */
    deleteReplyLabel: name => `删除 ${name} 的回复`,
    /** @param {number} number */
    deleteTitle: number => `删除评论 ${number}？`,
    /** @param {number} replyCount */
    deleteMessage: replyCount => `${replyCount > 0 ? `它的 ${replyCount} 条回复会一起删除。` : ''}删除后不能恢复。`,
    deleteReplyTitle: '删除这条回复？',
    deleteReplyMessage: '删除后不能恢复。',
    /** @param {number} number */
    deleted: number => `已删除评论 ${number}`,
    /** @param {number} number */
    replyDeletedFrom: number => `已删除评论 ${number} 的一条回复`,
    replyDeleted: '已删除回复',
    /** @param {number} number */
    resolved: number => `已解决评论 ${number}`,
    /** @param {number} number */
    reopened: number => `已重新打开评论 ${number}`,
    /** @param {number} number */
    replied: number => `已回复评论 ${number}`,
    /** @param {{ agent: string, person: string }} p */
    onBehalf: ({ agent, person }) => `${agent}（代 ${person}）`,
    /** @param {string} person */
    onBehalfBadge: person => `代 ${person}`,
    /** @param {string} name */
    resolvedBy: name => `${name} 标记已解决`,
    resolvedPlain: '已解决',
  },
  handoff: {
    region: '交给 agent',
    /** @param {number} count */
    waitingOpen: count => `${count} 条待处理的评论`,
    /** @param {number} count */
    waitingAgent: count => `${count} 条给 agent 的评论`,
    copyAll: '全部复制给 agent',
    /** @param {number} count */
    copiedAll: count => `已复制 ${count} 条评论，粘贴给你的 agent`,
    hint: '粘贴给任何 agent 都能照着改。已接入的 agent，直接说「处理 Open Artifact 上的评论」。',
    setUp: '去 Agent 接入',
    copyOne: '复制给 agent',
    /** @param {number} number */
    copiedOne: number => `已复制评论 ${number}，粘贴给你的 agent`,
    copyFailed: '没有复制成功，请再试一次',
    copied: '已复制',
  },
  agentPrompt: {
    /** @param {{ count: number, title: string }} p */
    intro: ({ count, title }) => `请按 Open Artifact 上的 ${count} 条评论修改「${title}」。`,
    /** @param {string} url */
    page: url => `- 页面：${url}`,
    /** @param {string} artifactId */
    artifactId: artifactId => `- artifactId：${artifactId}`,
    /** @param {number} version */
    latestVersion: version => `- 最新版本：v${version}（发布新版本时 baseVersion 用你读到的版本）`,
    howTitle: '## 怎么完成',
    /** @param {string} artifactId */
    stepRead: artifactId => `1. 读最新版本：MCP 用 \`read\`（artifactId: ${artifactId}）。`,
    /** @param {boolean} isOne */
    stepUpdate: isOne => `2. 改完发布新版本：MCP 用 \`update\`，带上 baseVersion，并在 note 里一句话写清改了什么、回应了${isOne ? '这条评论' : '哪几条评论'}。`,
    /** @param {boolean} isOne */
    stepReply: isOne => `3. ${isOne ? '回复这条评论' : '每条评论都回复一次'}：MCP 用 \`reply_comment\`（commentId 见上），说明在哪个版本改的，并设 \`resolve: true\` 关闭讨论。`,
    /** @param {string} guideUrl */
    stepHttp: guideUrl => `4. 没有 Open Artifact MCP 时，照 ${guideUrl} 用 HTTP API 做同样的三步。`,
    /** @param {number} number */
    commentTitle: number => `## 评论 ${number}`,
    /** @param {string} spot */
    spot: spot => `- 位置：${spot}`,
    /** @param {{ author: string, body: string }} p */
    said: ({ author, body }) => `- ${author}：${body}`,
    /** @param {string} commentId */
    commentId: commentId => `- commentId：${commentId}`,
    wholePage: '整个页面',
    somewhereOnPage: '页面上的一处',
    /** @param {string} words */
    words: words => `「${words}」`,
    /** @param {string} selector */
    element: selector => `元素 \`${selector}\``,
    /** @param {number} version */
    writtenOn: version => `写于 v${version}`,
    /** @param {{ where: string, details: string[] }} p */
    spotWithDetails: ({ where, details }) => `${where}（${details.join('，')}）`,
  },
  drawer: {
    titles: { comments: '评论', data: '数据' },
    closeLabels: { comments: '关闭评论', data: '关闭数据' },
  },
  topBar: {
    /** @param {number} count */
    openComments: count => `评论，${count} 条待处理`,
    data: '数据',
    /** @param {number} count */
    dataCount: count => `数据（${count} 条）`,
    newTitle: '新标题',
    renamed: '已重命名',
    linkCopied: '已复制链接',
    linkCopyFailed: '复制不了，浏览器没给剪贴板权限',
    /** @param {{ takesDown: boolean, reason: string }} p */
    removeFailed: ({ takesDown, reason }) => `${takesDown ? '下架' : '删除'}没有成功：${reason}`,
  },
  data: {
    loading: '正在加载数据…',
    /** @param {string} reason */
    loadFailed: reason => `数据没有加载出来：${reason}`,
    emptyTitle: '这个页面还没有收集到数据。',
    emptyText: '报名、投票这类页面收到的内容会显示在这里。',
    /** @param {number} count */
    documentCount: count => `${count} 条`,
    content: '内容',
    updated: '最后修改',
    anonymous: '匿名访客',
  },
  liveUpdates: {
    /** @param {string} agent */
    fixed: agent => `${agent} 按你的意见改好了`,
    seeChanges: '看改了什么',
    seeLatest: '看最新版本',
    /** @param {number} version */
    published: version => `v${version} 已发布`,
    seeNew: '看新版本',
  },
  versions: {
    /** @param {number} version */
    oldLabel: version => `v${version} · 旧版`,
    /** @param {{ version: number, isOld: boolean }} p */
    buttonLabel: ({ version, isOld }) => `版本 ${version}${isOld ? '，不是最新版本' : ''}，选择版本`,
    /** @param {{ author: string, version: number }} p */
    restoredBy: ({ author, version }) => `${author} 用 v${version} 覆盖`,
    /** @param {{ author: string, via: string }} p */
    publishedVia: ({ author, via }) => `${author} 用 ${via} 发布`,
    /** @param {string} author */
    publishedOnWeb: author => `${author} 在网页上发布`,
    /** @param {{ missing: number, latest: number }} p */
    missing: ({ missing, latest }) => `没有 v${missing}，显示的是最新的 v${latest}。`,
    /** @param {number} version */
    viewingOld: version => `你在看 v${version}，不是最新版本。`,
    /** @template T @param {{ version: number, time: T, author: string }} p @returns {(string | T)[]} */
    viewingOldPublished: ({ version, time, author }) => [`你在看 v${version}（`, time, `，${author} 发布），不是最新版本。`],
    showLatest: '看最新版本',
    /** @param {number} version */
    overwriteWith: version => `用 v${version} 覆盖最新版本`,
    latest: '最新',
    compare: '和上一版对比',
    menuLabel: '版本',
    loading: '正在加载版本…',
    loadFailed: '版本没有加载出来，稍后再打开看看。',
    /** @param {{ from: number, to: number }} p */
    compareTitle: ({ from, to }) => `对比 v${from} → v${to}`,
    comparing: '正在对比…',
    /** @param {number} version */
    versionFailed: version => `v${version} 没有加载出来，稍后再试。`,
    sameText: '两个版本的文字一样',
    marks: { changed: '改', added: '新', removed: '删' },
    /** @param {number} count */
    changedCount: count => `改了 ${count} 处`,
    /** @param {number} count */
    addedCount: count => `新增 ${count} 处`,
    /** @param {number} count */
    removedCount: count => `删了 ${count} 处`,
    /** @param {number} version */
    overwriteTitle: version => `用 v${version} 覆盖最新版本？`,
    /** @param {{ next: number, older: number, latest: number }} p */
    overwriteMessage: ({ next, older, latest }) => `会发布 v${next}，内容和 v${older} 一样。v${latest} 和更早的版本都会保留，随时可以再换回来。`,
    /** @param {number} version */
    overwriteConfirm: version => `覆盖并发布 v${version}`,
    /** @param {{ older: number, published: number }} p */
    overwritten: ({ older, published }) => `已用 v${older} 覆盖最新版本，发布为 v${published}`,
  },
  share: {
    loading: '正在加载…',
    discardTitle: '放弃未保存的修改？',
    discardMessage: '分享设置有修改还没有保存。关闭后，这些修改不会生效。',
    discardConfirm: '放弃修改',
    whoCanSee: '谁能看到',
    publicLinksOff: 'workspace 管理员已关闭公开链接',
    visibilityDescriptions: {
      private: '只有你自己',
      specified: '只有你在下面添加的人',
      workspace: '默认。成员可以查看、评论，也能读写页面里的共享数据',
      public_link: '拿到链接的人不用登录就能打开，只看到页面本身',
    },
    emailPlaceholder: '输入成员邮箱',
    emailLabel: '成员邮箱',
    emailInvalid: '请输入有效的邮箱，比如 name@example.com',
    add: '添加',
    nobodyYetSpecified: '还没有添加任何人，现在只有你能看到。',
    nobodyYet: '还没有单独添加任何人。',
    peopleTitle: '添加的人',
    peopleHintSpecified: '保存后，新添加的人会收到邮件。可查看：使用页面；可评论：再加评论；可编辑：还能发布新版本。',
    peopleHint: '给某个人比其他人更多的权限，比如可编辑：还能发布新版本。保存后，新添加的人会收到邮件。',
    /** @param {string} name */
    roleOf: name => `${name} 的权限`,
    addedOnSave: '保存后添加',
    remove: '移除',
    role: '权限',
    anonymousWrite: '允许匿名访客写入共享数据',
    anonymousWriteHint: '适合对外的报名表。',
    showsComments: '对外显示评论',
    showsCommentsHint: '访客可以看到评论和评论人的名字，但不能发表评论。',
    publicLink: '公开链接',
    publicLinkHint: '访客只看到最新版本的页面，看不到版本记录和数据。',
    expiry: '有效期',
    password: '访问密码',
    listed: '列在我的主页',
    personalPage: '看我的主页',
    listedHint: '陌生人能在你的主页上看到它，搜索引擎也能找到。',
    notListable: '设了访问密码的文档不能列出。',
    neverExpires: '永不过期',
    /** @param {number} days */
    expiresIn: days => `${days} 天后过期`,
    /** @param {string} date */
    keepsExpiry: date => `保持 ${date} 过期`,
    /** @param {string} date */
    expiredOn: date => `已于 ${date} 过期`,
    passwordSet: '已设置访问密码',
    changePassword: '更改',
    removePassword: '取消密码',
    passwordRemovedOnSave: '保存后取消访问密码',
    keepPassword: '保留密码',
    newPassword: '输入新密码',
    noPassword: '不设置',
    keepOldPassword: '保留原密码',
    saved: '分享设置已保存',
  },
}
