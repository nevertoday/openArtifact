import { ArtifactRemoval, type ArtifactFile } from '@open-artifact/core'
import { cloudflareRepositories } from '@open-artifact/storage-cloudflare'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AppRoutes } from './app-routes.ts'
import { Mailers } from './auth/mailer.ts'
import type { AppEnv } from './env.ts'

/**
 * The usercontent Worker reads artifact files through this RPC entrypoint, reachable only over a service
 * binding, so the Worker that serves untrusted pages holds no database or bucket access of its own.
 */
export class ArtifactFileReader extends WorkerEntrypoint<AppEnv> {
  async readVersionFile(artifactId: string, version: number, path: string): Promise<ArtifactFile | null> {
    return cloudflareRepositories(this.env.DB, this.env.FILES).artifacts.readVersionFile(artifactId, version, path)
  }
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const appRoutes = new AppRoutes({
      env,
      repositories: cloudflareRepositories(env.DB, env.FILES),
      mailer: Mailers.fromSetting(env.MAILER),
      mcpUrl: `${env.MCP_ORIGIN}/mcp`,
    })
    return appRoutes.respond(request)
  },

  // Daily: artifacts removed more than 30 days ago are deleted for good.
  async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
    await cloudflareRepositories(env.DB, env.FILES).artifacts.purgeRemovedBefore(ArtifactRemoval.purgeCutoff(Date.now()))
  },
} satisfies ExportedHandler<AppEnv>
