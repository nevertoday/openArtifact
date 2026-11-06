import type { JoinResult, Membership, MembershipChange, UserDirectory, UserProfile, Workspace, WorkspaceMember, WorkspaceRepository, WorkspaceRole } from '@open-artifact/core'

// Checked in the same statement that changes the membership, so two admins stepping down at once cannot both succeed.
const ANOTHER_ADMIN_REMAINS = `(memberships.role = 'member' OR EXISTS (
  SELECT 1 FROM memberships AS other_admin
  WHERE other_admin.workspace_id = memberships.workspace_id AND other_admin.user_id != memberships.user_id
    AND other_admin.role = 'admin' AND other_admin.removed_at IS NULL))`

interface MembershipRow {
  id: string
  name: string
  public_links_enabled: number
  role: WorkspaceRole
}

interface UserRow {
  id: string
  name: string
  email: string
  image: string | null
}

export class CloudflareWorkspaceRepository implements WorkspaceRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async findWorkspace(workspaceId: string): Promise<Workspace | null> {
    const workspaceRow = await this.#db
      .prepare('SELECT id, name, public_links_enabled FROM workspaces WHERE id = ?')
      .bind(workspaceId)
      .first<Omit<MembershipRow, 'role'>>()
    if (!workspaceRow) return null
    return { workspaceId: workspaceRow.id, name: workspaceRow.name, publicLinksEnabled: workspaceRow.public_links_enabled === 1 }
  }

  async membershipsOf(userId: string): Promise<Membership[]> {
    const { results: membershipRows } = await this.#db
      .prepare(
        `SELECT workspaces.id, workspaces.name, workspaces.public_links_enabled, memberships.role
         FROM memberships JOIN workspaces ON workspaces.id = memberships.workspace_id
         WHERE memberships.user_id = ? AND memberships.removed_at IS NULL ORDER BY memberships.created_at`,
      )
      .bind(userId)
      .all<MembershipRow>()
    return membershipRows.map(CloudflareWorkspaceRepository.#membershipOf)
  }

  // One batch, so two people signing in at once on a new instance cannot each create a workspace.
  async joinFirstWorkspace(userId: string, newWorkspaceName: string): Promise<Membership | null> {
    const now = Date.now()
    const firstWorkspaceId = '(SELECT id FROM workspaces ORDER BY created_at, id LIMIT 1)'
    const newWorkspaceId = crypto.randomUUID()
    await this.#db.batch([
      this.#db
        .prepare('INSERT INTO workspaces (id, name, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM workspaces)')
        .bind(newWorkspaceId, newWorkspaceName, now),
      this.#db
        .prepare(
          `INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at)
           SELECT ${firstWorkspaceId}, ?, CASE WHEN ${firstWorkspaceId} = ? THEN 'admin' ELSE 'member' END, ?
           WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)`,
        )
        .bind(userId, newWorkspaceId, now, userId),
    ])
    const [firstMembership] = await this.membershipsOf(userId)
    return firstMembership ?? null
  }

  // The readmission and the insert run in one batch, so the result says whether this call added the person.
  async join(workspaceId: string, userId: string, joinedAt: number, readmission: { readmitsRemoved: boolean }): Promise<JoinResult> {
    const [readmitted, inserted] = await this.#db.batch([
      this.#db
        .prepare(`UPDATE memberships SET removed_at = NULL, role = 'member', created_at = ? WHERE workspace_id = ? AND user_id = ? AND removed_at IS NOT NULL AND ? = 1`)
        .bind(joinedAt, workspaceId, userId, readmission.readmitsRemoved ? 1 : 0),
      this.#db.prepare(`INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`).bind(workspaceId, userId, joinedAt),
    ])
    const membership = (await this.membershipsOf(userId)).find(candidate => candidate.workspace.workspaceId === workspaceId)
    if (!membership) return { status: 'removed' }
    const addedHere = (readmitted?.meta.changes ?? 0) + (inserted?.meta.changes ?? 0) > 0
    return addedHere ? { status: 'joined', membership } : { status: 'already_member', membership }
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { results: memberRows } = await this.#db
      .prepare(
        `SELECT "user".id, "user".name, "user".email, "user".image, memberships.role
         FROM memberships JOIN "user" ON "user".id = memberships.user_id
         WHERE memberships.workspace_id = ? AND memberships.removed_at IS NULL ORDER BY "user".name`,
      )
      .bind(workspaceId)
      .all<UserRow & { role: WorkspaceRole }>()
    return memberRows.map(memberRow => ({ ...CloudflareUserDirectory.profileOf(memberRow), role: memberRow.role }))
  }

  async rename(workspaceId: string, name: string): Promise<void> {
    await this.#db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').bind(name, workspaceId).run()
  }

  async setPublicLinksEnabled(workspaceId: string, enabled: boolean): Promise<void> {
    await this.#db.prepare('UPDATE workspaces SET public_links_enabled = ? WHERE id = ?').bind(enabled ? 1 : 0, workspaceId).run()
  }

  async changeRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<MembershipChange> {
    const roleUpdate = await this.#db
      .prepare(
        `UPDATE memberships SET role = ?
         WHERE workspace_id = ? AND user_id = ? AND removed_at IS NULL AND (? = 'admin' OR ${ANOTHER_ADMIN_REMAINS})`,
      )
      .bind(role, workspaceId, userId, role)
      .run()
    return roleUpdate.meta.changes === 1 ? 'changed' : this.#refusalFor(workspaceId, userId)
  }

  // Tokens and grants follow only when this call ended the membership, all in one transaction.
  async removeMember(workspaceId: string, userId: string, removedAt: number): Promise<MembershipChange> {
    const removedHere = 'EXISTS (SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ? AND removed_at = ?)'
    const [membershipEnd] = await this.#db.batch([
      this.#db
        .prepare(`UPDATE memberships SET removed_at = ? WHERE workspace_id = ? AND user_id = ? AND removed_at IS NULL AND ${ANOTHER_ADMIN_REMAINS}`)
        .bind(removedAt, workspaceId, userId),
      this.#db
        .prepare(`UPDATE personal_access_tokens SET revoked_at = ? WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL AND ${removedHere}`)
        .bind(removedAt, userId, workspaceId, workspaceId, userId, removedAt),
      this.#db
        .prepare(`DELETE FROM artifact_grants WHERE user_id = ? AND artifact_id IN (SELECT id FROM artifacts WHERE workspace_id = ?) AND ${removedHere}`)
        .bind(userId, workspaceId, workspaceId, userId, removedAt),
    ])
    return membershipEnd?.meta.changes === 1 ? 'changed' : this.#refusalFor(workspaceId, userId)
  }

  async #refusalFor(workspaceId: string, userId: string): Promise<MembershipChange> {
    const isMember = await this.#db
      .prepare('SELECT 1 AS present FROM memberships WHERE workspace_id = ? AND user_id = ? AND removed_at IS NULL')
      .bind(workspaceId, userId)
      .first<number>('present')
    return isMember === null ? 'not_member' : 'last_admin'
  }

  static #membershipOf(membershipRow: MembershipRow): Membership {
    return {
      workspace: { workspaceId: membershipRow.id, name: membershipRow.name, publicLinksEnabled: membershipRow.public_links_enabled === 1 },
      role: membershipRow.role,
    }
  }
}

