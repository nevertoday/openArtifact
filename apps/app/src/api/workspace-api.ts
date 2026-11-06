import type { AuditEvent } from '@open-artifact/core'
import { WORKSPACE_COOKIE } from '../auth/request-identity.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError } from '../http-error.ts'
import { People } from '../people.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_NAME_LENGTH = 60
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
      workspace: { ...identity.membership.workspace, role: identity.membership.role },
      workspaces: identity.memberships.map(membership => ({ ...membership.workspace, role: membership.role })),
    })
  }

  async rename(request: Request): Promise<Response> {
    await this.#context.requireBrowserSession()
    const requestBody = await JsonBody.of(request)
    const name = requestBody.text('name', MAX_NAME_LENGTH)
    await this.#context.auth.rename(request, name)
    return Response.json({ name })
  }

  async switchWorkspace(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const requestBody = await JsonBody.of(request)
    const workspaceId = requestBody.text('workspaceId', 64)
    const isMember = identity.memberships.some(membership => membership.workspace.workspaceId === workspaceId)
    if (!isMember) throw HttpError.notFound(`workspace ${workspaceId}`)
    const workspaceCookie = HttpCookies.serialize(WORKSPACE_COOKIE, workspaceId, { maxAgeSeconds: YEAR_SECONDS }, new URL(request.url).protocol === 'https:')
    return Response.json({ workspaceId }, { headers: { 'Set-Cookie': workspaceCookie } })
  }

  async members(): Promise<Response> {
    const identity = await this.#context.requireIdentity()
    const members = await this.#context.repositories.workspaces.listMembers(identity.membership.workspace.workspaceId)
    return Response.json({ members: members.map(member => ({ userId: member.userId, name: People.displayName(member), email: member.email, role: member.role })) })
  }

  /** The latest content and membership changes of the workspace, newest first. */
  async audit(): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('read the audit log')
    const auditEvents = await this.#context.repositories.auditLog.listLatest(identity.membership.workspace.workspaceId, AUDIT_PAGE_SIZE)
    const memberIdOf = (auditEvent: AuditEvent) => (auditEvent.targetType === 'member' ? auditEvent.targetId : null)
    const names = await this.#context.people.namesOf(auditEvents.flatMap(auditEvent => [auditEvent.actorId, memberIdOf(auditEvent)]))
    return Response.json({
      events: auditEvents.map(auditEvent => ({
        eventId: auditEvent.eventId,
        action: auditEvent.action,
        actor: { userId: auditEvent.actorId, name: names.get(auditEvent.actorId) },
        targetType: auditEvent.targetType,
        targetId: auditEvent.targetId,
        member: auditEvent.targetType === 'member' ? { userId: auditEvent.targetId, name: names.get(auditEvent.targetId) } : null,
        detail: auditEvent.detail,
        createdAt: auditEvent.createdAt,
      })),
    })
  }

  async updateSettings(request: Request): Promise<Response> {
    const identity = await this.#context.requireWorkspaceAdmin('change workspace settings')
    const requestBody = await JsonBody.of(request)
    const publicLinksEnabled = requestBody.boolean('publicLinksEnabled', identity.membership.workspace.publicLinksEnabled)
    await this.#context.repositories.workspaces.setPublicLinksEnabled(identity.membership.workspace.workspaceId, publicLinksEnabled)
    return Response.json({ publicLinksEnabled })
  }
}
