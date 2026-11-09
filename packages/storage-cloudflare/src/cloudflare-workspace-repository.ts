import {
  parseLocale,
  type DeletedWorkspace,
  type JoinResult,
  type Locale,
  type Membership,
  type MembershipChange,
  type UserDirectory,
  type UserProfile,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRepository,
  type WorkspaceRole,
} from '@open-artifact/core'

// The one definition of a membership that has not ended, by leaving or by removal.
const ACTIVE = 'memberships.left_at IS NULL AND memberships.removed_at IS NULL'
const LIVE_WORKSPACE = 'workspaces.deleted_at IS NULL'

// Checked in the same statement that changes the membership, so two admins stepping down at once cannot both succeed.
const ANOTHER_ADMIN_REMAINS = `(memberships.role = 'member' OR EXISTS (
  SELECT 1 FROM memberships AS other_admin
  WHERE other_admin.workspace_id = memberships.workspace_id AND other_admin.user_id != memberships.user_id
    AND other_admin.role = 'admin' AND other_admin.removed_at IS NULL AND other_admin.left_at IS NULL))`

// A person stays admin of their personal workspace for good, so they always have one workspace to land in.
const NOT_PERSONAL_OWNER = 'NOT EXISTS (SELECT 1 FROM workspaces AS owned WHERE owned.id = memberships.workspace_id AND owned.personal_of = memberships.user_id)'

const WORKSPACE_COLUMNS = 'workspaces.id, workspaces.name, workspaces.public_links_enabled, workspaces.personal_of'

interface WorkspaceRow {
  id: string
  name: string
  public_links_enabled: number
  personal_of: string | null
}

interface MembershipRow extends WorkspaceRow {
  role: WorkspaceRole
}

interface UserRow {
  id: string
  name: string
  email: string
  image: string | null
  locale: string | null
}

