/** What a token may do: `publish` works on artifacts as its person; `full` may also change who can see them. */
export type AccessTokenScope = 'publish' | 'full'

export const ACCESS_TOKEN_SCOPES: readonly AccessTokenScope[] = ['publish', 'full']

export interface AccessToken {
  tokenId: string
  userId: string
  workspaceId: string
  name: string
  scope: AccessTokenScope
  expiresAt: number | null
  revokedAt: number | null
  lastUsedAt: number | null
  createdAt: number
}

export interface NewAccessToken {
  userId: string
  workspaceId: string
  name: string
  tokenHash: string
  scope: AccessTokenScope
  expiresAt: number | null
}

/** Personal API tokens; only their hash is stored. */
export interface AccessTokenRepository {
  create(newAccessToken: NewAccessToken): Promise<AccessToken>
  listForUser(userId: string): Promise<AccessToken[]>
  /** Revokes only a token that belongs to `userId`; returns whether one was revoked. */
  revoke(tokenId: string, userId: string): Promise<boolean>
  /** Returns the token when it is neither revoked nor expired at `now`, and records that it was used. */
  useActiveToken(tokenHash: string, now: number): Promise<AccessToken | null>
}
