// @ts-check
const NEW_TOKEN_HINT = '请在「Agent 接入」里新建一个。'

export default {
  dialog: { cancel: '取消', close: '关闭' },
  workspaces: {
    /** @param {string} message */
    createFailed: message => `没有建好：${message}`,
    /** @param {string} message */
    restoreFailed: message => `恢复失败：${message}`,
  },
  errorFallback: '操作没有成功，请重试。',
  /** Keyed by ErrorCode in src/http-error.ts; `network` is the browser's own. */
  errors: /** @satisfies {Partial<Record<import('../../../../src/http-error.ts').ErrorCode | 'network', unknown>>} */ ({
    network: '连不上 Open Artifact，请检查网络后重试。',
    unauthenticated: '登录已失效，请刷新页面重新登录。',
    token_invalid: `这个 token 无效，${NEW_TOKEN_HINT}`,
    token_revoked: `这个 token 已撤销，${NEW_TOKEN_HINT}`,
    token_expired: `这个 token 已过期，${NEW_TOKEN_HINT}`,
    forbidden: '你没有权限做这件事。',
    admin_required: '只有工作区管理员可以做这件事。',
    browser_session_required: '这件事要在网页上登录后做。',
    outside_token_scope: '这个 token 只能发布。要做这件事，请新建一个完全权限的 token，或者在网页上操作。',
    cross_site_request: '请在 Open Artifact 的页面上操作。',
    not_found: '找不到了，它可能已被删除。刷新页面看看。',
    field_required: '这一项不能为空。',
    /** @param {{ maxLength: number }} error */
    field_too_long: ({ maxLength }) => `最多 ${maxLength} 个字。`,
    too_large: '内容太大，请减小后再试。',
    last_admin: '工作区至少要有一位管理员。先把别人设为管理员。',
    cannot_remove_self: '不能移除自己，请另一位管理员操作。',
    author_always_sees: '作者自己一直能看到，不用添加。',
    public_links_off: '管理员已关闭公开链接。',
    version_conflict: '刚有人发布了新版本。刷新页面后再试。',
    not_listable: '只有不设密码的公开链接才能列在主页上。',
    share_text_too_long: '这段文案加上链接超过了 X 的 280 字限制，请删短一些。',
    workspace_changed: '你在另一个标签页切换了工作区。请刷新页面后再操作。',
    mail_limit_reached: '今天发出的邀请或分享邮件已经到上限，这次没有发出，也没有保存。请明天再试。',
    publish_limit_reached: '你 24 小时内发布的次数已到上限，这次没有发布。请稍后再试。',
    workspace_quota_reached: '这个工作区的 artifact 数量或存储空间已到上限，这次没有保存。删掉不用的 artifact 再试，用量见「工作区设置」。',
    workspace_deleted: '这个工作区已被删除。',
    personal_workspace: '个人工作区不能离开或删除，它的主人也始终是管理员。',
  }),
  /** takeDown is an admin removing someone else's artifact; delete is the author removing their own. */
  removal: {
    takeDown: {
      /** @param {string} title */
      confirmTitle: title => `下架「${title}」？`,
      confirmMessage: '下架后所有人都看不到它，作者也不能自己恢复。30 天内管理员可以在「最近删除」里恢复。',
      /** @param {string} title */
      done: title => `已下架「${title}」`,
      /** @param {string} message */
      failed: message => `下架失败：${message}`,
    },
    delete: {
      /** @param {string} title */
      confirmTitle: title => `删除「${title}」？`,
      confirmMessage: '删除后所有人都看不到它。30 天内可以在「最近删除」里恢复。',
      /** @param {string} title */
      done: title => `已删除「${title}」`,
      /** @param {string} message */
      failed: message => `删除失败：${message}`,
    },
  },
  restore: {
    /** @param {string} title */
    done: title => `已恢复「${title}」`,
    open: '打开',
    /** @param {string} message */
    failed: message => `恢复失败：${message}`,
  },
  notifications: {
    /** @param {string} message */
    loadFailed: message => `通知加载失败：${message}`,
    /** @param {number} count */
    bellUnread: count => `通知，${count} 条未读`,
    emptyTitle: '还没有通知',
    emptyText: '有人评论你的 artifact、回复或解决你的评论时，会出现在这里。',
    unreadPrefix: '未读：',
  },
  home: {
    undo: '撤销',
    /** @param {string} message */
    undoFailed: message => `撤销失败：${message}`,
    /** @param {number} count */
    artifactCount: count => `${count} 个 artifact`,
  },
  login: {
    errors: {
      INVALID_OTP: '验证码不对，请再检查一下。',
      OTP_EXPIRED: '验证码已过期，请重新发送。',
      TOO_MANY_ATTEMPTS: '错误次数太多，这个验证码已失效，请重新发送。',
      rate_limited: '验证码发得太频繁了，请等一分钟再试。',
      SIGN_IN_LOCKED: '这个邮箱今天输错验证码的次数太多，验证码登录已暂停。请明天再试，或换一种方式登录。',
      CODE_NOT_MAILED: '验证码邮件没有发出去，请稍后再试。',
      INVALID_EMAIL: '请输入有效的邮箱，比如 name@example.com',
    },
    unknownError: '登录没有成功，请重试。',
    resend: '再发一次',
    /** @param {number} seconds */
    resendIn: seconds => `再发一次（${seconds} 秒）`,
  },
  personal: {
    bioLabel: '一句话介绍自己',
    bioEmpty: '写一句话介绍自己…',
    bioSaved: '已保存介绍',
    summaryLabel: '摘要',
    summarySaved: '已保存摘要',
    summaryReset: '已改回页面开头的话',
    useOpening: '用页面开头的话',
    save: '保存',
  },
  accessRequest: {
    requested: '已请作者分享',
    /** @param {string} authorName */
    notified: authorName => `已通知 ${authorName}。TA 分享给你后，你会收到通知。`,
  },
  settings: {
    tokens: {
      scopes: { publish: '仅发布', full: '完全权限' },
      states: { revoked: '已撤销', expired: '已过期', active: '有效' },
      columns: { name: '名字', scope: '权限', lastUsed: '最近使用', expires: '到期', state: '状态' },
      neverUsed: '还没用过',
      neverExpires: '永不过期',
      none: '还没有 token。',
      noneActive: '没有有效的 token。',
      /** @param {number} count */
      showInactive: count => `显示已失效的 token（${count}）`,
      actions: '操作',
      revoke: '撤销',
      delete: '删除',
      /** @param {string} name */
      deleteLabel: name => `删除「${name}」`,
      /** @param {string} name */
      revokeTitle: name => `撤销「${name}」？`,
      revokeMessage: '用这个 token 的 agent 会立即失去访问权限。撤销后不能恢复，只能新建一个。',
      /** @param {string} name */
      revoked: name => `已撤销「${name}」`,
      /** @param {string} message */
      revokeFailed: message => `撤销失败：${message}`,
      /** @param {string} name */
      deleted: name => `已删除「${name}」`,
      /** @param {string} message */
      deleteFailed: message => `删除失败：${message}`,
      /** @param {string} message */
      createFailed: message => `新建失败：${message}`,
    },
    connection: {
      waiting: '等 agent 连上…',
      waitingForPage: 'agent 已经连上了，等它发布测试页…',
      /** @param {{ agent: string, title: string }} p */
      connected: ({ agent, title }) => `连上了：${agent} 刚刚发布了「${title}」`,
      open: '打开',
    },
    profile: { saved: '已保存' },
    lifecycle: {
      /** @param {string} name */
      leaveTitle: name => `离开「${name}」？`,
      leaveMessage: '你会立即看不到这里的 artifact，你在这里的 token 也会失效。之后有人邀请你，你还能回来。',
      /** @param {string} name */
      deleteTitle: name => `删除「${name}」？`,
      deleteMessage: '所有成员会立即失去访问，artifact、公开链接和 token 都停止工作。30 天内你可以在工作区菜单的「最近删除」里恢复。',
      /** @param {string} message */
      failed: message => `没有完成：${message}`,
    },
    publicLinks: {
      offTitle: '关闭公开链接？',
      /** @param {number} count */
      offMessage: count => `关闭后，${count} 个公开链接立即失效。`,
      offConfirm: '关闭公开链接',
      allowed: '已允许公开链接',
      turnedOff: '已关闭公开链接',
    },
    members: {
      /** @param {{ name: string, role: string }} p */
      roleChanged: ({ name, role }) => `已把 ${name} 设为${role}`,
      /** @param {string} message */
      roleChangeFailed: message => `修改角色失败：${message}`,
      /** @param {string} name */
      removeTitle: name => `移除 ${name}？`,
      removeMessage: 'TA 会立即失去访问权限，个人 API token 也会被撤销，再次登录也不会自动加入，除非你用邮箱重新邀请 TA。TA 发布的 artifact 会留在工作区里。',
      remove: '移除',
      /** @param {string} name */
      removed: name => `已移除 ${name}`,
      /** @param {string} message */
      removeFailed: message => `移除失败：${message}`,
    },
    invites: {
      none: '没有待接受的邀请。',
      /** @param {number} count */
      heading: count => `待接受的邀请（${count}）`,
      anyoneLink: '邀请链接 · 任何人可用',
      /** @param {{ inviter: string, expiry: string | null }} p */
      meta: ({ inviter, expiry }) => `${inviter} 邀请 · ${expiry === null ? '永不过期' : `${expiry} 到期`}`,
      copy: '复制链接',
      copyDone: '已复制邀请链接',
      revoke: '撤销',
      /** @param {string} subject */
      revoked: subject => `已撤销「${subject}」`,
      /** @param {string} message */
      revokeFailed: message => `撤销失败：${message}`,
      /** @param {string} message */
      loadFailed: message => `读取邀请失败：${message}`,
      linkCreated: '已生成邀请链接。点「复制链接」发给同事。',
      /** @param {string} message */
      linkFailed: message => `生成失败：${message}`,
      emailsRequired: '填一个或多个邮箱',
      /** @param {string} email */
      notAnEmail: email => `「${email}」不是邮箱地址`,
      /** @param {{ invitedCount: number, alreadyMembers: string[] }} p */
      sent: ({ invitedCount, alreadyMembers }) =>
        (invitedCount > 0 ? `已邀请 ${invitedCount} 人。` : '') + (alreadyMembers.length > 0 ? `${alreadyMembers.join('、')} 已经是成员。` : ''),
    },
  },
}
