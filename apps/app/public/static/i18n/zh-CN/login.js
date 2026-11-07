// @ts-check
export default {
  pageTitle: '登录 · Open Artifact',
  story: {
    headlineFirst: '任何 agent 发布，',
    headlineSecond: '整个团队都能用。',
    pitch: 'Claude Code、Codex、Cursor 等 agent 发布的页面都在这里。查看、评论，再让 agent 去改。',
    storage: '页面和数据都存在团队自己的 Cloudflare 账号里。',
  },
  heading: '登录',
  intro: '输入邮箱，我们发一个登录链接，不用密码。',
  returnsToPage: '登录后会打开你刚才的页面。',
  /** @template T @param {T} address @returns {(string | T)[]} */
  linkSent: address => ['登录链接已发送到 ', address, '，5 分钟内有效。没收到的话，检查垃圾邮件，或者再发一次。'],
  /** @param {string} provider */
  signInWith: provider => `用 ${provider} 登录`,
  companySso: '公司 SSO',
  orWithEmail: '或者用邮箱',
  emailLabel: '邮箱',
  errorRequired: '输入邮箱',
  errorInvalid: '请输入有效的邮箱，比如 name@example.com',
  errorNotAdmitted: '这个邮箱不能登录 Open Artifact。请用公司邮箱，或请管理员邀请你。',
  sendLink: '发送登录链接',
  invitation: {
    /** @param {{ inviter: string, workspace: string }} p */
    title: ({ inviter, workspace }) => `${inviter} 邀请你加入 ${workspace}`,
    joinAfterSignIn: '登录后就会加入。',
    /** @template T @param {T} email @returns {(string | T)[]} */
    joinAs: email => ['用 ', email, ' 登录后就会加入。'],
  },
}
