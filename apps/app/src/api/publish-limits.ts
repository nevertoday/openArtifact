import type { ArtifactFile, Repositories, WorkspaceUsage } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'

/** How much one workspace may hold; the settings page shows the same numbers. */
export const WORKSPACE_LIMITS = {
  activeArtifacts: 1000,
  storedBytes: 1024 ** 3,
} as const

/** Publishes (new artifacts and new versions) one person may make in any 24 hours, across every workspace and token. */
export const PUBLISHES_PER_PERSON_PER_DAY = 300

const DAY_MS = 24 * 60 * 60 * 1000

/** Who publishes what where, for the limits on publishing. */
export interface Publication {
  publisherId: string
  workspaceId: string
  files: ArtifactFile[]
  newArtifact: boolean
}

const FREE_SPACE_HINT = 'remove artifacts the workspace no longer needs on the web page (Remove, in an artifact\'s menu)'

/** Refuses a publish or a restore before anything is written when it would go over a limit. */
export class PublishLimits {
  readonly #repositories: Repositories

  constructor(repositories: Repositories) {
    this.#repositories = repositories
  }

  static bytesOf(files: ArtifactFile[]): number {
    return files.reduce((total, file) => total + file.body.byteLength, 0)
  }

  /**
   * Runs `publish` once the workspace has room and the publisher has a publish left today. A new version adds its
   * files; a new artifact also takes one of the workspace's artifacts. Either takes one of the publisher's daily
   * publishes, only once the workspace has room, and gives it back when the publish does not land: when it throws, or
   * when `landed` says its outcome is not a publish, such as a version conflict.
   */
  async publishWithin<Outcome>(publication: Publication, publish: () => Promise<Outcome>, landed: (outcome: Outcome) => boolean = () => true): Promise<Outcome> {
    await this.#ensureWorkspaceRoom(publication)
    const now = Date.now()
    const entryId = await this.#repositories.publishLog.record(publication.publisherId, now, { max: PUBLISHES_PER_PERSON_PER_DAY, since: now - DAY_MS })
    if (entryId === null) {
      const message =
        `you have published ${PUBLISHES_PER_PERSON_PER_DAY} times in the last 24 hours, the most one person may, counting every workspace and token; ` +
        'nothing was published. Try again later; each publish counts for 24 hours'
      throw new HttpError(429, 'publish_limit_reached', message)
    }
    try {
      const outcome = await publish()
      if (!landed(outcome)) await this.#repositories.publishLog.release(entryId)
      return outcome
    } catch (error) {
      await this.#repositories.publishLog.release(entryId)
      throw error
    }
  }

  async #ensureWorkspaceRoom({ workspaceId, files, newArtifact }: Publication): Promise<void> {
    const usage = await this.#repositories.artifacts.usageOf(workspaceId)
    if (newArtifact) PublishLimits.#ensureArtifactRoom(usage, 'published')
    const addedBytes = PublishLimits.bytesOf(files)
    if (usage.storedBytes + addedBytes <= WORKSPACE_LIMITS.storedBytes) return
    const message =
      `this workspace stores ${PublishLimits.#size(usage.storedBytes)} of the ${PublishLimits.#size(WORKSPACE_LIMITS.storedBytes)} it may store, ` +
      `and these files add ${PublishLimits.#size(addedBytes)}; nothing was published. Every version's files count, and a removed artifact's ` +
      `files count until it is purged 30 days after removal. To make room, ${FREE_SPACE_HINT}, or publish smaller files`
    throw new HttpError(413, 'workspace_quota_reached', message)
  }

  // Its files never stopped counting, so only the number of artifacts can go over.
  async ensureRoomToRestore(workspaceId: string): Promise<void> {
    PublishLimits.#ensureArtifactRoom(await this.#repositories.artifacts.usageOf(workspaceId), 'restored')
  }

  static #ensureArtifactRoom(usage: WorkspaceUsage, outcome: 'published' | 'restored'): void {
    if (usage.activeArtifacts < WORKSPACE_LIMITS.activeArtifacts) return
    const message =
      `this workspace already has ${usage.activeArtifacts} artifacts, its limit of ${WORKSPACE_LIMITS.activeArtifacts}; nothing was ${outcome}. ` +
      `To make room, ${FREE_SPACE_HINT}` +
      '; a removed artifact stops counting at once. Or publish a new version of an existing artifact instead'
    throw new HttpError(403, 'workspace_quota_reached', message)
  }

  static #size(bytes: number): string {
    const mebibytes = bytes / 1024 ** 2
    return mebibytes >= 1024 ? `${(mebibytes / 1024).toFixed(2)} GiB` : `${mebibytes.toFixed(1)} MiB`
  }
}
