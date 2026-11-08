import { WORKSPACE_ROLES, WorkspaceDeletion, type Membership, type MembershipChange } from '@open-artifact/core'
import { WORKSPACE_COOKIE, type Identity } from '../auth/request-identity.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError } from '../http-error.ts'
import { People } from '../people.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_NAME_LENGTH = 60
const MAX_WORKSPACE_NAME_LENGTH = 40
const YEAR_SECONDS = 365 * 24 * 60 * 60
const AUDIT_PAGE_SIZE = 50

/** The signed-in person, their workspaces, and workspace settings. */
export class WorkspaceApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async me(): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    return Response.json({
      user: { userId: identity.userId, name: identity.name, email: identity.email },
      workspace: WorkspaceApi.#workspaceJson(identity.membership),
      workspaces: identity.memberships.map(WorkspaceApi.#workspaceJson),
    })
  }

  async rename(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const requestBody = await JsonBody.of(request)
    const name = requestBody.text('name', MAX_NAME_LENGTH)
    await this.#context.auth.rename(request, name)
    await this.#context.personalPages.followRename(identity.userId)
    return Response.json({ name })
  }

  async switchWorkspace(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const requestBody = await JsonBody.of(request)
    const workspaceId = requestBody.text('workspaceId', 64)
    const isMember = identity.memberships.some(membership => membership.workspace.workspaceId === workspaceId)
    if (!isMember) throw HttpError.notFound(`workspace ${workspaceId}`)
    return Response.json({ workspaceId }, { headers: { 'Set-Cookie': WorkspaceApi.#workspaceCookie(request, workspaceId) } })
  }

  /** Anyone may create a workspace; they become its admin and switch to it. */
  async create(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const name = (await JsonBody.of(request)).text('name', MAX_WORKSPACE_NAME_LENGTH)
    const membership = await this.#context.repositories.workspaces.create(name, identity.userId, Date.now())
    return Response.json({ workspace: WorkspaceApi.#workspaceJson(membership) }, { status: 201, headers: { 'Set-Cookie': WorkspaceApi.#workspaceCookie(request, membership.workspace.workspaceId) } })
  }

  /** The person leaves the current workspace and lands in their personal one; any invite brings them back. */
  async leave(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const workspaceId = identity.membership.workspace.workspaceId
    const leaving = await this.#context.repositories.workspaces.leave(workspaceId, identity.userId, Date.now())
    if (leaving === 'last_admin') throw new HttpError(400, 'last_admin', 'you are the last admin of this workspace; make someone else admin first, or delete the workspace')
    WorkspaceApi.#refuseUnless(leaving, identity.userId)
    await this.#context.repositories.auditLog.record({ workspaceId, actorId: identity.userId, action: 'member.left', targetType: 'member', targetId: identity.userId, detail: {} })
    return this.#toPersonal(request, identity)
  }

  /** Every member loses access at once, tokens and artifacts included; its admins may restore it for 30 days. */
  async deleteWorkspace(request: Request): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('delete the workspace')
    const workspace = identity.membership.workspace
    if (workspace.personalOf !== null) throw WorkspaceApi.#personalWorkspaceRefusal()
    const deletedAt = Date.now()
    if (!(await this.#context.repositories.workspaces.delete(workspace.workspaceId, deletedAt))) throw HttpError.notFound(`workspace ${workspace.workspaceId}`)
    await this.#context.repositories.auditLog.record({ workspaceId: workspace.workspaceId, actorId: identity.userId, action: 'workspace.deleted', targetType: 'workspace', targetId: workspace.workspaceId, detail: {} })
    return this.#toPersonal(request, identity, { purgeAt: WorkspaceDeletion.purgeAt(deletedAt) })
  }

  /** The workspaces the person, as their admin, deleted or saw deleted and may still restore. */
  async listRestorable(): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const now = Date.now()
    const deletedWorkspaces = await this.#context.repositories.workspaces.listRestorable(identity.userId, WorkspaceDeletion.purgeCutoff(now))
    return Response.json({
      workspaces: deletedWorkspaces.map(deleted => ({ workspaceId: deleted.workspace.workspaceId, name: deleted.workspace.name, deletedAt: deleted.deletedAt, purgeAt: WorkspaceDeletion.purgeAt(deleted.deletedAt) })),
    })
  }

  async restore(request: Request, workspaceId: string): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const restored = await this.#context.repositories.workspaces.restore(workspaceId, identity.userId, WorkspaceDeletion.purgeCutoff(Date.now()))
    if (!restored) throw HttpError.notFound(`deleted workspace ${workspaceId} that you are an admin of`)
    await this.#context.repositories.auditLog.record({ workspaceId, actorId: identity.userId, action: 'workspace.restored', targetType: 'workspace', targetId: workspaceId, detail: {} })
    return Response.json({ workspaceId }, { headers: { 'Set-Cookie': WorkspaceApi.#workspaceCookie(request, workspaceId) } })
  }

  async #toPersonal(request: Request, identity: Identity, extra: Record<string, unknown> = {}): Promise<Response> {
    const personal = identity.memberships.find(membership => membership.workspace.personalOf === identity.userId)
    if (!personal) throw new Error(`user ${identity.userId} has no personal workspace`)
    const workspaceId = personal.workspace.workspaceId
    return Response.json({ workspaceId, ...extra }, { headers: { 'Set-Cookie': WorkspaceApi.#workspaceCookie(request, workspaceId) } })
  }

  static #workspaceCookie(request: Request, workspaceId: string): string {
    return HttpCookies.serialize(WORKSPACE_COOKIE, workspaceId, { maxAgeSeconds: YEAR_SECONDS }, new URL(request.url).protocol === 'https:')
  }

  static #workspaceJson(membership: Membership) {
    return { ...membership.workspace, role: membership.role }
  }

  static #personalWorkspaceRefusal(): HttpError {
    return new HttpError(400, 'personal_workspace', 'a personal workspace cannot be left or deleted, and its owner stays its admin')
  }

  async members(): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const members = await this.#context.repositories.workspaces.listMembers(identity.membership.workspace.workspaceId)
    return Response.json({ members: members.map(member => ({ userId: member.userId, name: People.displayName(member), email: member.email, role: member.role })) })
  }

  async changeRole(request: Request, userId: string): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('change member roles')
    const requestBody = await JsonBody.of(request)
    const role = requestBody.oneOf('role', WORKSPACE_ROLES)
    const workspaceId = identity.membership.workspace.workspaceId
    const members = await this.#context.repositories.workspaces.listMembers(workspaceId)
    const member = members.find(candidate => candidate.userId === userId)
    if (!member) throw HttpError.notFound(`member ${userId}`)
    if (member.role === role) return Response.json({ userId, role })
    const roleChange = await this.#context.repositories.workspaces.changeRole(workspaceId, userId, role)
    WorkspaceApi.#refuseUnless(roleChange, userId)
    await this.#context.repositories.auditLog.record({ workspaceId, actorId: identity.userId, action: 'member.role_changed', targetType: 'member', targetId: userId, detail: { from: member.role, to: role } })
    return Response.json({ userId, role })
  }

  /** The person loses access at once; their artifacts stay in the workspace. */
  async removeMember(userId: string): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('remove members')
    if (userId === identity.userId) throw new HttpError(400, 'cannot_remove_self', 'you cannot remove yourself; ask another admin')
    const workspaceId = identity.membership.workspace.workspaceId
    const removal = await this.#context.repositories.workspaces.removeMember(workspaceId, userId, Date.now())
    WorkspaceApi.#refuseUnless(removal, userId)
    await this.#context.repositories.auditLog.record({ workspaceId, actorId: identity.userId, action: 'member.removed', targetType: 'member', targetId: userId, detail: {} })
    return new Response(null, { status: 204 })
  }

  /** The latest content and membership changes of the workspace, newest first. */
  async audit(): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('read the audit log')
    const auditEvents = await this.#context.repositories.auditLog.listLatest(identity.membership.workspace.workspaceId, AUDIT_PAGE_SIZE)
    const names = await this.#context.people.namesInAuditEvents(auditEvents)
    return Response.json({
      events: auditEvents.map(auditEvent => {
        const memberId = People.memberIdOf(auditEvent)
        return {
          eventId: auditEvent.eventId,
          action: auditEvent.action,
          actor: { userId: auditEvent.actorId, name: names.get(auditEvent.actorId) },
          targetType: auditEvent.targetType,
          targetId: auditEvent.targetId,
          member: memberId === null ? null : { userId: memberId, name: names.get(memberId) },
          detail: auditEvent.detail,
          createdAt: auditEvent.createdAt,
        }
      }),
    })
  }

  static #refuseUnless(membershipChange: MembershipChange, userId: string): void {
    switch (membershipChange) {
      case 'changed':
        return
      case 'last_admin':
        throw new HttpError(400, 'last_admin', 'a workspace needs at least one admin; make someone else admin first')
      case 'not_member':
        throw HttpError.notFound(`member ${userId}`)
      case 'personal_workspace':
        throw WorkspaceApi.#personalWorkspaceRefusal()
    }
  }

  /** Each field present in the body is changed; both are read before either is written. */
  async updateSettings(request: Request): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('change workspace settings')
    const requestBody = await JsonBody.of(request)
    const workspace = identity.membership.workspace
    const name = requestBody.has('name') ? requestBody.text('name', MAX_WORKSPACE_NAME_LENGTH) : workspace.name
    const publicLinksEnabled = requestBody.boolean('publicLinksEnabled', workspace.publicLinksEnabled)
    if (name !== workspace.name) await this.#renameWorkspace(identity, name)
    await this.#context.repositories.workspaces.setPublicLinksEnabled(workspace.workspaceId, publicLinksEnabled)
    return Response.json({ name, publicLinksEnabled })
  }

  async #renameWorkspace(admin: Identity, name: string): Promise<void> {
    const workspace = admin.membership.workspace
    await this.#context.repositories.workspaces.rename(workspace.workspaceId, name)
    await this.#context.repositories.auditLog.record({ workspaceId: workspace.workspaceId, actorId: admin.userId, action: 'workspace.renamed', targetType: 'workspace', targetId: workspace.workspaceId, detail: { from: workspace.name, to: name } })
  }
}
