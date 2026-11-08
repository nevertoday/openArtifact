import { ArtifactAccess, ProfileHandle, type ArtifactSummary, type Profile, type Repositories } from '@open-artifact/core'
import { People } from './people.ts'
import { ShareCard } from './share/share-card.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const REVISION_SHOWN_DAYS = 7

/**
 * Each person's public page at /@handle: who they are, a line about themselves and the artifacts they listed
 * there that anyone may open. The handle follows the person's name and is made the first time it is needed.
 */
export class PersonalPages {
  readonly #repositories: Repositories
  readonly #appOrigin: string

  constructor(repositories: Repositories, appOrigin: string) {
    this.#repositories = repositories
    this.#appOrigin = appOrigin
  }

  /** The person's profile, made with a handle from their name when they have none yet. */
  async claim(userId: string): Promise<Profile> {
    const userProfile = (await this.#repositories.users.profilesOf([userId])).get(userId)
    if (!userProfile) throw new Error(`user ${userId} has no account to make a personal page for`)
    return this.#repositories.profiles.claim(userId, ProfileHandle.candidatesFor(People.displayName(userProfile)))
  }

  /** After a rename the page moves to an address made from the new name; a person without a page gets none. */
  async followRename(userId: string): Promise<void> {
    if (await this.#repositories.profiles.findByUser(userId)) await this.claim(userId)
  }

  findByHandle(handle: string): Promise<Profile | null> {
    return this.#repositories.profiles.findByHandle(handle)
  }

  /** What the page lists now, most recently updated first; an artifact that stopped being public drops out by itself. */
  async entriesOf(userId: string, now: number): Promise<ArtifactSummary[]> {
    const listedSummaries = await this.#repositories.artifacts.listListedBy(userId)
    const workspaceIds = [...new Set(listedSummaries.map(summary => summary.workspaceId))]
    const workspaces = await Promise.all(workspaceIds.map(workspaceId => this.#repositories.workspaces.findWorkspace(workspaceId)))
    const publicLinksAllowed = new Map(workspaces.flatMap(workspace => (workspace ? [[workspace.workspaceId, workspace.publicLinksEnabled] as const] : [])))
    return listedSummaries.filter(summary => new ArtifactAccess(summary, publicLinksAllowed.get(summary.workspaceId) ?? false, now).onPersonalPage)
  }

  /** How an entry goes out on X; being listed already proved its workspace allows public links. */
  shareCardOf(entry: ArtifactSummary, now: number): ShareCard {
    return ShareCard.of(entry, new ArtifactAccess(entry, true, now).shareReadiness, this.#appOrigin)
  }

  url(handle: string): string {
    return `${this.#appOrigin}${PersonalPages.path(handle)}`
  }

  static path(handle: string): string {
    return `/@${encodeURIComponent(handle)}`
  }

  /**
   * Marked 刚更新 for a week after a new version whose publisher said what changed; a version without a note,
   * such as a typo fix, does not bring readers back.
   */
  static recentlyRevised(summary: ArtifactSummary, now: number): boolean {
    const revisedWithNote = summary.version > 1 && summary.currentVersionNote !== null
    return revisedWithNote && now - summary.currentVersionAt < REVISION_SHOWN_DAYS * DAY_MS
  }
}
