import type { Membership, UserDirectory, UserProfile, Workspace, WorkspaceMember, WorkspaceRepository, WorkspaceRole } from '@open-artifact/core'

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
         WHERE memberships.user_id = ? ORDER BY memberships.created_at`,
      )
      .bind(userId)
      .all<MembershipRow>()
    return membershipRows.map(CloudflareWorkspaceRepository.#membershipOf)
  }

  // One batch, so two people signing in at once on a new instance cannot each create a workspace.
  async joinFirstWorkspace(userId: string, newWorkspaceName: string): Promise<Membership> {
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
           SELECT ${firstWorkspaceId}, ?, CASE WHEN ${firstWorkspaceId} = ? THEN 'admin' ELSE 'member' END, ?`,
        )
        .bind(userId, newWorkspaceId, now),
    ])
    const [firstMembership] = await this.membershipsOf(userId)
    if (!firstMembership) throw new Error(`User ${userId} could not join a workspace`)
    return firstMembership
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { results: memberRows } = await this.#db
      .prepare(
        `SELECT "user".id, "user".name, "user".email, "user".image, memberships.role
         FROM memberships JOIN "user" ON "user".id = memberships.user_id
         WHERE memberships.workspace_id = ? ORDER BY "user".name`,
      )
      .bind(workspaceId)
      .all<UserRow & { role: WorkspaceRole }>()
    return memberRows.map(memberRow => ({ ...CloudflareUserDirectory.profileOf(memberRow), role: memberRow.role }))
  }

  async setPublicLinksEnabled(workspaceId: string, enabled: boolean): Promise<void> {
    await this.#db.prepare('UPDATE workspaces SET public_links_enabled = ? WHERE id = ?').bind(enabled ? 1 : 0, workspaceId).run()
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
