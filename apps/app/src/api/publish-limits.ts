import type { ArtifactFile, ArtifactRepository, WorkspaceUsage } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'

/** How much one workspace may hold; the settings page shows the same numbers. */
export const WORKSPACE_LIMITS = {
  activeArtifacts: 1000,
  storedBytes: 1024 ** 3,
} as const

const FREE_SPACE_HINT = 'remove artifacts the workspace no longer needs on the web page (Remove, in an artifact\'s menu)'

/** Refuses a publish or a restore before anything is written when the workspace would go over its limits. */
export class PublishLimits {
  readonly #artifacts: ArtifactRepository

  constructor(artifacts: ArtifactRepository) {
    this.#artifacts = artifacts
  }

  static bytesOf(files: ArtifactFile[]): number {
    return files.reduce((total, file) => total + file.body.byteLength, 0)
  }

  /** A new version adds its files; a new artifact also takes one of the workspace's artifacts. */
  async ensureRoomToPublish(workspaceId: string, files: ArtifactFile[], publication: { newArtifact: boolean }): Promise<void> {
    const usage = await this.#artifacts.usageOf(workspaceId)
    if (publication.newArtifact) PublishLimits.#ensureArtifactRoom(usage, 'published')
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
    PublishLimits.#ensureArtifactRoom(await this.#artifacts.usageOf(workspaceId), 'restored')
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
