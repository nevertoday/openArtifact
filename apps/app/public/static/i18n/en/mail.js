// @ts-check
const days = (/** @type {number} */ count) => `${count} ${count === 1 ? 'day' : 'days'}`

export default /** @satisfies {import('../messages').Messages['mail']} */ ({
  notification: {
    openLink: link => `Open it: ${link}`,
    commentSubjects: {
      comment: ({ actor, title }) => `${actor}commented on “${title}”`,
      forAgent: ({ actor, title }) => `${actor}left a comment for the agent on “${title}”`,
      reply: ({ actor, title }) => `${actor}replied to a comment on “${title}”`,
      resolved: ({ actor, title }) => `${actor}resolved your comment on “${title}”`,
    },
    sharedBody: ({ sentence, role }) => `${sentence}. Your access: ${role}.`,
    publicLinkSubject: ({ sentence, daysLeft }) => `${sentence}, expiring in ${days(daysLeft)}`,
    publicLinkBody: ({ subject, expiryDate }) => `${subject} (${expiryDate}). Anyone with the link can open it without signing in. To change when it expires or make it private again, open the page and click Share.`,
    accessRequestedBody: ({ subject, email }) => `${subject}. Their email is ${email}. Open the page, click Share and add this address.`,
  },
  signIn: {
    subject: 'Sign in to Open Artifact',
    body: url => `Click the link below to sign in to Open Artifact. It works for 5 minutes:\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
  },
  invite: {
    subject: ({ inviter, workspace }) => `${inviter} invited you to join ${workspace}`,
    body: ({ inviter, workspace, days: lifetime, url }) => `${inviter} invited you to join ${workspace} on Open Artifact. Your team's agents publish pages here, and everyone views and comments on them together.\n\nClick the link below and sign in with this email address to join. It works for ${days(lifetime)}:\n\n${url}`,
  },
})
