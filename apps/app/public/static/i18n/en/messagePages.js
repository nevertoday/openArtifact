// @ts-check
export default /** @satisfies {import('../messages').Messages['messagePages']} */ ({
  backHome: 'Back to home',
  password: {
    pageTitle: 'Password required · Open Artifact',
    title: 'This link needs a password',
    text: 'This page is protected by a password. Ask the person who shared it with you.',
    label: 'Password',
    errorRequired: 'Enter the password',
    errors: {
      wrong: 'That password isn\'t right. Try again.',
      wait: 'Too many tries. To protect this link, you can try again in 1 minute.',
    },
    open: 'Open',
  },
  noAccess: {
    pageTitle: 'No access · Open Artifact',
    title: 'You don\'t have access to this artifact',
    text: author => `${author} published it and hasn't shared it with you yet.`,
    requestAccess: 'Ask the author to share it',
  },
  removed: {
    pageTitle: 'Page deleted · Open Artifact',
    title: title => `“${title}” was deleted`,
    text: purge => `Nobody can open it now. ${purge}; until then it can be restored, with its link, comments and sharing as they were.`,
    restore: 'Restore page',
    seeAll: 'See recently deleted',
  },
  notFound: {
    pageTitle: 'Not found · Open Artifact',
    title: 'This artifact can\'t be found',
    text: signedIn => `It may have been deleted, or it hasn't been shared with you.${signedIn ? '' : ' If it was shared with you, sign in first and open it again.'}`,
  },
  unknownAddress: {
    pageTitle: 'Page not found · Open Artifact',
    title: 'This address doesn\'t exist',
    text: 'Check that the link is complete, or find the artifact you want from the home page.',
  },
  removedFromWorkspace: {
    pageTitle: 'Removed · Open Artifact',
    title: 'You were removed from this workspace. Contact an admin.',
    text: 'Artifacts you published stay in the workspace after an admin removes you. If you used the wrong account, sign out and sign in with another.',
  },
  inviteUnusable: {
    pageTitle: 'Invite expired · Open Artifact',
    title: 'This invite no longer works',
    text: 'Invites expire after 7 days, or an admin may have revoked it. Ask an admin to invite you again.',
    goSignIn: 'Go to sign in',
  },
  inviteForOtherAddress: {
    pageTitle: 'Invite for someone else · Open Artifact',
    title: email => `This invite was sent to ${email}`,
    text: 'Sign out and sign in with that email to join.',
  },
})
