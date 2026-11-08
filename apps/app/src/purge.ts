import { ArtifactRemoval, WorkspaceDeletion, type Repositories } from '@open-artifact/core'

// Each purged artifact costs several storage calls, and one Worker invocation has a cap on them; a large deleted
// workspace is purged over a few days' runs instead of failing the whole run.
const ARTIFACTS_PURGED_PER_RUN = 100

/** What the daily cron deletes for good: artifacts removed, and workspaces deleted, past their 30 days. */
export async function purgePastRestoring(repositories: Repositories, now: number): Promise<void> {
  await repositories.artifacts.purgeRemovedBefore(ArtifactRemoval.purgeCutoff(now), ARTIFACTS_PURGED_PER_RUN)
  await repositories.workspaces.purgeDeletedBefore(WorkspaceDeletion.purgeCutoff(now))
}
