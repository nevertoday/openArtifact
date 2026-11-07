import type { AppClient, AppResponse } from './app-client.ts'

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const FILES_SCHEMA = {
  type: 'array',
  description: 'The complete set of files of the version. Must include index.html; link other files with relative paths.',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path, e.g. "index.html" or "assets/chart.js".' },
      content: { type: 'string', description: 'File content: text, or base64 when encoding is "base64".' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
      contentType: { type: 'string', description: 'Optional; inferred from the extension.' },
    },
    required: ['path', 'content'],
  },
}

const NOTE = {
  type: 'string',
  maxLength: 200,
  description: 'What changed in this version, in one plain sentence (这次改了什么，一句话). People read it in the version list.',
}

const SUMMARY = {
  type: 'string',
  description: 'Optional: one or two sentences, at most 300 characters, saying what the page is about, shown on the personal page and in link previews. Left out, the page\'s own description or first paragraph is used.',
}
const SLUG = {
  type: 'string',
  description: '3–6 English words describing the page, e.g. quarterly-sales-review; shown in the link people share. Always pass one, above all when the title is not in English.',
}
const ARTIFACT_ID = { type: 'string', description: 'The artifactId returned by publish or list.' }

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'publish',
    description: 'Publish a new HTML artifact for the team and get its link. Before publishing, call list and update an existing artifact on the same subject instead of creating another.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name people will recognize, at most 200 characters.' },
        files: FILES_SCHEMA,
        visibility: {
          type: 'string',
          enum: ['private', 'specified', 'workspace', 'public_link'],
          default: 'workspace',
          description: 'public_link lets anyone with the link open the page without signing in. It expires in 7 days unless you pass publicLinkExpiresAt.',
        },
        publicLinkExpiresAt: {
          type: ['integer', 'null'],
          description: 'Only when the person said how long the public link should stay open: a time in milliseconds, or null for never.',
        },
        listed: {
          type: 'boolean',
          default: false,
          description: 'Only when the person asks to put it on their personal page (/@name), where strangers and search engines find it. Needs visibility public_link and a full-access token; the link then does not expire.',
        },
        slug: SLUG,
        summary: SUMMARY,
        note: NOTE,
      },
      required: ['title', 'files'],
    },
  },
  {
    name: 'update',
    description: 'Publish a new version of an artifact. Pass baseVersion = the version you read. If someone published in between, the result is a conflict with the latest files: merge your change into them and update again with baseVersion = currentVersion. Use force only when the person explicitly asks to overwrite. Always pass a note saying what you changed; when the change answers a comment, say which. Pass title only to rename the artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: ARTIFACT_ID,
        baseVersion: { type: 'integer', minimum: 1 },
        files: FILES_SCHEMA,
        note: NOTE,
        title: { type: 'string', description: 'Optional new name, at most 200 characters. Leave it out to keep the current one.' },
        slug: { ...SLUG, description: 'Optional new words for the link, e.g. quarterly-sales-review. Leave it out to keep the current ones; links sent earlier keep working either way.' },
        summary: SUMMARY,
        force: { type: 'boolean', default: false },
      },
      required: ['artifactId', 'files'],
    },
  },
  {
    name: 'read',
    description: 'Read the files and current version of an artifact, or of an older version.',
    inputSchema: { type: 'object', properties: { artifactId: ARTIFACT_ID, version: { type: 'integer', minimum: 1 } }, required: ['artifactId'] },
  },
  {
    name: 'list',
    description: 'List the artifacts you can see in your workspace, most recently updated first.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_my_comments',
    description: 'Find your work: the unresolved comments people addressed to an agent on every artifact you can edit, each with the artifact, its current version, the spot on the page and any replies. Then read the artifact, update it, and reply_comment with resolve.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_comments',
    description: 'List comments on an artifact. The default filter "for_agent" returns the unresolved comments people addressed to an agent: act on them, publish with update, then reply_comment with resolve.',
    inputSchema: {
      type: 'object',
      properties: { artifactId: ARTIFACT_ID, filter: { type: 'string', enum: ['for_agent', 'unresolved', 'all'], default: 'for_agent' } },
      required: ['artifactId'],
    },
  },
  {
    name: 'reply_comment',
    description: 'Reply to a comment, saying what you changed and in which version. Set resolve to mark the comment done.',
    inputSchema: {
      type: 'object',
      properties: { artifactId: ARTIFACT_ID, commentId: { type: 'string' }, body: { type: 'string', description: 'The reply, in the language of the comment.' }, resolve: { type: 'boolean', default: true } },
      required: ['artifactId', 'commentId', 'body'],
    },
  },
  {
    name: 'get_guide',
    description: 'Read the full guide: page rules, the CDN allowlist, the shared data SDK, and the update and comment workflows.',
    inputSchema: { type: 'object', properties: {} },
  },
]

