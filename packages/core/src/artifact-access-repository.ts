import type { ArtifactSharing } from './artifact-repository.ts'

export type GrantRole = 'viewer' | 'commenter' | 'editor'

export interface ArtifactGrant {
  artifactId: string
  userId: string
  role: GrantRole
}

/** One person on an artifact's list of people, as the author saves the list. */
export type PersonGrant = Omit<ArtifactGrant, 'artifactId'>

/** A role kept for an address that has no account yet; it becomes a grant when someone signs up with that address. */
export interface PendingGrant {
  /** Lower-cased, as sign-up compares it. */
  email: string
  role: GrantRole
  grantedBy: string
  createdAt: number
}

/** Who may see an artifact: its sharing settings, the people granted a role on it, and the addresses waiting to sign up. */
export interface ArtifactAccessRepository {
  /** Replaces the sharing settings and the whole list of people, pending ones included, at once; either all of it is saved or none. */
  saveSharing(artifactId: string, sharing: ArtifactSharing, grants: PersonGrant[], pendingGrants: PendingGrant[]): Promise<void>
  listGrants(artifactId: string): Promise<ArtifactGrant[]>
  listGrantsOfUser(userId: string): Promise<ArtifactGrant[]>
  listPendingGrants(artifactId: string): Promise<PendingGrant[]>
  /** Turns every pending grant for `email` into a grant for `userId`; a grant the person already holds is kept, and running it again changes nothing. */
  claimPendingGrants(email: string, userId: string): Promise<void>
}
