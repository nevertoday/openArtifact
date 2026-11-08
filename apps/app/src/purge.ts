import { ArtifactRemoval, WorkspaceDeletion, type Repositories } from '@open-artifact/core'

/** What the daily cron deletes for good: artifacts removed, and workspaces deleted, past their 30 days. */
export async function purgePastRestoring(repositories: Repositories, now: number): Promise<void> {
  await repositories.artifacts.purgeRemovedBefore(ArtifactRemoval.purgeCutoff(now))
  await repositories.workspaces.purgeDeletedBefore(WorkspaceDeletion.purgeCutoff(now))
}
