/**
 * An admin's invitation into a workspace. A link (no email) lets anyone who opens it join until it expires
 * or is revoked; an email invite lets only that address join, once.
 */
export interface Invite {
  inviteId: string
  workspaceId: string
  /** The one address this invite lets in, lower-cased; null for a link anyone may use. */
  email: string | null
  /** The secret in the invite link. */
  code: string
  invitedBy: string
  createdAt: number
  expiresAt: number
}

export interface NewInvite {
  workspaceId: string
  email: string | null
  code: string
  invitedBy: string
  createdAt: number
  expiresAt: number
}

/**
 * Every read returns only pending invites: not revoked, not expired at `now`, and for an email invite not
 * yet accepted. A spent invite is never handed back, so callers cannot forget to check.
 */
export interface InviteRepository {
  /** Creates the invite; an email invite replaces any pending one for the same address in the workspace. */
  create(newInvite: NewInvite): Promise<Invite>
  findPendingByCode(code: string, now: number): Promise<Invite | null>
  listPending(workspaceId: string, now: number): Promise<Invite[]>
  /** Pending email invites addressed to `email` in any workspace, newest first. */
  listPendingForEmail(email: string, now: number): Promise<Invite[]>
  /** Returns the invite it revoked, or null when the workspace has no such pending invite. */
  revoke(workspaceId: string, inviteId: string, now: number): Promise<Invite | null>
  /** Spends an email invite; a link stays usable for the next person. */
  markAccepted(inviteId: string, now: number): Promise<void>
}
