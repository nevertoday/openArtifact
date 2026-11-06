import { describe, expect, it } from 'vitest'
import { McpEndpoint } from '../src/mcp-endpoint.ts'

interface RecordedCall {
  method: string
  url: string
  authorization: string | null
  agentClient: string | null
  body: unknown
}

/** Stands in for the app Worker: records each call and answers from a script. */
class FakeApp {
  readonly calls: RecordedCall[] = []
  readonly #answers: Response[]

  constructor(...answers: Response[]) {
    this.#answers = answers
  }

  async fetch(request: Request): Promise<Response> {
    const bodyText = await request.text()
    this.calls.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get('Authorization'),
      agentClient: request.headers.get('X-Open-Artifact-Client'),
      body: bodyText ? JSON.parse(bodyText) : undefined,
    })
    return this.#answers.shift() ?? Response.json({ error: 'no scripted answer' }, { status: 500 })
  }
}

const TOKEN = 'Bearer oa_pat_test-token'

function mcpEndpoint(fakeApp: FakeApp): McpEndpoint {
  return new McpEndpoint(fakeApp as unknown as Fetcher, 'http://app.test')
}

async function rpc(endpoint: McpEndpoint, message: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return endpoint.respond(new Request('http://mcp.test/mcp', { method: 'POST', headers: { Authorization: TOKEN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(message) }))
}

async function callTool(endpoint: McpEndpoint, name: string, toolArguments: Record<string, unknown>, sessionId = '') {
  const response = await rpc(endpoint, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: toolArguments } }, sessionId ? { 'Mcp-Session-Id': sessionId } : {})
  return ((await response.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result
}

describe('McpEndpoint', () => {
  it('asks for a personal API token before anything else', async () => {
    const endpoint = mcpEndpoint(new FakeApp())

    const response = await endpoint.respond(new Request('http://mcp.test/mcp', { method: 'POST', body: '{}' }))

    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).toContain('Agent 接入')
  })

  it('completes the handshake and remembers which agent connected', async () => {
    const fakeApp = new FakeApp(Response.json({ artifacts: [] }))
    const endpoint = mcpEndpoint(fakeApp)

    const initialize = await rpc(endpoint, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'claude-code', version: '2.1' } } })
    const sessionId = initialize.headers.get('Mcp-Session-Id') ?? ''
    const initialized = await rpc(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'Mcp-Session-Id': sessionId })
    await callTool(endpoint, 'list', {}, sessionId)

    expect(await initialize.json()).toMatchObject({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'open-artifact' }, capabilities: { tools: {} } } })
    expect(initialized.status).toBe(202)
    expect(fakeApp.calls[0]).toMatchObject({ method: 'GET', url: 'http://app.test/api/artifacts', authorization: TOKEN, agentClient: 'Claude Code' })
  })

  it('offers its newest protocol version to a client asking for an unknown one', async () => {
    const response = await rpc(mcpEndpoint(new FakeApp()), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })

    expect(((await response.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-06-18')
  })

  it('lists the seven tools with input schemas', async () => {
    const response = await rpc(mcpEndpoint(new FakeApp()), { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const { result } = (await response.json()) as { result: { tools: { name: string; inputSchema: { type: string } }[] } }

    expect(result.tools.map(tool => tool.name)).toEqual(['publish', 'update', 'read', 'list', 'list_comments', 'reply_comment', 'get_guide'])
    expect(result.tools.every(tool => tool.inputSchema.type === 'object')).toBe(true)
  })

  it('publishes through the app and hands back the link', async () => {
    const fakeApp = new FakeApp(Response.json({ artifactId: 'a1', version: 1, url: 'http://app.test/a/a1' }, { status: 201 }))

    const result = await callTool(mcpEndpoint(fakeApp), 'publish', { title: 'Plan', files: [{ path: 'index.html', content: '<h1>Plan</h1>' }] })

    expect(fakeApp.calls[0]).toMatchObject({ method: 'POST', url: 'http://app.test/api/artifacts', body: { title: 'Plan', files: [{ path: 'index.html', content: '<h1>Plan</h1>' }] } })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('http://app.test/a/a1')
  })

  it('passes the note that says what this version changed', async () => {
    const fakeApp = new FakeApp(Response.json({ artifactId: 'a1', version: 2, url: 'http://app.test/a/a1' }), Response.json({ artifactId: 'a2', version: 1, url: 'http://app.test/a/a2' }, { status: 201 }))
    const endpoint = mcpEndpoint(fakeApp)
    const files = [{ path: 'index.html', content: '<h1>Plan</h1>' }]

    await callTool(endpoint, 'update', { artifactId: 'a1', baseVersion: 1, files, note: '按评论补上第 3 节的连线' })
    await callTool(endpoint, 'publish', { title: 'Plan', files, note: '第一版' })
    const toolList = await rpc(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const { result } = (await toolList.json()) as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } }

    expect(fakeApp.calls.map(call => (call.body as { note?: string }).note)).toEqual(['按评论补上第 3 节的连线', '第一版'])
    expect(result.tools.filter(tool => 'note' in tool.inputSchema.properties).map(tool => tool.name)).toEqual(['publish', 'update'])
  })

  it('passes the public link expiry the person chose, and leaves it out otherwise', async () => {
    const created = () => Response.json({ artifactId: 'a1', version: 1, url: 'http://app.test/a/a1' }, { status: 201 })
    const fakeApp = new FakeApp(created(), created())
    const endpoint = mcpEndpoint(fakeApp)
    const files = [{ path: 'index.html', content: '<h1>Plan</h1>' }]

    await callTool(endpoint, 'publish', { title: 'Plan', files, visibility: 'public_link', publicLinkExpiresAt: null })
    await callTool(endpoint, 'publish', { title: 'Plan', files, visibility: 'public_link' })

    expect(fakeApp.calls.map(call => 'publicLinkExpiresAt' in (call.body as object))).toEqual([true, false])
  })

  it('renames the artifact along with the new version when update carries a title', async () => {
    const fakeApp = new FakeApp(Response.json({ artifactId: 'a1', version: 4, url: 'http://app.test/a/a1' }))

    const result = await callTool(mcpEndpoint(fakeApp), 'update', { artifactId: 'a1', baseVersion: 3, title: 'Q3 plan', files: [{ path: 'index.html', content: 'v4' }] })

    expect(fakeApp.calls[0]).toMatchObject({ method: 'PUT', url: 'http://app.test/api/artifacts/a1', body: { baseVersion: 3, title: 'Q3 plan' } })
    expect(result.isError).toBeUndefined()
  })

  it('turns a version conflict into merge instructions rather than a failure', async () => {
    const fakeApp = new FakeApp(Response.json({ error: 'conflict', currentVersion: 4, latestFiles: [{ path: 'index.html', content: 'latest' }] }, { status: 409 }))

    const result = await callTool(mcpEndpoint(fakeApp), 'update', { artifactId: 'a1', baseVersion: 3, files: [{ path: 'index.html', content: 'mine' }] })

    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('baseVersion = currentVersion')
    expect(result.content[0]?.text).toContain('"currentVersion": 4')
  })

  it('replies to a comment and resolves it in two calls', async () => {
    const fakeApp = new FakeApp(Response.json({ comment: {} }, { status: 201 }), Response.json({ resolved: true }))

    const result = await callTool(mcpEndpoint(fakeApp), 'reply_comment', { artifactId: 'a1', commentId: 'c9', body: '已在 v4 修改' })

    expect(fakeApp.calls.map(call => [call.method, call.url])).toEqual([
      ['POST', 'http://app.test/api/artifacts/a1/comments'],
      ['PATCH', 'http://app.test/api/comments/c9'],
    ])
    expect(fakeApp.calls[0]?.body).toEqual({ body: '已在 v4 修改', parentId: 'c9' })
    expect(result.content[0]?.text).toBe('Replied and marked the comment resolved.')
  })

  it('reports an app refusal as a tool error and keeps ids inside one path segment', async () => {
    const fakeApp = new FakeApp(Response.json({ error: 'artifact x not found' }, { status: 404 }))

    const result = await callTool(mcpEndpoint(fakeApp), 'read', { artifactId: '../tokens' })

    expect(fakeApp.calls[0]?.url).toBe('http://app.test/api/artifacts/..%2Ftokens')
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('404')
  })

  it('answers unknown methods and non-POST requests the MCP way', async () => {
    const endpoint = mcpEndpoint(new FakeApp())

    const unknownMethod = await rpc(endpoint, { jsonrpc: '2.0', id: 3, method: 'resources/list' })
    const streamRequest = await endpoint.respond(new Request('http://mcp.test/mcp', { headers: { Authorization: TOKEN } }))

    expect(await unknownMethod.json()).toMatchObject({ id: 3, error: { code: -32601 } })
    expect(streamRequest.status).toBe(405)
  })

  it('names known agent clients the way people recognize them', () => {
    expect(['claude-code', 'codex-mcp-client', 'cursor-vscode', 'gemini-cli-mcp-client', 'my-own-bot', ''].map(McpEndpoint.displayNameOf)).toEqual([
      'Claude Code',
      'Codex',
      'Cursor',
      'Gemini CLI',
      'my-own-bot',
      'MCP',
    ])
  })
})
