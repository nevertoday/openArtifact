import type { Profile, ProfileChange, ProfileRepository } from '@open-artifact/core'

const PROFILE_COLUMNS = 'user_id, handle, bio, pinned_artifact_id'

interface ProfileRow {
  user_id: string
  handle: string
  bio: string
  pinned_artifact_id: string | null
}

export class CloudflareProfileRepository implements ProfileRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async findByHandle(handle: string): Promise<Profile | null> {
    const profileRow = await this.#db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE handle = ?`).bind(handle).first<ProfileRow>()
    return profileRow ? CloudflareProfileRepository.#profileOf(profileRow) : null
  }

  async findByUser(userId: string): Promise<Profile | null> {
    const profileRow = await this.#db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE user_id = ?`).bind(userId).first<ProfileRow>()
    return profileRow ? CloudflareProfileRepository.#profileOf(profileRow) : null
  }

  // The UNIQUE handle settles a race between two people claiming one: the loser moves on to the next candidate.
  async claim(userId: string, handleCandidates: string[]): Promise<Profile> {
    const existing = await this.findByUser(userId)
    const keepsHandle = existing !== null && handleCandidates.some(candidate => candidate.toLowerCase() === existing.handle.toLowerCase())
    if (existing && keepsHandle) return existing
    for (const candidate of handleCandidates) {
      const claimed = await this.#db
        .prepare(
          `INSERT INTO profiles (user_id, handle) VALUES (?, ?)
           ON CONFLICT (user_id) DO UPDATE SET handle = excluded.handle
           ON CONFLICT DO NOTHING
           RETURNING ${PROFILE_COLUMNS}`,
        )
        .bind(userId, candidate)
        .first<ProfileRow>()
        .catch(error => (CloudflareProfileRepository.#isHandleTaken(error) ? null : Promise.reject(error)))
      if (claimed) return CloudflareProfileRepository.#profileOf(claimed)
    }
    throw new Error(`no free handle for user ${userId} among ${handleCandidates.length} candidates`)
  }

  async update(userId: string, change: ProfileChange): Promise<Profile> {
    const profileRow = await this.#db
      .prepare(
        `UPDATE profiles SET bio = COALESCE(?, bio), pinned_artifact_id = CASE WHEN ? THEN ? ELSE pinned_artifact_id END
         WHERE user_id = ? RETURNING ${PROFILE_COLUMNS}`,
      )
      .bind(change.bio ?? null, change.pinnedArtifactId !== undefined ? 1 : 0, change.pinnedArtifactId ?? null, userId)
      .first<ProfileRow>()
    if (!profileRow) throw new Error(`user ${userId} has no profile to update`)
    return CloudflareProfileRepository.#profileOf(profileRow)
  }

  static #isHandleTaken(error: unknown): boolean {
    return error instanceof Error && error.message.includes('UNIQUE constraint failed: profiles.handle')
  }

  static #profileOf(profileRow: ProfileRow): Profile {
    return { userId: profileRow.user_id, handle: profileRow.handle, bio: profileRow.bio, pinnedArtifactId: profileRow.pinned_artifact_id }
  }
}
