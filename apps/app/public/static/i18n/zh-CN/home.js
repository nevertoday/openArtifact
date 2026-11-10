// @ts-check
export default {
  filters: {
    all: '全部',
    mine: '我发布的',
    shared: '分享给我的',
    removed: '最近删除',
    waiting_for_me: '等我处理',
    waiting_for_my_agent: '等我的 agent 处理',
  },
  filterDescriptions: {
    all: '这个工作区里的人和他们的 agent 发布的 artifact。',
    mine: '你发布的，和你的 agent 代你发布的。',
    shared: '作者把你加进分享名单的 artifact，不论它在哪个工作区。',
    removed: '删除后所有人都看不到。30 天内可以恢复，之后彻底删除；也可以现在就永久删除，立即释放存储空间。',
    waiting_for_me: '有评论在等你回复。',
    waiting_for_my_agent: '有给 agent 的评论还没解决，等你的 agent 处理。',
  },
  connectAgents: 'Agent 接入',
  letAgentPublish: '让 agent 发布',
  nameNudge: {
    title: '设置你的名字',
    /** @param {string} name */
    text: name => `现在团队成员在评论和通知里看到的是「${name}」。设一个大家认得出的名字。`,
    action: '去设置',
  },
  headingAll: '全部',
  /** @param {string} agent */
  headingByAgent: agent => `${agent} 发布的`,
  /** @param {string} agent */
  descriptionByAgent: agent => `来源是 ${agent} 的 artifact。`,
  /** @param {number} count */
  resultCount: count => `${count} 个`,
  /** @param {{ search: string, count: number }} p */
  searchResultCount: ({ search, count }) => `搜索「${search}」· ${count} 个`,
  removedTable: {
    title: '标题',
    removed: '删除',
    kept: '保留',
    actions: '操作',
    restore: '恢复',
    purge: '永久删除',
  },
  searchPlaceholder: '搜索标题、作者或 agent',
  sidebar: {
    filter: '筛选',
    waiting: '待处理',
    sources: '来源',
    allSources: '全部来源',
    /** @param {{ agent: string, count: number }} p */
    sourceOption: ({ agent, count }) => `${agent}（${count}）`,
    /** @param {number} count */
    countTitle: count => `${count} 个 artifact`,
  },
  /** @param {string} workspace */
  fromWorkspace: workspace => `来自工作区「${workspace}」`,
  /** @param {{ count: number, forAgent: number }} p */
  unresolvedComments: ({ count, forAgent }) => `${count} 条未解决评论${forAgent > 0 ? ` · 其中 ${forAgent} 条给 agent` : ''}`,
  empty: {
    firstSteps: ['在「Agent 接入」里给你的 agent 一个 token', '让 agent 把设计文档、报告或看板发布到这里', '在页面上直接评论，选「给 agent」让它去改'],
    /** @param {string} search */
    searchTitle: search => `没有找到「${search}」`,
    searchText: '搜索会查标题、作者的名字和发布它的 agent。',
    clearSearch: '清除搜索',
    /** @param {string} agent */
    agentTitle: agent => `没有来自 ${agent} 的 artifact`,
    viewAll: '查看全部',
    connectAgent: '连接 agent',
    inviteMembers: '邀请成员',
    filters: {
      all: { title: '还没有 artifact', text: '在「Agent 接入」里连接你的 agent，然后让它把设计文档、报告或看板发布到这里。' },
      mine: { title: '你还没有发布 artifact', text: '连接你的 agent，让它把页面发布到这里。' },
      shared: { title: '还没有人把 artifact 分享给你', text: '作者在分享设置里加上你之后，会出现在这里。' },
      removed: { title: '没有可以恢复的 artifact', text: '你删除的 artifact 会在这里留 30 天。' },
      waiting_for_me: { title: '没有等你回复的评论', text: '有人评论你的 artifact，或回复你的评论时，会出现在这里。' },
      waiting_for_my_agent: { title: '没有给 agent 的评论', text: '有人在评论时选「给 agent」，你的 agent 就会在这里看到要做的事。' },
    },
  },
}
