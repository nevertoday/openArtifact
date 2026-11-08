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

/** What presenting a token amounts to: a working token, or why it no longer works. */
export type TokenUse = { status: 'active'; accessToken: AccessToken } | { status: 'revoked' } | { status: 'expired' } | { status: 'workspace_deleted' } | { status: 'unknown' }

/** Personal API tokens; only their hash is stored. */
export interface AccessTokenRepository {
  create(newAccessToken: NewAccessToken): Promise<AccessToken>
  listForUser(userId: string): Promise<AccessToken[]>
  /** Revokes only a token that belongs to `userId`; returns whether one was revoked. */
  revoke(tokenId: string, userId: string): Promise<boolean>
  /** Deletes a token of `userId` that is already revoked or expired at `now`; returns whether one was deleted. */
  deleteInactive(tokenId: string, userId: string, now: number): Promise<boolean>
  /** Records the use of a token that is neither revoked nor expired at `now`, in a workspace not deleted; otherwise says why it was refused. */
  useToken(tokenHash: string, now: number): Promise<TokenUse>
}
