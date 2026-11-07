/** A person's public page at /@handle: the artifacts they list there, a line about themselves and one pinned artifact. */
export interface Profile {
  userId: string
  /** Unique, compared without regard to case; follows the person's name. */
  handle: string
  bio: string
  /** null when nothing is pinned. */
  pinnedArtifactId: string | null
}

export interface ProfileChange {
  bio?: string
  pinnedArtifactId?: string | null
}

export interface ProfileRepository {
  findByHandle(handle: string): Promise<Profile | null>
  findByUser(userId: string): Promise<Profile | null>
  /**
   * The person's profile, created with the first free handle among `handleCandidates` when they have none yet;
   * an existing profile with a handle not among the candidates moves to the first free one, so a renamed
   * person's page follows the new name.
   */
  claim(userId: string, handleCandidates: string[]): Promise<Profile>
  update(userId: string, change: ProfileChange): Promise<Profile>
}
