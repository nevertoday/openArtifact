export const WORKSPACE_ROLES = ['admin', 'member'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/** How a role change or a removal ended; a workspace always keeps at least one admin. */
export type MembershipChange = 'changed' | 'last_admin' | 'not_member'

/** How joining a workspace ended; a person an admin removed stays out unless the join readmits them. */
export type JoinResult = { status: 'joined'; membership: Membership } | { status: 'already_member'; membership: Membership } | { status: 'removed' }

export interface Workspace {
  workspaceId: string
  name: string
  publicLinksEnabled: boolean
}

export interface Membership {
  workspace: Workspace
  role: WorkspaceRole
}

export interface UserProfile {
  userId: string
  name: string
  email: string
  image: string | null
}

export interface WorkspaceMember extends UserProfile {
  role: WorkspaceRole
}

export interface WorkspaceRepository {
  findWorkspace(workspaceId: string): Promise<Workspace | null>
  /** The workspaces the user belongs to now; ones an admin removed them from are left out. */
  membershipsOf(userId: string): Promise<Membership[]>
  /**
   * Puts a user who never belonged to a workspace into the instance's first workspace as a member, or
   * creates that workspace with them as its admin when the instance has none yet. Returns null for a
   * user an admin removed: they are not let back in.
   */
  joinFirstWorkspace(userId: string, newWorkspaceName: string): Promise<Membership | null>
  /** Adds the user as a member; `readmitsRemoved` brings back, as a member, a person an admin removed. */
  join(workspaceId: string, userId: string, joinedAt: number, readmission: { readmitsRemoved: boolean }): Promise<JoinResult>
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>
  rename(workspaceId: string, name: string): Promise<void>
  setPublicLinksEnabled(workspaceId: string, enabled: boolean): Promise<void>
  changeRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<MembershipChange>
  /** Ends the membership, revokes the person's API tokens for the workspace and drops their grants on its artifacts. */
  removeMember(workspaceId: string, userId: string, removedAt: number): Promise<MembershipChange>
}

export interface UserDirectory {
  hasAnyUser(): Promise<boolean>
  profilesOf(userIds: string[]): Promise<Map<string, UserProfile>>
  findByEmail(email: string): Promise<UserProfile | null>
}
