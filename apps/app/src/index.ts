import type { ArtifactFile } from '@open-artifact/core'
import { cloudflareRepositories } from '@open-artifact/storage-cloudflare'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AppRoutes } from './app-routes.ts'
import { purgePastRestoring } from './purge.ts'
import { mailUnmailedReportDigest } from './api/abuse-report-api.ts'
import { TitleTranslators } from './api/title-translator.ts'
import { Mailers } from './auth/mailer.ts'
import type { CardRenderer } from './share/card-renderer.ts'
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

// Loaded with the first card asked for, so no other request loads the drawing engines and their WebAssembly.
const cardRenderer: CardRenderer = {
  async render(drawing) {
    const { SatoriCardRenderer } = await import('./share/satori-card-renderer.ts')
    return new SatoriCardRenderer().render(drawing)
  },
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const appRoutes = new AppRoutes({
      env,
      repositories: cloudflareRepositories(env.DB, env.FILES),
      mailer: Mailers.fromEnv(env),
      titleTranslator: TitleTranslators.fromEnv(env),
      cardRenderer,
      mcpUrl: `${env.MCP_ORIGIN}/mcp`,
    })
    return appRoutes.respond(request)
  },

  // Daily: artifacts removed and workspaces deleted more than 30 days ago are deleted for good. A workspace goes
  // after its artifacts, whose files only the artifact purge knows how to delete. The operator also hears of the
  // abuse reports of the day that were stored without mail; a failure of either job does not stop the other.
  async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
    const repositories = cloudflareRepositories(env.DB, env.FILES)
    const now = Date.now()
    const jobs = await Promise.allSettled([purgePastRestoring(repositories, now), mailUnmailedReportDigest(repositories, env, now)])
    const failed = jobs.find(job => job.status === 'rejected')
    if (failed) throw failed.reason
  },
} satisfies ExportedHandler<AppEnv>
