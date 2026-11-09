import { RESTORE_WINDOW } from './artifact-removal.ts'
import type { Locale } from './locale.ts'
export const WORKSPACE_ROLES = ['admin', 'member'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/**
 * How a role change, a removal or leaving ended. A workspace always keeps at least one admin, and a person always
 * keeps their personal workspace, as its admin.
 */
export type MembershipChange = 'changed' | 'last_admin' | 'not_member' | 'personal_workspace'

/**
 * How joining a workspace ended. A person who left comes back through any join; a person an admin removed stays out
 * unless the join readmits them.
 */
export type JoinResult = { status: 'joined'; membership: Membership } | { status: 'already_member'; membership: Membership } | { status: 'removed' }

export interface Workspace {
  workspaceId: string
  name: string
  publicLinksEnabled: boolean
  /** The person whose personal workspace this is; null for every other workspace. */
  personalOf: string | null
}

/** A workspace an admin deleted: gone for everyone at once, restorable by its admins until the purge. */
export interface DeletedWorkspace {
  workspace: Workspace
  deletedAt: number
}

/** A deleted workspace waits as long as a removed artifact before it is purged. */
export class WorkspaceDeletion {
  /** Workspaces deleted at or before this time are past restoring and get purged. */
  static purgeCutoff(now: number): number {
    return now - RESTORE_WINDOW
  }

  /** When the daily purge deletes the workspace with its artifacts for good. */
  static purgeAt(deletedAt: number): number {
    return deletedAt + RESTORE_WINDOW
  }
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
  /** The interface language the person chose; null until they choose one. */
  locale: Locale | null
}

export interface WorkspaceMember extends UserProfile {
  role: WorkspaceRole
}

/**
 * Every read leaves out deleted workspaces and memberships that ended, whether the person left or an admin
 * removed them, so access, tokens and pages all follow one answer.
 */
export interface WorkspaceRepository {
  findWorkspace(workspaceId: string): Promise<Workspace | null>
  /** The workspaces the user belongs to now, their personal workspace first, then in the order they joined. */
  membershipsOf(userId: string): Promise<Membership[]>
  /**
   * A new workspace with its creator as admin, when the creator has created fewer than `cap.max` workspaces that are
   * not yet purged, deleted ones included; null, and nothing created, when they have. Concurrent calls cannot both
   * take the last place.
   */
  create(name: string, creatorId: string, createdAt: number, cap: { max: number }): Promise<Membership | null>
  /**
   * The user's personal workspace, created with them as admin when they have none. Safe to call from any number of
   * requests at once: they all end with the same single workspace.
   */
  ensurePersonal(userId: string, name: string, now: number): Promise<Membership>
  /** Adds the user as a member; `readmitsRemoved` brings back, as a member, a person an admin removed. */
  join(workspaceId: string, userId: string, joinedAt: number, readmission: { readmitsRemoved: boolean }): Promise<JoinResult>
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>
  rename(workspaceId: string, name: string): Promise<void>
  setPublicLinksEnabled(workspaceId: string, enabled: boolean): Promise<void>
  changeRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<MembershipChange>
  /** Ends the membership, revokes the person's API tokens for the workspace and drops their grants on its artifacts. */
  removeMember(workspaceId: string, userId: string, removedAt: number): Promise<MembershipChange>
  /** Like removeMember, but any later invite brings the person back. */
  leave(workspaceId: string, userId: string, leftAt: number): Promise<MembershipChange>
  /** Returns false for a personal workspace, or one already deleted or missing. */
  delete(workspaceId: string, deletedAt: number): Promise<boolean>
  /** Brings back a workspace deleted after `cutoff` that `adminId` is an admin of; returns whether it did. */
  restore(workspaceId: string, adminId: string, cutoff: number): Promise<boolean>
  /** The workspaces deleted after `cutoff` that the user is an admin of, most recently deleted first. */
  listRestorable(adminId: string, cutoff: number): Promise<DeletedWorkspace[]>
  /**
   * Deletes the workspaces deleted at or before `cutoff` once their artifacts are purged, with their members,
   * invites, tokens and audit log. A workspace whose artifacts are still there waits for the next run.
   */
  purgeDeletedBefore(cutoff: number): Promise<void>
}

export interface UserDirectory {
  hasAnyUser(): Promise<boolean>
  profilesOf(userIds: string[]): Promise<Map<string, UserProfile>>
  findByEmail(email: string): Promise<UserProfile | null>
  setLocale(userId: string, locale: Locale): Promise<void>
}
