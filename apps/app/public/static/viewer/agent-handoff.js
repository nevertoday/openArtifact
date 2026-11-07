/**
 * The words a person pastes to their own agent so it can act on comments: which page, which version to build on,
 * each comment with the spot it points at, and how to answer so the threads close. Any agent can follow it, with
 * the Open Artifact MCP tools or with the HTTP API described in llms.txt.
 */
export class AgentHandoff {
  #artifact

  /** @param {{ artifactId: string, title: string, version: number, url: string, guideUrl: string }} artifact */
  constructor(artifact) {
    this.#artifact = artifact
  }

  /** Threads in the order the reader sees them, which is the order the agent should work through them. */
  promptFor(threads) {
    if (threads.length === 0) throw new Error('no comments to hand off')
    const { artifactId, title, version, url, guideUrl } = this.#artifact
    const isOne = threads.length === 1
    return [
      `请按 Open Artifact 上的 ${threads.length} 条评论修改「${title}」。`,
      '',
      `- 页面：${url}`,
      `- artifactId：${artifactId}`,
      `- 最新版本：v${version}（发布新版本时 baseVersion 用你读到的版本）`,
      '',
      ...threads.flatMap(thread => AgentHandoff.#commentLines(thread)),
      '## 怎么完成',
      '',
      `1. 读最新版本：MCP 用 \`read\`（artifactId: ${artifactId}）。`,
      `2. 改完发布新版本：MCP 用 \`update\`，带上 baseVersion，并在 note 里一句话写清改了什么、回应了${isOne ? '这条评论' : '哪几条评论'}。`,
      `3. ${isOne ? '回复这条评论' : '每条评论都回复一次'}：MCP 用 \`reply_comment\`（commentId 见上），说明在哪个版本改的，并设 \`resolve: true\` 关闭讨论。`,
      `4. 没有 Open Artifact MCP 时，照 ${guideUrl} 用 HTTP API 做同样的三步。`,
      '',
    ].join('\n')
  }

  static #commentLines(thread) {
    const { root } = thread
    return [
      `## 评论 ${thread.number}`,
      '',
      `- 位置：${AgentHandoff.#spotOf(root.anchor)}`,
      `- ${root.author.name}：${root.body}`,
      `- commentId：${root.commentId}`,
      '',
    ]
  }

  // The words the reader pointed at, plus the element and version, so the agent can find the spot even if the page moved.
  static #spotOf(anchor) {
    if (!anchor) return '整个页面'
    const words = anchor.quote?.exact ?? anchor.textQuote
    const details = [anchor.selector ? `元素 \`${anchor.selector}\`` : null, anchor.version ? `写于 v${anchor.version}` : null].filter(Boolean).join('，')
    const where = words ? `「${words}」` : '页面上的一处'
    return details ? `${where}（${details}）` : where
  }
}
