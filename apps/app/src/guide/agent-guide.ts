export type GuideFormat = 'agents-md' | 'claude-skill' | 'cursor-rule' | 'llms-txt'

/** The formats the settings page offers to copy; llms.txt is served at its own address instead. */
export const GUIDE_PACK_FORMATS = ['agents-md', 'claude-skill', 'cursor-rule'] as const satisfies readonly GuideFormat[]
export type GuidePackFormat = (typeof GUIDE_PACK_FORMATS)[number]

export interface GuideFile<Format extends GuideFormat = GuideFormat> {
  format: Format
  content: string
}

const SKILL_DESCRIPTION = 'Publish HTML pages, reports and dashboards to the team\'s Open Artifact instance, and act on comments people leave on them.'

/**
 * One source of truth for how an agent should use Open Artifact. Every format the settings page offers,
 * /llms.txt and the MCP get_guide tool are rendered from it, so they never disagree.
 */
export class AgentGuide {
  readonly #appOrigin: string
  readonly #mcpUrl: string

  constructor(appOrigin: string, mcpUrl: string) {
    this.#appOrigin = appOrigin
    this.#mcpUrl = mcpUrl
  }

  files(): GuideFile<GuidePackFormat>[] {
    return GUIDE_PACK_FORMATS.map(format => ({ format, content: this.#content(format) }))
  }

  file(format: GuideFormat): GuideFile {
    return { format, content: this.#content(format) }
  }

  #content(format: GuideFormat): string {
    switch (format) {
      case 'agents-md':
        return `## Open Artifact\n\n${this.#body()}`
      case 'claude-skill':
        return `---\nname: open-artifact\ndescription: ${SKILL_DESCRIPTION}\n---\n\n# Open Artifact\n\n${this.#body()}`
      case 'cursor-rule':
        return `---\ndescription: ${SKILL_DESCRIPTION}\nalwaysApply: false\n---\n\n# Open Artifact\n\n${this.#body()}`
      case 'llms-txt':
        return `# Open Artifact\n\n> ${SKILL_DESCRIPTION}\n\n${this.#body()}`
    }
  }

  #body(): string {
    const api = `${this.#appOrigin}/api`
    return `Open Artifact hosts HTML pages ("artifacts") for the team at ${this.#appOrigin}. Teammates open them in the browser, comment on them, and use them; you publish and revise them.

### When to publish
- Publish when the result is something people will read or use outside this chat: a design doc, report, dashboard, plan, sign-up sheet.
- Before creating a new artifact for the same subject, \`list\` the existing ones and update the right one instead.
- Always pass a \`slug\`: 3–6 lower-case English words joined by dashes that say what the page is (\`quarterly-sales-review\`), above all when the title is not in English. It goes into the link (\`/a/quarterly-sales-review-k7f3q9x2m4ab\`), so people who get the link in a chat can tell what it is before they sign in. Without one, the link takes the words of the title, a Chinese one machine-translated.
- Share the \`url\` the response returns. It stays valid when the title or slug changes later.

### How to connect
- MCP (preferred): ${this.#mcpUrl}, header \`Authorization: Bearer <personal API token>\`. Tools: publish, update, read, list, list_my_comments, list_comments, reply_comment, get_guide.
- HTTP: ${api}, same header. Also send \`X-Open-Artifact-Client: <your client name>\` so people see which agent published.
- A token has a scope, chosen when your person creates it. \`publish\` (the default) publishes, updates, reads, lists, comments, uses shared data and renames. \`full\` can also change sharing and remove or restore artifacts. With a \`publish\` token those calls answer 403 "this token may only publish"; tell your person instead of retrying.

### Page rules
- Every version is the complete set of files and must include \`index.html\`. Link other files with relative paths (\`style.css\`, \`assets/chart.js\`).
- Scripts load only from your own files and https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net/npm, https://unpkg.com. Fonts from Google Fonts. No other network access.
- The page runs in a sandbox on its own origin: no cookies, and \`localStorage\` throws. Keep state in shared data (below).
- Give the page a short \`<title>\`, support light and dark themes, work at phone width, and write in the language the person uses.

### Update, never overwrite blindly
1. \`read\` the artifact; note its \`version\`.
2. \`update\` with \`baseVersion\` set to that version, and a \`note\`: what you changed, in one sentence of at most 200 characters (\`"Linked up section 3 as the comment asked"\`). People read notes in the version list, so pass one on every update, above all when the change answers a comment.
3. On a conflict (HTTP 409), someone published in between: merge your change into \`latestFiles\` from the response and update again with \`baseVersion = currentVersion\`.
4. Pass \`force: true\` only when the person explicitly asks to overwrite.
5. To rename, pass \`title\` with the update. Leave it out to keep the current title. A new title keeps the link's words; pass \`slug\` to change them.

### Sharing and public links
- Choose \`visibility\` when you publish: \`private\`, \`specified\` (only the people the author adds), \`workspace\` (the default), or \`public_link\`.
- A public link opens for anyone without signing in. Visitors see the current page only: no comments, versions or shared-data overview, unless the author turns comments on.
- When you set \`public_link\` without \`publicLinkExpiresAt\`, the link expires in 7 days and your person gets a mail saying so. Pass \`publicLinkExpiresAt\` (milliseconds, or \`null\` for never) only when the person told you how long it should stay open.
- Changing sharing after publishing needs a \`full\` token. Usually leave it to the person: the Share (分享) button on the artifact's page.

### Personal page
- Each person has a public page at \`/@name\` listing the artifacts they chose to show strangers; search engines may index it.
- Pass \`listed: true\` with \`visibility: "public_link"\` only when the person asks to put the page there. It needs a \`full\` token, and the link then does not expire.
- Pass \`summary\` (at most 300 characters) to say what the page is about; otherwise its \`<meta name="description">\` or first paragraph is shown, so give pages a description.
- To share a page on X, list it on the personal page: only a listed page gets the picture card X shows, and links to anything else may stop working. Publish and update answer \`share\` with \`readiness\` (why not, when it cannot go out) and \`x.intentUrl\`, a ready post to hand the person; pass \`shareText\` to write the post's words yourself (280 with the link counted as 23 and CJK as 2).

### Removing
- Remove an artifact only when the person asks. MCP has no tool for it: use the HTTP API below, or ask the person to choose Delete (删除) on the artifact's page. It disappears for everyone at once and can be restored for 30 days; then it is deleted for good.
- Removing and restoring need a \`full\` token. You may remove and restore only what your person may: their own artifacts, or any artifact when they are a workspace admin. If an admin took it down, only an admin can restore it.

### Comments addressed to you
People turn on For agent (给 agent) on a comment when they want an agent to act. When you start a session, or the person asks you to check:
1. \`list_my_comments\` returns the unresolved comments addressed to an agent on every artifact you can edit, oldest first. Each names the artifact, its current \`version\`, the comment's \`anchor\` and any replies.
2. \`read\` the artifact and find the spot: \`anchor.selector\` is a CSS path to the element the person clicked and \`anchor.textQuote\` the start of its text, both as of \`anchor.version\`. When the person selected words, \`anchor.quote.exact\` holds them, with \`prefix\` and \`suffix\` from the text around them. Older comments only have \`x\` and \`y\`, fractions of the page's width and height.
3. Make the change and publish it with \`update\`, with a \`note\` that says which comment it answers.
4. \`reply_comment\` with \`resolve: true\`, saying what you changed and in which version. Leave \`resolve\` false only when you need the person to answer first.
To look at one artifact only, \`list_comments\` with \`filter: "for_agent"\`.

### Shared data in the page
The platform injects \`window.openArtifact\` into every page:
\`\`\`js
const signups = window.openArtifact.db.collection('signups')
await signups.put('lin', { session: 'Morning' })   // create or replace by id
await signups.add({ session: 'Afternoon' })        // new id
const documents = await signups.list()             // [{ id, data, createdBy, updatedBy, ... }]
await signups.delete('lin')
const viewer = await window.openArtifact.viewer()  // { userId, name } or null for an anonymous visitor
\`\`\`
Collection names and ids: letters, digits, \`-\`, \`_\`; at most 64 characters. A document is at most 64 KB of JSON.

### HTTP API
- \`POST ${api}/artifacts\` \`{ title, slug?, visibility?, publicLinkExpiresAt?, listed?, summary?, shareText?, note?, files: [{ path, content, encoding?: "utf8"|"base64", contentType? }] }\`
- \`GET ${api}/artifacts\`, \`GET ${api}/artifacts/{id}\`
- \`PUT ${api}/artifacts/{id}\` \`{ baseVersion, note, files, title?, slug?, summary?, shareText? }\`; \`PATCH ${api}/artifacts/{id}\` \`{ title?, slug?, summary?, shareText? }\` renames or re-summarizes without a new version. \`{id}\` is the \`artifactId\`; the address part of a link someone gave you (\`/a/{this-part}\`) works too
- \`PUT ${api}/artifacts/{id}/sharing\` \`{ visibility?, publicLinkExpiresAt?, publicLinkPassword?, anonymousWriteEnabled?, publicLinkShowsComments?, listed? }\` (full token); fields left out keep their value
- \`DELETE ${api}/artifacts/{id}\` removes it; \`GET ${api}/artifacts?removed=true\` lists what you can restore; \`POST ${api}/artifacts/{id}/restore\` brings it back
- \`GET ${api}/comments?for=me&status=open\`: your agent's open comments across artifacts you can edit.
- \`GET ${api}/artifacts/{id}/comments?filter=for_agent|unresolved|all\`
- \`POST ${api}/artifacts/{id}/comments\` \`{ body, parentId, resolve: true }\` replies and resolves the thread in one call; leave out \`resolve\` to keep it open.
- \`PATCH ${api}/comments/{commentId}\` \`{ resolved: true }\` resolves without a reply; \`false\` reopens.
- \`GET ${api}/artifacts/{id}/data\`: the page's shared data collections, each \`{ collection, documentCount }\`.
- \`GET ${api}/artifacts/{id}/data/{collection}\`: its documents, each \`{ id, data, createdBy, updatedBy, createdAt, updatedAt }\`. Read these to answer questions about sign-ups, votes or other data people entered.
- Errors answer \`{ error, code }\`: \`error\` says in English what to do, \`code\` is stable (\`token_revoked\`, \`token_expired\`, \`token_invalid\`, \`outside_token_scope\`, \`version_conflict\`, \`not_found\`, \`field_required\`…); a field error also names its \`field\`. On \`token_revoked\` or \`token_expired\`, ask the person for a new token from Settings › Agent access (设置 › Agent 接入).
`
  }
}
