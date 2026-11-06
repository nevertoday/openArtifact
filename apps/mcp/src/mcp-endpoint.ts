import { AgentTools, TOOL_DEFINITIONS } from './agent-tools.ts'
import { AppClient } from './app-client.ts'

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'open-artifact', version: '0.1.0' }
const SESSION_PREFIX = 'oa1.'
const SERVER_INSTRUCTIONS =
  'Open Artifact hosts HTML pages for your team. Publish with publish, revise with read then update (pass baseVersion). People leave comments for you: list_my_comments finds them across artifacts, then read the artifact, update it, and reply_comment with resolve: true saying what changed in which version. Call get_guide once for the page rules before your first publish.'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

const KNOWN_CLIENTS: [RegExp, string][] = [
  [/claude[-_ ]?code/i, 'Claude Code'],
  [/codex/i, 'Codex'],
  [/cursor/i, 'Cursor'],
  [/gemini/i, 'Gemini CLI'],
  [/cline/i, 'Cline'],
  [/windsurf/i, 'Windsurf'],
]

/**
 * A stateless MCP endpoint over Streamable HTTP that answers with plain JSON. The session id carries the
 * client's name from the handshake, so tool calls on later requests still say which agent made them.
 */
export class McpEndpoint {
  readonly #app: Fetcher
  readonly #appOrigin: string

  constructor(app: Fetcher, appOrigin: string) {
    this.#app = app
    this.#appOrigin = appOrigin
  }

  async respond(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/health') return Response.json({ service: 'open-artifact-mcp', status: 'ok' })
    if (requestUrl.pathname !== '/mcp') return new Response('Not found', { status: 404 })
    if (request.method !== 'POST') return new Response('This server answers MCP over POST only; it does not open event streams.', { status: 405, headers: { Allow: 'POST' } })
    const authorization = request.headers.get('Authorization') ?? ''
    if (!/^bearer oa_pat_/i.test(authorization)) return McpEndpoint.#unauthorized()
    let message: unknown
    try {
      message = await request.json()
    } catch {
      return Response.json(McpEndpoint.#errorResponse(null, -32700, 'Parse error: the body is not JSON'), { status: 400 })
    }
    const messages = Array.isArray(message) ? message : [message]
    const sessionClient = McpEndpoint.#clientFromSession(request.headers.get('Mcp-Session-Id'))
    const answers = await Promise.all(messages.map(rpcMessage => this.#answer(rpcMessage as JsonRpcRequest, authorization, sessionClient)))
    const responses = answers.map(answer => answer.response).filter(response => response !== null)
    const sessionId = answers.find(answer => answer.sessionId)?.sessionId
    const headers: Record<string, string> = sessionId ? { 'Mcp-Session-Id': sessionId } : {}
    if (responses.length === 0) return new Response(null, { status: 202, headers })
    return Response.json(Array.isArray(message) ? responses : responses[0], { headers })
  }

  async #answer(rpcMessage: JsonRpcRequest, authorization: string, sessionClient: string): Promise<{ response: unknown; sessionId?: string }> {
    const isNotification = rpcMessage.id === undefined
    if (isNotification) return { response: null }
    switch (rpcMessage.method) {
      case 'initialize':
        return this.#initialize(rpcMessage)
      case 'ping':
        return { response: McpEndpoint.#resultResponse(rpcMessage.id, {}) }
      case 'tools/list':
        return { response: McpEndpoint.#resultResponse(rpcMessage.id, { tools: TOOL_DEFINITIONS }) }
      case 'tools/call': {
        const toolName = String(rpcMessage.params?.name ?? '')
        const toolArguments = (rpcMessage.params?.arguments ?? {}) as Record<string, unknown>
        const agentTools = new AgentTools(new AppClient(this.#app, this.#appOrigin, authorization, sessionClient))
        return { response: McpEndpoint.#resultResponse(rpcMessage.id, await agentTools.call(toolName, toolArguments)) }
      }
      default:
        return { response: McpEndpoint.#errorResponse(rpcMessage.id ?? null, -32601, `Method not found: ${rpcMessage.method}`) }
    }
  }

  #initialize(rpcMessage: JsonRpcRequest): { response: unknown; sessionId: string } {
    const requestedVersion = String(rpcMessage.params?.protocolVersion ?? '')
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : SUPPORTED_PROTOCOL_VERSIONS[0]
    const clientInfo = rpcMessage.params?.clientInfo as { name?: unknown } | undefined
    const agentClient = McpEndpoint.displayNameOf(typeof clientInfo?.name === 'string' ? clientInfo.name : '')
    const result = { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS }
    return { response: McpEndpoint.#resultResponse(rpcMessage.id, result), sessionId: SESSION_PREFIX + McpEndpoint.#base64Url(agentClient) }
  }

  /** People recognize "Claude Code", not "claude-code"; unknown clients keep their own name. */
  static displayNameOf(clientName: string): string {
    const knownClient = KNOWN_CLIENTS.find(([pattern]) => pattern.test(clientName))
    if (knownClient) return knownClient[1]
    const trimmedName = clientName.trim().slice(0, 40)
    return trimmedName.length > 0 ? trimmedName : 'MCP'
  }

  static #clientFromSession(sessionId: string | null): string {
    if (!sessionId?.startsWith(SESSION_PREFIX)) return 'MCP'
    try {
      return McpEndpoint.displayNameOf(McpEndpoint.#textOfBase64Url(sessionId.slice(SESSION_PREFIX.length)))
    } catch {
      return 'MCP'
    }
  }

  static #textOfBase64Url(encoded: string): string {
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
  }

  static #base64Url(text: string): string {
    let binary = ''
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  }

  static #unauthorized(): Response {
    const message = 'Send your Open Artifact personal API token as "Authorization: Bearer oa_pat_…". Create one under 设置 › Agent 接入.'
    return Response.json(McpEndpoint.#errorResponse(null, -32001, message), { status: 401 })
  }

  static #resultResponse(id: JsonRpcRequest['id'], result: unknown) {
    return { jsonrpc: '2.0', id, result }
  }

  static #errorResponse(id: JsonRpcRequest['id'], code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } }
  }
}
