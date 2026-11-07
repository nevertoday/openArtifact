// @ts-check
export default {
  /**
   * An agent acting for a person is named first, so nobody mistakes its words for the person's own.
   * The label ends where the verb starts: a plain name with a space, the closing bracket without one.
   * @param {{ name: string, agentClient: string | null }} p
   */
  actorLabel: ({ name, agentClient }) => (agentClient === null ? `${name} ` : `${agentClient}（代 ${name}）`),
  sentences: {
    /** @param {{ actor: string, title: string }} p */
    comment_on_my_artifact: ({ actor, title }) => `${actor}评论了你的「${title}」`,
    /** @param {{ actor: string, title: string }} p */
    reply_to_my_comment: ({ actor, title }) => `${actor}回复了你在「${title}」的评论`,
    /** @param {{ actor: string, title: string }} p */
    my_comment_resolved: ({ actor, title }) => `${actor}解决了你在「${title}」的评论`,
    /** @param {{ actor: string, title: string }} p */
    new_version: ({ actor, title }) => `${actor}发布了「${title}」的新版本`,
    /** @param {{ actor: string, title: string }} p */
    shared_with_me: ({ actor, title }) => `${actor}把「${title}」分享给了你`,
    /** @param {{ actor: string, title: string }} p */
    public_link_opened: ({ actor, title }) => `${actor}把「${title}」设为公开链接`,
    /** @param {{ actor: string, title: string }} p */
    access_requested: ({ actor, title }) => `${actor}想查看「${title}」，请你分享给 TA`,
  },
}
