import type { Invite, InviteRepository, NewInvite } from '@open-artifact/core'

// The one definition of a pending invite; every read below goes through it.
const PENDING = 'invites.revoked_at IS NULL AND invites.accepted_at IS NULL AND invites.expires_at > ?'

interface InviteRow {
  id: string
  workspace_id: string
  email: string | null
  code: string
  invited_by: string
  created_at: number
  expires_at: number
}

export class CloudflareInviteRepository implements InviteRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  // One batch, so two admins inviting the same address at once still leave a single pending invite.
  async create(newInvite: NewInvite): Promise<Invite> {
    const invite: Invite = { inviteId: crypto.randomUUID(), ...newInvite }
    await this.#db.batch([
      this.#db
        .prepare(`UPDATE invites SET revoked_at = ? WHERE workspace_id = ? AND email = ? AND ${PENDING}`)
        .bind(invite.createdAt, invite.workspaceId, invite.email, invite.createdAt),
      this.#db
        .prepare('INSERT INTO invites (id, workspace_id, email, code, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(invite.inviteId, invite.workspaceId, invite.email, invite.code, invite.invitedBy, invite.createdAt, invite.expiresAt),
    ])
    return invite
  }

  async findPendingByCode(code: string, now: number): Promise<Invite | null> {
    const inviteRow = await this.#db.prepare(`SELECT * FROM invites WHERE code = ? AND ${PENDING}`).bind(code, now).first<InviteRow>()
    return inviteRow ? CloudflareInviteRepository.#inviteOf(inviteRow) : null
  }

  async listPending(workspaceId: string, now: number): Promise<Invite[]> {
    const { results: inviteRows } = await this.#db
      .prepare(`SELECT * FROM invites WHERE workspace_id = ? AND ${PENDING} ORDER BY created_at DESC, rowid DESC`)
      .bind(workspaceId, now)
      .all<InviteRow>()
    return inviteRows.map(CloudflareInviteRepository.#inviteOf)
  }

  async listPendingForEmail(email: string, now: number): Promise<Invite[]> {
    const { results: inviteRows } = await this.#db
      .prepare(`SELECT * FROM invites WHERE email = ? AND ${PENDING} ORDER BY created_at DESC, rowid DESC`)
      .bind(email, now)
      .all<InviteRow>()
    return inviteRows.map(CloudflareInviteRepository.#inviteOf)
  }

  async revoke(workspaceId: string, inviteId: string, now: number): Promise<Invite | null> {
    const inviteRow = await this.#db
      .prepare(`UPDATE invites SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND ${PENDING} RETURNING *`)
      .bind(now, inviteId, workspaceId, now)
      .first<InviteRow>()
    return inviteRow ? CloudflareInviteRepository.#inviteOf(inviteRow) : null
  }

  async markAccepted(inviteId: string, now: number): Promise<void> {
    await this.#db.prepare('UPDATE invites SET accepted_at = ? WHERE id = ? AND email IS NOT NULL AND accepted_at IS NULL').bind(now, inviteId).run()
  }

  static #inviteOf(inviteRow: InviteRow): Invite {
    return {
      inviteId: inviteRow.id,
      workspaceId: inviteRow.workspace_id,
      email: inviteRow.email,
      code: inviteRow.code,
      invitedBy: inviteRow.invited_by,
      createdAt: inviteRow.created_at,
      expiresAt: inviteRow.expires_at,
    }
  }
}