export class CloudflareWorkspaceRepository implements WorkspaceRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async findWorkspace(workspaceId: string): Promise<Workspace | null> {
    const workspaceRow = await this.#db.prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ? AND ${LIVE_WORKSPACE}`).bind(workspaceId).first<WorkspaceRow>()
    return workspaceRow ? CloudflareWorkspaceRepository.#workspaceOf(workspaceRow) : null
  }

  async membershipsOf(userId: string): Promise<Membership[]> {
    const { results: membershipRows } = await this.#db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS}, memberships.role
         FROM memberships JOIN workspaces ON workspaces.id = memberships.workspace_id
         WHERE memberships.user_id = ? AND ${ACTIVE} AND ${LIVE_WORKSPACE}
         ORDER BY workspaces.personal_of IS NOT memberships.user_id, memberships.created_at, workspaces.id`,
      )
      .bind(userId)
      .all<MembershipRow>()
    return membershipRows.map(CloudflareWorkspaceRepository.#membershipOf)
  }

  // The count and the insert are one statement, and the membership follows only a workspace that was inserted.
  async create(name: string, creatorId: string, createdAt: number, cap: { max: number }): Promise<Membership | null> {
    const workspaceId = crypto.randomUUID()
    const [inserted] = await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO workspaces (id, name, created_by, created_at)
           SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM workspaces WHERE created_by = ?3) < ?5`,
        )
        .bind(workspaceId, name, creatorId, createdAt, cap.max),
      this.#db.prepare(`INSERT INTO memberships (workspace_id, user_id, role, created_at) SELECT id, ?2, 'admin', ?3 FROM workspaces WHERE id = ?1`).bind(workspaceId, creatorId, createdAt),
    ])
    if ((inserted?.meta.changes ?? 0) === 0) return null
    return { workspace: { workspaceId, name, publicLinksEnabled: true, personalOf: null }, role: 'admin' }
  }

  // The unique index on personal_of turns every racing insert after the first into a no-op, and the membership
  // insert names the workspace that won, so concurrent first requests all converge on one workspace.
  async ensurePersonal(userId: string, name: string, now: number): Promise<Membership> {
    await this.#db.batch([
      this.#db.prepare('INSERT OR IGNORE INTO workspaces (id, name, personal_of, created_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), name, userId, now),
      this.#db
        .prepare(`INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at) SELECT id, ?, 'admin', ? FROM workspaces WHERE personal_of = ?`)
        .bind(userId, now, userId),
    ])
    const personal = (await this.membershipsOf(userId)).find(membership => membership.workspace.personalOf === userId)
    if (!personal) throw new Error(`user ${userId} has a personal workspace they do not belong to`)
    return personal
  }

  // The readmissions and the insert run in one batch, so the result says whether this call added the person.
  async join(workspaceId: string, userId: string, joinedAt: number, readmission: { readmitsRemoved: boolean }): Promise<JoinResult> {
    const [returned, readmitted, inserted] = await this.#db.batch([
      this.#db
        .prepare(`UPDATE memberships SET left_at = NULL, role = 'member', created_at = ? WHERE workspace_id = ? AND user_id = ? AND left_at IS NOT NULL AND removed_at IS NULL`)
        .bind(joinedAt, workspaceId, userId),
      this.#db
        .prepare(`UPDATE memberships SET removed_at = NULL, left_at = NULL, role = 'member', created_at = ? WHERE workspace_id = ? AND user_id = ? AND removed_at IS NOT NULL AND ? = 1`)
        .bind(joinedAt, workspaceId, userId, readmission.readmitsRemoved ? 1 : 0),
      this.#db.prepare(`INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`).bind(workspaceId, userId, joinedAt),
    ])
    const membership = (await this.membershipsOf(userId)).find(candidate => candidate.workspace.workspaceId === workspaceId)
    if (!membership) return { status: 'removed' }
    const addedHere = [returned, readmitted, inserted].some(result => (result?.meta.changes ?? 0) > 0)
    return addedHere ? { status: 'joined', membership } : { status: 'already_member', membership }
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { results: memberRows } = await this.#db
      .prepare(
        `SELECT "user".id, "user".name, "user".email, "user".image, "user".locale, memberships.role
         FROM memberships JOIN "user" ON "user".id = memberships.user_id
         WHERE memberships.workspace_id = ? AND ${ACTIVE} ORDER BY "user".name`,
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
         WHERE workspace_id = ? AND user_id = ? AND ${ACTIVE} AND (? = 'admin' OR (${ANOTHER_ADMIN_REMAINS} AND ${NOT_PERSONAL_OWNER}))`,
      )
      .bind(role, workspaceId, userId, role)
      .run()
    return roleUpdate.meta.changes === 1 ? 'changed' : this.#refusalFor(workspaceId, userId)
  }

  removeMember(workspaceId: string, userId: string, removedAt: number): Promise<MembershipChange> {
    return this.#endMembership(workspaceId, userId, 'removed_at', removedAt)
  }

  leave(workspaceId: string, userId: string, leftAt: number): Promise<MembershipChange> {
    return this.#endMembership(workspaceId, userId, 'left_at', leftAt)
  }

  // Tokens and grants follow only when this call ended the membership, all in one transaction.
  async #endMembership(workspaceId: string, userId: string, endColumn: 'removed_at' | 'left_at', endedAt: number): Promise<MembershipChange> {
    const endedHere = `EXISTS (SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ? AND ${endColumn} = ?)`
    const [membershipEnd] = await this.#db.batch([
      this.#db
        .prepare(`UPDATE memberships SET ${endColumn} = ? WHERE workspace_id = ? AND user_id = ? AND ${ACTIVE} AND ${ANOTHER_ADMIN_REMAINS} AND ${NOT_PERSONAL_OWNER}`)
        .bind(endedAt, workspaceId, userId),
      this.#db
        .prepare(`UPDATE personal_access_tokens SET revoked_at = ? WHERE user_id = ? AND workspace_id = ? AND revoked_at IS NULL AND ${endedHere}`)
        .bind(endedAt, userId, workspaceId, workspaceId, userId, endedAt),
      this.#db
        .prepare(`DELETE FROM artifact_grants WHERE user_id = ? AND artifact_id IN (SELECT id FROM artifacts WHERE workspace_id = ?) AND ${endedHere}`)
        .bind(userId, workspaceId, workspaceId, userId, endedAt),
    ])
    return membershipEnd?.meta.changes === 1 ? 'changed' : this.#refusalFor(workspaceId, userId)
  }

  async #refusalFor(workspaceId: string, userId: string): Promise<MembershipChange> {
    const membershipRow = await this.#db
      .prepare(
        `SELECT workspaces.personal_of FROM memberships JOIN workspaces ON workspaces.id = memberships.workspace_id
         WHERE memberships.workspace_id = ? AND memberships.user_id = ? AND ${ACTIVE}`,
      )
      .bind(workspaceId, userId)
      .first<Pick<WorkspaceRow, 'personal_of'>>()
    if (membershipRow === null) return 'not_member'
    return membershipRow.personal_of === userId ? 'personal_workspace' : 'last_admin'
  }

  async delete(workspaceId: string, deletedAt: number): Promise<boolean> {
    const deletion = await this.#db
      .prepare('UPDATE workspaces SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND personal_of IS NULL')
      .bind(deletedAt, workspaceId)
      .run()
    return deletion.meta.changes === 1
  }

  async restore(workspaceId: string, adminId: string, cutoff: number): Promise<boolean> {
    const restoration = await this.#db
      .prepare(
        `UPDATE workspaces SET deleted_at = NULL WHERE id = ? AND deleted_at > ?
           AND EXISTS (SELECT 1 FROM memberships WHERE memberships.workspace_id = workspaces.id AND memberships.user_id = ? AND memberships.role = 'admin' AND ${ACTIVE})`,
      )
      .bind(workspaceId, cutoff, adminId)
      .run()
    return restoration.meta.changes === 1
  }

  async listRestorable(adminId: string, cutoff: number): Promise<DeletedWorkspace[]> {
    const { results: deletedRows } = await this.#db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS}, workspaces.deleted_at
         FROM memberships JOIN workspaces ON workspaces.id = memberships.workspace_id
         WHERE memberships.user_id = ? AND memberships.role = 'admin' AND ${ACTIVE} AND workspaces.deleted_at > ?
         ORDER BY workspaces.deleted_at DESC`,
      )
      .bind(adminId, cutoff)
      .all<WorkspaceRow & { deleted_at: number }>()
    return deletedRows.map(deletedRow => ({ workspace: CloudflareWorkspaceRepository.#workspaceOf(deletedRow), deletedAt: deletedRow.deleted_at }))
  }

  // Deleting the row cascades to memberships, invites, tokens and the audit log; artifacts are purged first, with their files.
  async purgeDeletedBefore(cutoff: number): Promise<void> {
    await this.#db
      .prepare('DELETE FROM workspaces WHERE deleted_at <= ? AND NOT EXISTS (SELECT 1 FROM artifacts WHERE artifacts.workspace_id = workspaces.id)')
      .bind(cutoff)
      .run()
  }

  static #workspaceOf(workspaceRow: WorkspaceRow): Workspace {
    return { workspaceId: workspaceRow.id, name: workspaceRow.name, publicLinksEnabled: workspaceRow.public_links_enabled === 1, personalOf: workspaceRow.personal_of }
  }

  static #membershipOf(membershipRow: MembershipRow): Membership {
    return { workspace: CloudflareWorkspaceRepository.#workspaceOf(membershipRow), role: membershipRow.role }
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
      .prepare(`SELECT id, name, email, image, locale FROM "user" WHERE id IN (${placeholders})`)
      .bind(...distinctUserIds)
      .all<UserRow>()
    return new Map(userRows.map(userRow => [userRow.id, CloudflareUserDirectory.profileOf(userRow)]))
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const userRow = await this.#db.prepare('SELECT id, name, email, image, locale FROM "user" WHERE lower(email) = lower(?)').bind(email.trim()).first<UserRow>()
    return userRow ? CloudflareUserDirectory.profileOf(userRow) : null
  }

  async setLocale(userId: string, locale: Locale): Promise<void> {
    await this.#db.prepare('UPDATE "user" SET locale = ? WHERE id = ?').bind(locale, userId).run()
  }

  static profileOf(userRow: UserRow): UserProfile {
    return { userId: userRow.id, name: userRow.name, email: userRow.email, image: userRow.image, locale: parseLocale(userRow.locale) }
  }
}
