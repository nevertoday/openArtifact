import type { ArtifactAccessRepository, ArtifactGrant, ArtifactSharing, GrantRole } from '@open-artifact/core'

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

  async updateSharing(artifactId: string, sharing: ArtifactSharing): Promise<void> {
    await this.#db
      .prepare('UPDATE artifacts SET visibility = ?, public_link_expires_at = ?, public_link_password_hash = ?, anonymous_write_enabled = ? WHERE id = ?')
      .bind(sharing.visibility, sharing.publicLinkExpiresAt, sharing.publicLinkPasswordHash, sharing.anonymousWriteEnabled ? 1 : 0, artifactId)
      .run()
  }

  async listGrants(artifactId: string): Promise<ArtifactGrant[]> {
    const { results: grantRows } = await this.#db.prepare('SELECT artifact_id, user_id, role FROM artifact_grants WHERE artifact_id = ?').bind(artifactId).all<GrantRow>()
    return grantRows.map(CloudflareArtifactAccessRepository.#grantOf)
  }

  async listGrantsOfUser(userId: string): Promise<ArtifactGrant[]> {
    const { results: grantRows } = await this.#db.prepare('SELECT artifact_id, user_id, role FROM artifact_grants WHERE user_id = ?').bind(userId).all<GrantRow>()
    return grantRows.map(CloudflareArtifactAccessRepository.#grantOf)
  }

  async setGrant(grant: ArtifactGrant): Promise<void> {
    await this.#db
      .prepare('INSERT INTO artifact_grants (artifact_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (artifact_id, user_id) DO UPDATE SET role = excluded.role')
      .bind(grant.artifactId, grant.userId, grant.role)
      .run()
  }

  async removeGrant(artifactId: string, userId: string): Promise<void> {
    await this.#db.prepare('DELETE FROM artifact_grants WHERE artifact_id = ? AND user_id = ?').bind(artifactId, userId).run()
  }

  static #grantOf(grantRow: GrantRow): ArtifactGrant {
    return { artifactId: grantRow.artifact_id, userId: grantRow.user_id, role: grantRow.role }
  }
}
