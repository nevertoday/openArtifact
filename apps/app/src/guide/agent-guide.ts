export type GuideFormat = 'agents-md' | 'claude-skill' | 'cursor-rule' | 'llms-txt'

export interface GuideFile {
  format: GuideFormat
  label: string
  /** Where the person saves it; shown next to the copy button. */
  savePath: string
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

  files(): GuideFile[] {
    return (['agents-md', 'claude-skill', 'cursor-rule'] as const).map(format => this.file(format))
  }

  file(format: GuideFormat): GuideFile {
    switch (format) {
      case 'agents-md':
        return { format, label: 'AGENTS.md 片段', savePath: '追加到仓库根目录的 AGENTS.md', content: `## Open Artifact\n\n${this.#body()}` }
      case 'claude-skill':
        return { format, label: 'Claude Skill', savePath: '~/.claude/skills/open-artifact/SKILL.md', content: `---\nname: open-artifact\ndescription: ${SKILL_DESCRIPTION}\n---\n\n# Open Artifact\n\n${this.#body()}` }
      case 'cursor-rule':
        return { format, label: 'Cursor rules', savePath: '.cursor/rules/open-artifact.mdc', content: `---\ndescription: ${SKILL_DESCRIPTION}\nalwaysApply: false\n---\n\n# Open Artifact\n\n${this.#body()}` }
      case 'llms-txt':
        return { format, label: 'llms.txt', savePath: `${this.#appOrigin}/llms.txt`, content: `# Open Artifact\n\n> ${SKILL_DESCRIPTION}\n\n${this.#body()}` }
    }
  }

  #body(): string {
    const api = `${this.#appOrigin}/api`
    return `Open Artifact hosts HTML pages ("artifacts") for the team at ${this.#appOrigin}. Teammates open them in the browser, comment on them, and use them; you publish and revise them.

### When to publish
- Publish when the result is something people will read or use outside this chat: a design doc, report, dashboard, plan, sign-up sheet.
- Before creating a new artifact for the same subject, \`list\` the existing ones and update the right one instead.

### How to connect
- MCP (preferred): ${this.#mcpUrl}, header \`Authorization: Bearer <personal API token>\`. Tools: publish, update, read, list, list_comments, reply_comment, get_guide.
- HTTP: ${api}, same header. Also send \`X-Open-Artifact-Client: <your client name>\` so people see which agent published.
- A token has a scope, chosen when your person creates it. \`publish\` (the default) publishes, updates, reads, lists, comments, uses shared data and renames. \`full\` can also change sharing and remove or restore artifacts. With a \`publish\` token those calls answer 403 "this token may only publish"; tell your person instead of retrying.

### Page rules
- Every version is the complete set of files and must include \`index.html\`. Link other files with relative paths (\`style.css\`, \`assets/chart.js\`).
- Scripts load only from your own files and https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net/npm, https://unpkg.com. Fonts from Google Fonts. No other network access.
- The page runs in a sandbox on its own origin: no cookies, and \`localStorage\` throws. Keep state in shared data (below).
- Give the page a short \`<title>\`, support light and dark themes, work at phone width, and write in the language the person uses.

### Update, never overwrite blindly
1. \`read\` the artifact; note its \`version\`.
2. \`update\` with \`baseVersion\` set to that version, and a \`note\`: what you changed, in one sentence of at most 200 characters (\`"按评论把第 3 节的连线补上"\`). People read notes in the version list, so pass one on every update, above all when the change answers a comment.
3. On a conflict (HTTP 409), someone published in between: merge your change into \`latestFiles\` from the response and update again with \`baseVersion = currentVersion\`.
4. Pass \`force: true\` only when the person explicitly asks to overwrite.
5. To rename, pass \`title\` with the update. Leave it out to keep the current title.

### Sharing and public links
- Choose \`visibility\` when you publish: \`private\`, \`specified\` (only the people the author adds), \`workspace\` (the default), or \`public_link\`.
- A public link opens for anyone without signing in. Visitors see the current page only: no comments, versions or shared-data overview, unless the author turns comments on.
- When you set \`public_link\` without \`publicLinkExpiresAt\`, the link expires in 7 days and your person gets a mail saying so. Pass \`publicLinkExpiresAt\` (milliseconds, or \`null\` for never) only when the person told you how long it should stay open.
- Changing sharing after publishing needs a \`full\` token. Usually leave it to the person: the 分享 button on the artifact's page.

### Removing
- Remove an artifact only when the person asks. MCP has no tool for it: use the HTTP API below, or ask the person to choose 删除 on the artifact's page. It disappears for everyone at once and can be restored for 30 days; then it is deleted for good.
- Removing and restoring need a \`full\` token. You may remove and restore only what your person may: their own artifacts, or any artifact when they are a workspace admin. If an admin took it down, only an admin can restore it.

### Comments addressed to you
1. \`list_comments\` with \`filter: "for_agent"\` returns unresolved comments people marked 给 agent.
2. Make the change and publish it with \`update\`.
3. \`reply_comment\` with \`resolve: true\`, saying what you changed and in which version.

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
- \`POST ${api}/artifacts\` \`{ title, visibility?, publicLinkExpiresAt?, note?, files: [{ path, content, encoding?: "utf8"|"base64", contentType? }] }\`
- \`GET ${api}/artifacts\`, \`GET ${api}/artifacts/{id}\`
- \`PUT ${api}/artifacts/{id}\` \`{ baseVersion, note, files, title? }\`; \`PATCH ${api}/artifacts/{id}\` \`{ title }\` renames without a new version
- \`PUT ${api}/artifacts/{id}/sharing\` \`{ visibility?, publicLinkExpiresAt?, publicLinkPassword?, anonymousWriteEnabled?, publicLinkShowsComments? }\` (full token); fields left out keep their value
- \`DELETE ${api}/artifacts/{id}\` removes it; \`GET ${api}/artifacts?removed=true\` lists what you can restore; \`POST ${api}/artifacts/{id}/restore\` brings it back
- \`GET ${api}/artifacts/{id}/comments?filter=for_agent\`, \`POST ${api}/artifacts/{id}/comments\` \`{ body, parentId }\`, \`PATCH ${api}/comments/{commentId}\` \`{ resolved: true }\`
`
  }
}
