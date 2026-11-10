// @ts-check
export default {
  skipToContent: '跳到内容',
  signIn: '登录',
  notifications: '通知',
  markAllRead: '全部标为已读',
  search: {
    open: '搜索页面',
    placeholder: '搜索页面…',
    empty: '没有找到匹配的页面',
    loading: '正在加载页面…',
    pages: '页面',
    goTo: '前往',
    /** @param {string} search */
    listAll: search => `在首页列出全部「${search}」的结果`,
  },
  /** @param {string} name */
  accountMenu: name => `账户菜单：${name}`,
  myPage: '我的主页',
  signOut: '退出登录',
  /** @param {string} name */
  workspaceMenu: name => `工作区：${name}，切换或新建`,
  workspaces: '工作区',
  personal: '个人',
  newWorkspace: '新建工作区',
  deletedWorkspaces: '最近删除',
  newWorkspaceDialog: {
    title: '新建工作区',
    nameLabel: '名称',
    nameHelp: '最多 40 个字。你会是它的管理员，建好后就可以邀请同事。',
    nameRequired: '写一个名称，比如团队或项目的名字',
    create: '创建',
  },
  deletedWorkspacesDialog: {
    title: '最近删除的工作区',
    description: '删除后 30 天内，管理员可以恢复工作区和其中的页面；之后它们会被彻底删除。',
    restore: '恢复',
  },
  cancel: '取消',
  close: '关闭',
  language: '语言',
}
