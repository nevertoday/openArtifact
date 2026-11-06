import type { ArtifactSharing } from './artifact-repository.ts'

export type GrantRole = 'viewer' | 'commenter' | 'editor'

export interface ArtifactGrant {
  artifactId: string
  userId: string
  role: GrantRole
}

/** One person on an artifact's list of people, as the author saves the list. */
export type PersonGrant = Omit<ArtifactGrant, 'artifactId'>

/** Who may see an artifact: its sharing settings and the people granted a role on it. */
export interface ArtifactAccessRepository {
  /** Replaces the sharing settings and the whole list of people at once; either all of it is saved or none. */
  saveSharing(artifactId: string, sharing: ArtifactSharing, grants: PersonGrant[]): Promise<void>
  listGrants(artifactId: string): Promise<ArtifactGrant[]>
  listGrantsOfUser(userId: string): Promise<ArtifactGrant[]>
}