/** Each tool is one call to the app's HTTP API, so the app's permission checks apply unchanged. */
export class AgentTools {
  readonly #appClient: AppClient

  constructor(appClient: AppClient) {
    this.#appClient = appClient
  }

  async call(toolName: string, toolArguments: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case 'publish':
        return this.#publish(toolArguments)
      case 'update':
        return this.#update(toolArguments)
      case 'read':
        return this.#read(toolArguments)
      case 'list':
        return AgentTools.#result(await this.#appClient.call('GET', '/api/artifacts'), 'Artifacts you can see:')
      case 'list_my_comments':
        return AgentTools.#result(await this.#appClient.call('GET', '/api/comments?for=me&status=open'), 'Unresolved comments addressed to your agent, oldest first:')
      case 'list_comments':
        return this.#listComments(toolArguments)
      case 'reply_comment':
        return this.#replyComment(toolArguments)
      case 'get_guide':
        return AgentTools.#result(await this.#appClient.call('GET', '/llms.txt'), '')
      default:
        return AgentTools.#error(`Unknown tool ${toolName}. Available: ${TOOL_DEFINITIONS.map(tool => tool.name).join(', ')}`)
    }
  }

  async #publish(toolArguments: Record<string, unknown>): Promise<ToolResult> {
    const { title, slug, files, visibility, note, publicLinkExpiresAt, listed, summary } = toolArguments
    const published = await this.#appClient.call('POST', '/api/artifacts', { title, slug, files, visibility, note, publicLinkExpiresAt, listed, summary })
    return AgentTools.#result(published, 'Published. Share the url with the person:')
  }

  async #update(toolArguments: Record<string, unknown>): Promise<ToolResult> {
    const { artifactId, baseVersion, files, note, title, slug, summary, force } = toolArguments
    const updated = await this.#appClient.call('PUT', `/api/artifacts/${AgentTools.#segment(artifactId)}`, { baseVersion, files, note, title, slug, summary, force })
    if (updated.status === 409) return AgentTools.#text(`Conflict: someone published in between. Merge your change into latestFiles and call update again with baseVersion = currentVersion.\n\n${JSON.stringify(updated.body, null, 2)}`)
    return AgentTools.#result(updated, 'Published a new version:')
  }

  async #read(toolArguments: Record<string, unknown>): Promise<ToolResult> {
    const versionQuery = toolArguments.version === undefined ? '' : `?version=${encodeURIComponent(String(toolArguments.version))}`
    return AgentTools.#result(await this.#appClient.call('GET', `/api/artifacts/${AgentTools.#segment(toolArguments.artifactId)}${versionQuery}`), 'Artifact:')
  }

  async #listComments(toolArguments: Record<string, unknown>): Promise<ToolResult> {
    const filter = typeof toolArguments.filter === 'string' ? toolArguments.filter : 'for_agent'
    const comments = await this.#appClient.call('GET', `/api/artifacts/${AgentTools.#segment(toolArguments.artifactId)}/comments?filter=${encodeURIComponent(filter)}`)
    return AgentTools.#result(comments, filter === 'for_agent' ? 'Unresolved comments addressed to an agent (replies included):' : 'Comments:')
  }

  async #replyComment(toolArguments: Record<string, unknown>): Promise<ToolResult> {
    const { artifactId, commentId, body } = toolArguments
    const resolve = toolArguments.resolve !== false
    const reply = await this.#appClient.call('POST', `/api/artifacts/${AgentTools.#segment(artifactId)}/comments`, { body, parentId: commentId, resolve })
    if (reply.status !== 201) return AgentTools.#result(reply, '')
    return AgentTools.#text(resolve ? 'Replied and marked the comment resolved.' : 'Replied.')
  }

  // An id is sent as one path segment, so a crafted id cannot reach a different API route.
  static #segment(value: unknown): string {
    return encodeURIComponent(String(value ?? ''))
  }

  static #result(appResponse: AppResponse, heading: string): ToolResult {
    const isSuccess = appResponse.status >= 200 && appResponse.status < 300
    const detail = typeof appResponse.body === 'string' ? appResponse.body : JSON.stringify(appResponse.body, null, 2)
    if (!isSuccess) return AgentTools.#error(`Open Artifact answered ${appResponse.status}: ${detail}`)
    return AgentTools.#text(heading ? `${heading}\n\n${detail}` : detail)
  }

  static #text(text: string): ToolResult {
    return { content: [{ type: 'text', text }] }
  }

  static #error(text: string): ToolResult {
    return { content: [{ type: 'text', text }], isError: true }
  }
}
