// @ts-check
export default /** @satisfies {import('../messages').Messages['login']} */ ({
  pageTitle: 'Sign in · Open Artifact',
  story: {
    headlineFirst: 'Any agent publishes,',
    headlineSecond: 'your whole team uses it.',
    pitch: 'Pages published by Claude Code, Codex, Cursor and other agents all live here. Read them, comment, then let the agent make the changes.',
    storage: 'Pages and data stay in your team\'s own Cloudflare account.',
  },
  heading: 'Sign in',
  intro: 'Enter your email and we\'ll send you a sign-in link. No password needed.',
  returnsToPage: 'After you sign in, the page you were on opens.',
  linkSent: address => ['We sent a sign-in link to ', address, '. It works for 5 minutes. If it doesn\'t arrive, check your spam folder or send it again.'],
  signInWith: provider => `Sign in with ${provider}`,
  companySso: 'company SSO',
  orWithEmail: 'or use your email',
  emailLabel: 'Email',
  errorRequired: 'Enter your email',
  errorInvalid: 'Enter a valid email, like name@example.com',
  errorNotAdmitted: 'This email can\'t sign in to Open Artifact. Use your work email, or ask an admin to invite you.',
  sendLink: 'Send sign-in link',
  invitation: {
    title: ({ inviter, workspace }) => `${inviter} invited you to join ${workspace}`,
    joinAfterSignIn: 'Sign in to join.',
    joinAs: email => ['Sign in with ', email, ' to join.'],
  },
})
