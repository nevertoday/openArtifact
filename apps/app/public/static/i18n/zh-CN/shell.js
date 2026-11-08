// @ts-check
export default {
  skipToContent: '跳到内容',
  signIn: '登录',
  notifications: '通知',
  markAllRead: '全部标为已读',
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
    description: '删除后 30 天内，管理员可以恢复工作区和其中的 artifact；之后它们会被彻底删除。',
    restore: '恢复',
  },
  cancel: '取消',
  close: '关闭',
  language: '语言',
}
