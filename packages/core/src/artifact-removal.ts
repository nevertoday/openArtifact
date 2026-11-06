const DAY = 24 * 60 * 60 * 1000
const RESTORE_DAYS = 30

/** A removed artifact: hidden from everyone at once, restorable for 30 days, then purged. */
export class ArtifactRemoval {
  readonly removedAt: number
  readonly removedBy: string
  /** An admin took down someone else's artifact, so only an admin may restore it. */
  readonly removedAsAdmin: boolean

  constructor(removedAt: number, removedBy: string, removedAsAdmin: boolean) {
    this.removedAt = removedAt
    this.removedBy = removedBy
    this.removedAsAdmin = removedAsAdmin
  }

  static by(removerId: string, authorId: string, removedAt: number): ArtifactRemoval {
    return new ArtifactRemoval(removedAt, removerId, ArtifactRemoval.isTakedown(removerId, authorId))
  }

  /** Only the author or an admin may remove an artifact, so anyone else removing it acts as admin. */
  static isTakedown(removerId: string, authorId: string): boolean {
    return removerId !== authorId
  }

  /** Artifacts removed at or before this time are past restoring and get purged. */
  static purgeCutoff(now: number): number {
    return now - RESTORE_DAYS * DAY
  }

  get purgeAt(): number {
    return this.removedAt + RESTORE_DAYS * DAY
  }

  isPastRestoring(now: number): boolean {
    return now >= this.purgeAt
  }
}