/** Reads the people Better Auth keeps in its `user` table. */
export class CloudflareUserDirectory implements UserDirectory {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async hasAnyUser(): Promise<boolean> {
    const anyUser = await this.#db.prepare('SELECT 1 AS present FROM "user" LIMIT 1').first<number>('present')
    return anyUser !== null
  }

  async profilesOf(userIds: string[]): Promise<Map<string, UserProfile>> {
    const distinctUserIds = [...new Set(userIds)]
    if (distinctUserIds.length === 0) return new Map()
    const placeholders = distinctUserIds.map(() => '?').join(', ')
    const { results: userRows } = await this.#db
      .prepare(`SELECT id, name, email, image FROM "user" WHERE id IN (${placeholders})`)
      .bind(...distinctUserIds)
      .all<UserRow>()
    return new Map(userRows.map(userRow => [userRow.id, CloudflareUserDirectory.profileOf(userRow)]))
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const userRow = await this.#db.prepare('SELECT id, name, email, image FROM "user" WHERE lower(email) = lower(?)').bind(email.trim()).first<UserRow>()
    return userRow ? CloudflareUserDirectory.profileOf(userRow) : null
  }

  static profileOf(userRow: UserRow): UserProfile {
    return { userId: userRow.id, name: userRow.name, email: userRow.email, image: userRow.image }
  }
}
