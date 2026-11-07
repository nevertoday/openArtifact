// @ts-check
export default {
  notification: {
    /** @param {string} link */
    openLink: link => `打开查看：${link}`,
    roles: { viewer: '可查看', commenter: '可评论', editor: '可编辑' },
    commentSubjects: {
      /** @param {{ actor: string, title: string }} p */
      comment: ({ actor, title }) => `${actor}在「${title}」发表了评论`,
      /** @param {{ actor: string, title: string }} p */
      forAgent: ({ actor, title }) => `${actor}在「${title}」留了一条给 agent 的评论`,
      /** @param {{ actor: string, title: string }} p */
      reply: ({ actor, title }) => `${actor}在「${title}」回复了评论`,
      /** @param {{ actor: string, title: string }} p */
      resolved: ({ actor, title }) => `${actor}在「${title}」解决了你的评论`,
    },
    /** @param {{ sentence: string, role: string }} p */
    sharedBody: ({ sentence, role }) => `${sentence}，你的权限是「${role}」。`,
    /** @param {{ sentence: string, daysLeft: number }} p */
    publicLinkSubject: ({ sentence, daysLeft }) => `${sentence}，${daysLeft} 天后过期`,
    /** @param {{ subject: string, expiryDate: string }} p */
    publicLinkBody: ({ subject, expiryDate }) => `${subject}（${expiryDate}）。拿到链接的人不用登录就能打开。要改有效期或取消公开，打开页面后点「分享」。`,
    /** @param {{ subject: string, email: string }} p */
    accessRequestedBody: ({ subject, email }) => `${subject}。TA 的邮箱是 ${email}。打开页面后点「分享」，把这个邮箱加进来。`,
  },
  signIn: {
    subject: '登录 Open Artifact',
    /** @param {string} url */
    body: url => `点下面的链接登录 Open Artifact，链接 5 分钟内有效：\n\n${url}\n\n如果不是你本人操作，忽略这封邮件即可。`,
  },
  invite: {
    /** @param {{ inviter: string, workspace: string }} p */
    subject: ({ inviter, workspace }) => `${inviter} 邀请你加入 ${workspace}`,
    /** @param {{ inviter: string, workspace: string, days: number, url: string }} p */
    body: ({ inviter, workspace, days, url }) => `${inviter} 邀请你加入 Open Artifact 上的 ${workspace}。团队的 agent 在这里发布页面，大家一起查看和评论。\n\n点下面的链接，用这个邮箱登录就能加入，${days} 天内有效：\n\n${url}`,
  },
}
