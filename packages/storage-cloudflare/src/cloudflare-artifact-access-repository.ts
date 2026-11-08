import type { ArtifactAccessRepository, ArtifactGrant, ArtifactSharing, GrantRole, PendingGrant, PersonGrant } from '@open-artifact/core'

interface GrantRow {
  artifact_id: string
  user_id: string
  role: GrantRole
}

interface PendingGrantRow {
  email: string
  role: GrantRole
  granted_by: string
  created_at: number
}

export class CloudflareArtifactAccessRepository implements ArtifactAccessRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  // One D1 batch runs as a single transaction.
  async saveSharing(artifactId: string, sharing: ArtifactSharing, grants: PersonGrant[], pendingGrants: PendingGrant[]): Promise<void> {
    await this.#db.batch([
      this.#db
        .prepare('UPDATE artifacts SET visibility = ?, public_link_expires_at = ?, public_link_password_hash = ?, anonymous_write_enabled = ?, public_link_shows_comments = ?, listed = ? WHERE id = ?')
        .bind(sharing.visibility, sharing.publicLinkExpiresAt, sharing.publicLinkPasswordHash, sharing.anonymousWriteEnabled ? 1 : 0, sharing.publicLinkShowsComments ? 1 : 0, sharing.listed ? 1 : 0, artifactId),
      this.#db.prepare('DELETE FROM artifact_grants WHERE artifact_id = ?').bind(artifactId),
      ...grants.map(grant => this.#db.prepare('INSERT INTO artifact_grants (artifact_id, user_id, role) VALUES (?, ?, ?)').bind(artifactId, grant.userId, grant.role)),
      this.#db.prepare('DELETE FROM pending_grants WHERE artifact_id = ?').bind(artifactId),
      ...pendingGrants.map(pending =>
        this.#db.prepare('INSERT INTO pending_grants (artifact_id, email, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(artifactId, pending.email, pending.role, pending.grantedBy, pending.createdAt),
      ),
    ])
  }

  async listPendingGrants(artifactId: string): Promise<PendingGrant[]> {
    const { results: pendingRows } = await this.#db.prepare('SELECT email, role, granted_by, created_at FROM pending_grants WHERE artifact_id = ? ORDER BY created_at, email').bind(artifactId).all<PendingGrantRow>()
    return pendingRows.map(pendingRow => ({ email: pendingRow.email, role: pendingRow.role, grantedBy: pendingRow.granted_by, createdAt: pendingRow.created_at }))
  }

  // Runs on every signed-in request, so with nothing waiting it costs one indexed read and no write.
  async claimPendingGrants(email: string, userId: string): Promise<void> {
    const waiting = await this.#db.prepare('SELECT 1 FROM pending_grants WHERE email = ? LIMIT 1').bind(email).first()
    if (waiting === null) return
    await this.#db.batch([
      this.#db.prepare('INSERT INTO artifact_grants (artifact_id, user_id, role) SELECT artifact_id, ?, role FROM pending_grants WHERE email = ? ON CONFLICT (artifact_id, user_id) DO NOTHING').bind(userId, email),
      this.#db.prepare('DELETE FROM pending_grants WHERE email = ?').bind(email),
    ])
  }

  async listGrants(artifactId: string): Promise<ArtifactGrant[]> {
    const { results: grantRows } = await this.#db.prepare('SELECT artifact_id, user_id, role FROM artifact_grants WHERE artifact_id = ?').bind(artifactId).all<GrantRow>()
    return grantRows.map(CloudflareArtifactAccessRepository.#grantOf)
  }

  async listGrantsOfUser(userId: string): Promise<ArtifactGrant[]> {
    const { results: grantRows } = await this.#db.prepare('SELECT artifact_id, user_id, role FROM artifact_grants WHERE user_id = ?').bind(userId).all<GrantRow>()
    return grantRows.map(CloudflareArtifactAccessRepository.#grantOf)
  }

  static #grantOf(grantRow: GrantRow): ArtifactGrant {
    return { artifactId: grantRow.artifact_id, userId: grantRow.user_id, role: grantRow.role }
  }
}
