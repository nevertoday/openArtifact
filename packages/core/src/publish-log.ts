/** Who published when, so a cap on publishes per person can be checked and taken in one step. */
export interface PublishLog {
  /**
   * Records a publish when `publisherId` has published fewer than `quota.max` times after `quota.since` (epoch ms),
   * and returns the entry's id; null, and nothing recorded, when they have not. Concurrent calls cannot both take
   * the last place.
   */
  record(publisherId: string, publishedAt: number, quota: { max: number; since: number }): Promise<number | null>
  /** Gives the place back, for a publish that did not land. */
  release(entryId: number): Promise<void>
}
