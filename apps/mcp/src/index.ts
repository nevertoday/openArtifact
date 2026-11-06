import type { McpEnv } from './env.ts'
import { McpEndpoint } from './mcp-endpoint.ts'

export default {
  async fetch(request: Request, env: McpEnv): Promise<Response> {
    return new McpEndpoint(env.APP, env.APP_ORIGIN).respond(request)
  },
} satisfies ExportedHandler<McpEnv>
