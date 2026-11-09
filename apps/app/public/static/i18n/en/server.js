// @ts-check
export default /** @satisfies {import('../messages').Messages['server']} */ ({
  /** @param {string} name */
  personalWorkspaceName: name => `${name}'s workspace`,
  deletedPerson: 'Deleted user',
  operator: 'Open Artifact operator',
})
