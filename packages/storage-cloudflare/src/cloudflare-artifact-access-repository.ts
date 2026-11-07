import type { ArtifactAccessRepository, ArtifactGrant, ArtifactSharing, GrantRole, PersonGrant } from '@open-artifact/core'

interface GrantRow {
  artifact_id: string
  user_id: string
  role: GrantRole
}

export class CloudflareArtifactAccessRepository implements ArtifactAccessRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  // One D1 batch runs as a single transaction.
  async saveSharing(artifactId: string, sharing: ArtifactSharing, grants: PersonGrant[]): Promise<void> {
    await this.#db.batch([
      this.#db
        .prepare('UPDATE artifacts SET visibility = ?, public_link_expires_at = ?, public_link_password_hash = ?, anonymous_write_enabled = ?, public_link_shows_comments = ?, listed = ? WHERE id = ?')
        .bind(sharing.visibility, sharing.publicLinkExpiresAt, sharing.publicLinkPasswordHash, sharing.anonymousWriteEnabled ? 1 : 0, sharing.publicLinkShowsComments ? 1 : 0, sharing.listed ? 1 : 0, artifactId),
      this.#db.prepare('DELETE FROM artifact_grants WHERE artifact_id = ?').bind(artifactId),
      ...grants.map(grant => this.#db.prepare('INSERT INTO artifact_grants (artifact_id, user_id, role) VALUES (?, ?, ?)').bind(artifactId, grant.userId, grant.role)),
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
