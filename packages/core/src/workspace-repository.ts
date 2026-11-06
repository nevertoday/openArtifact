export type WorkspaceRole = 'admin' | 'member'

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
  membershipsOf(userId: string): Promise<Membership[]>
  /**
   * Puts a user who belongs to no workspace into the instance's first workspace as a member, or creates
   * that workspace with them as its admin when the instance has none yet.
   */
  joinFirstWorkspace(userId: string, newWorkspaceName: string): Promise<Membership>
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>
  setPublicLinksEnabled(workspaceId: string, enabled: boolean): Promise<void>
}

export interface UserDirectory {
  hasAnyUser(): Promise<boolean>
  profilesOf(userIds: string[]): Promise<Map<string, UserProfile>>
  findByEmail(email: string): Promise<UserProfile | null>
}
