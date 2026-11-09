/** Who published when, so a cap on publishes per person can be checked and taken in one step. */
export interface PublishLog {
  /**
   * Records a publish when `publisherId` has published fewer than `quota.max` times after `quota.since` (epoch ms);
   * false, and nothing recorded, when they have not. Concurrent calls cannot both take the last place.
   */
  record(publisherId: string, publishedAt: number, quota: { max: number; since: number }): Promise<boolean>
}
