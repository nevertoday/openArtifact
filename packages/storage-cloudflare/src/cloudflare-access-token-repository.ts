import type { AccessToken, AccessTokenRepository, AccessTokenScope, NewAccessToken, TokenUse } from '@open-artifact/core'

const TOKEN_COLUMNS = 'id, user_id, workspace_id, name, scope, expires_at, revoked_at, last_used_at, created_at'

interface TokenRow {
  id: string
  user_id: string
  workspace_id: string
  name: string
  scope: AccessTokenScope
  expires_at: number | null
  revoked_at: number | null
  last_used_at: number | null
  created_at: number
}

export class CloudflareAccessTokenRepository implements AccessTokenRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async create(newAccessToken: NewAccessToken): Promise<AccessToken> {
    const tokenRow = await this.#db
      .prepare(
        `INSERT INTO personal_access_tokens (id, user_id, workspace_id, name, token_hash, scope, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${TOKEN_COLUMNS}`,
      )
      .bind(crypto.randomUUID(), newAccessToken.userId, newAccessToken.workspaceId, newAccessToken.name, newAccessToken.tokenHash, newAccessToken.scope, newAccessToken.expiresAt, Date.now())
      .first<TokenRow>()
    if (!tokenRow) throw new Error(`Access token for user ${newAccessToken.userId} was not saved`)
    return CloudflareAccessTokenRepository.#tokenOf(tokenRow)
  }

  async listForUser(userId: string): Promise<AccessToken[]> {
    const { results: tokenRows } = await this.#db
      .prepare(`SELECT ${TOKEN_COLUMNS} FROM personal_access_tokens WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`)
      .bind(userId)
      .all<TokenRow>()
    return tokenRows.map(CloudflareAccessTokenRepository.#tokenOf)
  }

  async revoke(tokenId: string, userId: string): Promise<boolean> {
    const revocation = await this.#db
      .prepare('UPDATE personal_access_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
      .bind(Date.now(), tokenId, userId)
      .run()
    return revocation.meta.changes === 1
  }

  async useToken(tokenHash: string, now: number): Promise<TokenUse> {
    const activeRow = await this.#db
      .prepare(
        `UPDATE personal_access_tokens SET last_used_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         RETURNING ${TOKEN_COLUMNS}`,
      )
      .bind(now, tokenHash, now)
      .first<TokenRow>()
    if (activeRow) return { status: 'active', accessToken: CloudflareAccessTokenRepository.#tokenOf(activeRow) }
    const refusedRow = await this.#db.prepare('SELECT revoked_at FROM personal_access_tokens WHERE token_hash = ?').bind(tokenHash).first<Pick<TokenRow, 'revoked_at'>>()
    if (!refusedRow) return { status: 'unknown' }
    return refusedRow.revoked_at === null ? { status: 'expired' } : { status: 'revoked' }
  }

  static #tokenOf(tokenRow: TokenRow): AccessToken {
    return {
      tokenId: tokenRow.id,
      userId: tokenRow.user_id,
      workspaceId: tokenRow.workspace_id,
      name: tokenRow.name,
      scope: tokenRow.scope,
      expiresAt: tokenRow.expires_at,
      revokedAt: tokenRow.revoked_at,
      lastUsedAt: tokenRow.last_used_at,
      createdAt: tokenRow.created_at,
    }
  }
}
