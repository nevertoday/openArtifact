// @ts-check
export default /** @satisfies {import('../messages').Messages['labels']} */ ({
  visibility: {
    private: 'Private',
    specified: 'Specific people',
    workspace: 'Workspace',
    public_link: 'Public link',
  },
  roles: { admin: 'Admin', member: 'Member' },
  grantRoles: { viewer: 'Can view', commenter: 'Can comment', editor: 'Can edit' },
  webPage: 'Web',
  hasPassword: 'Password',
  expiresOn: date => `Expires ${date}`,
  expired: 'Expired',
  removal: { remove: 'Delete', takeDown: 'Take down' },
  removedBy: {
    remove: name => `Deleted by ${name}`,
    takeDown: name => `Taken down by ${name}`,
  },
  purgeIn: days => `Deleted for good in ${days} ${days === 1 ? 'day' : 'days'}`,
  publishedOnWeb: author => `${author} published on the web`,
  publishedWith: ({ author, via }) => `${author} published with ${via}`,
})
