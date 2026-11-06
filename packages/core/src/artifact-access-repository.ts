import type { ArtifactSharing } from './artifact-repository.ts'

export type GrantRole = 'viewer' | 'commenter' | 'editor'

export interface ArtifactGrant {
  artifactId: string
  userId: string
  role: GrantRole
}

/** Who may see an artifact: its sharing settings and the people granted a role on it. */
export interface ArtifactAccessRepository {
  updateSharing(artifactId: string, sharing: ArtifactSharing): Promise<void>
  listGrants(artifactId: string): Promise<ArtifactGrant[]>
  listGrantsOfUser(userId: string): Promise<ArtifactGrant[]>
  setGrant(grant: ArtifactGrant): Promise<void>
  removeGrant(artifactId: string, userId: string): Promise<void>
}
