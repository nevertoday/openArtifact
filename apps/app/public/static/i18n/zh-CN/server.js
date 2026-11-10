// @ts-check
export default {
  // A space between a Latin or digit ending and 的, as Chinese typesetting puts one: founder 的工作区, 小东的工作区.
  /** @param {string} name */
  personalWorkspaceName: name => (/[\p{Script=Han}]$/u.test(name) ? `${name}的工作区` : `${name} 的工作区`),
  deletedPerson: '已删除的用户',
  operator: 'Open Artifact 运营方',
}
