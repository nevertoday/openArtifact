import type { WorkspaceRole } from './workspace-repository.ts'

/** What happened, to which artifact or member, with the facts needed to describe it after the target is gone. */
export type AuditChange =
  | { action: 'artifact.removed'; targetType: 'artifact'; targetId: string; detail: { title: string; removedAsAdmin: boolean } }
  | { action: 'artifact.restored'; targetType: 'artifact'; targetId: string; detail: { title: string } }
  | { action: 'artifact.renamed'; targetType: 'artifact'; targetId: string; detail: { from: string; to: string } }
  | { action: 'member.removed'; targetType: 'member'; targetId: string; detail: Record<string, never> }
  | { action: 'member.role_changed'; targetType: 'member'; targetId: string; detail: { from: WorkspaceRole; to: WorkspaceRole } }
  | { action: 'member.invited'; targetType: 'invite'; targetId: string; detail: { email: string | null } }
  | { action: 'invite.revoked'; targetType: 'invite'; targetId: string; detail: { email: string | null } }
  | { action: 'member.joined'; targetType: 'member'; targetId: string; detail: { via: 'link' | 'email' } }
  | { action: 'workspace.renamed'; targetType: 'workspace'; targetId: string; detail: { from: string; to: string } }

export type AuditAction = AuditChange['action']

export type NewAuditEvent = AuditChange & { workspaceId: string; actorId: string }

export type AuditEvent = NewAuditEvent & { eventId: string; createdAt: number }

/** Who removed, restored or renamed content, who invited, joined or changed membership, and who renamed the workspace; admins read it. */
export interface AuditLog {
  record(newEvent: NewAuditEvent): Promise<void>
  listLatest(workspaceId: string, limit: number): Promise<AuditEvent[]>
}
