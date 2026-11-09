// @ts-check
export default {
  pageTitle: '登录 · Open Artifact',
  story: {
    headlineFirst: '你的 agent 做的页面，',
    headlineSecond: '在这里被看见、被讨论。',
    pitch: 'Claude Code、Codex、Cursor 发布的页面都在这里。打开就能看，在页面上直接评论，再让 agent 去改。',
    storage: '免费使用。第一次登录就有你自己的工作区，也可以邀请别人一起用。',
  },
  heading: '登录或注册',
  intro: '输入邮箱，我们发一个 6 位验证码。新邮箱会自动注册。',
  returnsToPage: '你要打开的页面需要登录后才能看。登录后会直接打开它。',
  /** @template T @param {T} address @returns {(string | T)[]} */
  codeSentTo: address => ['6 位验证码已发送到 ', address],
  changeEmail: '换个邮箱',
  codeLabel: '6 位验证码',
  noMail: '没收到？看看垃圾邮件。',
  /** @param {string} provider */
  signInWith: provider => `用 ${provider} 登录`,
  companySso: '公司 SSO',
  orWithEmail: '或者用邮箱',
  emailLabel: '邮箱',
  errorRequired: '输入邮箱',
  errorInvalid: '请输入有效的邮箱，比如 name@example.com',
  errorNotAdmitted: '这个邮箱还不能注册。请让管理员邀请你。',
  sendCode: '发送验证码',
  invitation: {
    /** @param {{ inviter: string, workspace: string }} p */
    title: ({ inviter, workspace }) => `${inviter} 邀请你加入 ${workspace}`,
    joinAfterSignIn: '登录后就会加入。',
    /** @template T @param {T} email @returns {(string | T)[]} */
    joinAs: email => ['用 ', email, ' 登录后就会加入。'],
  },
}
