// @ts-check
export default {
  visibility: {
    private: '私有',
    specified: '指定的人',
    workspace: '工作区内可见',
    public_link: '公开链接',
  },
  roles: { admin: '管理员', member: '成员' },
  grantRoles: { viewer: '可查看', commenter: '可评论', editor: '可编辑' },
  webPage: '网页',
  hasPassword: '有密码',
  /** @param {string} date */
  expiresOn: date => `${date} 过期`,
  expired: '已过期',
  removal: { remove: '删除', takeDown: '下架' },
  removedBy: {
    /** @param {string} name */
    remove: name => `${name} 删除`,
    /** @param {string} name */
    takeDown: name => `${name} 下架`,
  },
  /** @param {number} days */
  purgeIn: days => `${days} 天后彻底删除`,
  /** @param {string} author */
  publishedOnWeb: author => `${author} 在网页上发布`,
  /** @param {{ author: string, via: string }} p */
  publishedWith: ({ author, via }) => `${author} 用 ${via} 发布`,
}
