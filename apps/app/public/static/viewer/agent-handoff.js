/**
 * The words a person pastes to their own agent so it can act on comments: which page, which version to build on,
 * each comment with the spot it points at, and how to answer so the threads close. Any agent can follow it, with
 * the Open Artifact MCP tools or with the HTTP API described in llms.txt.
 */
export class AgentHandoff {
  #words
  #artifact

  /**
   * @param {import('../i18n/messages').Messages['viewerClient']['agentPrompt']} words  the prompt in the person's language, since their agent answers in it
   * @param {{ artifactId: string, title: string, version: number, url: string, guideUrl: string }} artifact
   */
  constructor(words, artifact) {
    this.#words = words
    this.#artifact = artifact
  }

  /** Threads in the order the reader sees them, which is the order the agent should work through them. */
  promptFor(threads) {
    if (threads.length === 0) throw new Error('no comments to hand off')
    const words = this.#words
    const { artifactId, title, version, url, guideUrl } = this.#artifact
    const isOne = threads.length === 1
    return [
      words.intro({ count: threads.length, title }),
      '',
      words.page(url),
      words.artifactId(artifactId),
      words.latestVersion(version),
      '',
      ...threads.flatMap(thread => this.#commentLines(thread)),
      words.howTitle,
      '',
      words.stepRead(artifactId),
      words.stepUpdate(isOne),
      words.stepReply(isOne),
      words.stepHttp(guideUrl),
      '',
    ].join('\n')
  }

  #commentLines(thread) {
    const { root } = thread
    return [
      this.#words.commentTitle(thread.number),
      '',
      this.#words.spot(this.#spotOf(root.anchor)),
      this.#words.said({ author: root.author.name, body: root.body }),
      this.#words.commentId(root.commentId),
      '',
    ]
  }

  // The words the reader pointed at, plus the element and version, so the agent can find the spot even if the page moved.
  #spotOf(anchor) {
    const words = this.#words
    if (!anchor) return words.wholePage
    const quoted = anchor.quote?.exact ?? anchor.textQuote
    const details = [anchor.selector ? words.element(anchor.selector) : null, anchor.version ? words.writtenOn(anchor.version) : null].filter(Boolean)
    const where = quoted ? words.words(quoted) : words.somewhereOnPage
    return details.length > 0 ? words.spotWithDetails({ where, details }) : where
  }
}
