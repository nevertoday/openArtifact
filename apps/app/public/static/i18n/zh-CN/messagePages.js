// @ts-check
export default {
  backHome: '回到首页',
  password: {
    pageTitle: '需要密码 · Open Artifact',
    title: '这个链接需要密码',
    text: '这个页面设置了访问密码。向分享给你的人要密码。',
    label: '访问密码',
    errorRequired: '输入访问密码',
    errors: {
      wrong: '密码不对，再试一次。',
      wait: '试错次数太多。为了保护这个链接，1 分钟后可以再试。',
    },
    open: '打开',
  },
  noAccess: {
    pageTitle: '没有访问权限 · Open Artifact',
    title: '你没有这个页面的访问权限',
    /** @param {string} author */
    text: author => `它是 ${author} 发布的，还没有分享给你。`,
    requestAccess: '请作者分享给你',
  },
  removed: {
    pageTitle: '页面已删除 · Open Artifact',
    /** @param {string} title */
    title: title => `「${title}」已删除`,
    /** @param {string} purge */
    text: purge => `现在所有人都打不开它。${purge}；在那之前可以恢复，恢复后链接、评论和分享设置都和原来一样。`,
    restore: '恢复页面',
    seeAll: '查看最近删除',
  },
  notFound: {
    pageTitle: '找不到 · Open Artifact',
    title: '找不到这个页面',
    /** @param {boolean} signedIn */
    text: signedIn => `它可能已被删除，或者没有分享给你。${signedIn ? '' : '如果它是分享给你的，先登录再打开。'}`,
  },
  unknownAddress: {
    pageTitle: '地址不存在 · Open Artifact',
    title: '这个地址不存在',
    text: '检查一下链接是否完整，或者从首页找你要的页面。',
  },
  removedFromWorkspace: {
    pageTitle: '已被移出 · Open Artifact',
    title: '你已被移出这个工作区，请联系管理员',
    text: '管理员把你移出后，你发布的页面仍留在工作区里。如果你用错了账号，退出后换一个登录。',
  },
  inviteUnusable: {
    pageTitle: '邀请已失效 · Open Artifact',
    title: '这个邀请已经失效',
    text: '邀请 7 天后失效，管理员也可能撤销了它。请管理员重新邀请你。',
    goSignIn: '去登录',
  },
  inviteForOtherAddress: {
    pageTitle: '邀请发给了别人 · Open Artifact',
    /** @param {string} email */
    title: email => `这个邀请是发给 ${email} 的`,
    text: '退出后用这个邮箱登录，就能加入。',
  },
}
