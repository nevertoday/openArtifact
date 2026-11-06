import { AccessTokenSecret, type AccessTokenScope, type Membership } from '@open-artifact/core'
import { HttpCookies } from '../http-cookies.ts'
import { RemovedFromWorkspaceError } from '../http-error.ts'
import { People } from '../people.ts'
import type { Repositories } from '@open-artifact/core'
import type { OpenArtifactAuth } from './open-artifact-auth.ts'

export const WORKSPACE_COOKIE = 'oa_workspace'
/** Agent clients name themselves in this header; the MCP Worker fills it from the client's MCP handshake. */
export const AGENT_CLIENT_HEADER = 'X-Open-Artifact-Client'
const DIRECT_API_CLIENT = 'API'
const MAX_AGENT_CLIENT_LENGTH = 40

export interface Identity {
  userId: string
  name: string
  email: string
  /** The workspace this request acts in: the token's workspace, or the one chosen in the browser. */
  membership: Membership
  memberships: Membership[]
  /** The agent client behind a token request, e.g. "Claude Code"; null for a person in the browser. */
  agentClient: string | null
  /** What the token behind the request may do; null for a person in the browser, who may do everything. */
  tokenScope: AccessTokenScope | null
}

/** Who is behind a request: a browser session, a personal API token, or nobody. */
export class RequestIdentity {
  readonly #auth: OpenArtifactAuth
  readonly #repositories: Repositories
  readonly #request: Request
  #resolvedIdentity: Promise<Identity | null> | null = null

  constructor(auth: OpenArtifactAuth, repositories: Repositories, request: Request) {
    this.#auth = auth
    this.#repositories = repositories
    this.#request = request
  }

  get usesAccessToken(): boolean {
    return RequestIdentity.#bearerToken(this.#request) !== null
  }

  resolve(): Promise<Identity | null> {
    this.#resolvedIdentity ??= this.usesAccessToken ? this.#tokenIdentity() : this.#sessionIdentity()
    return this.#resolvedIdentity
  }

  async #tokenIdentity(): Promise<Identity | null> {
    const bearerToken = RequestIdentity.#bearerToken(this.#request) ?? ''
    if (!AccessTokenSecret.looksLikeToken(bearerToken)) return null
    const accessToken = await this.#repositories.accessTokens.useActiveToken(await AccessTokenSecret.hashOf(bearerToken), Date.now())
    if (!accessToken) return null
    const profile = (await this.#repositories.users.profilesOf([accessToken.userId])).get(accessToken.userId)
    const memberships = await this.#repositories.workspaces.membershipsOf(accessToken.userId)
    // A token stops working in a workspace its owner has left.
    const tokenMembership = memberships.find(membership => membership.workspace.workspaceId === accessToken.workspaceId)
    if (!profile || !tokenMembership) return null
    // A token acts only in the workspace it was created for, even when its owner belongs to others.
    return { userId: profile.userId, name: People.displayName(profile), email: profile.email, membership: tokenMembership, memberships: [tokenMembership], agentClient: this.#agentClient(), tokenScope: accessToken.scope }
  }

  async #sessionIdentity(): Promise<Identity | null> {
    const signedInUser = await this.#auth.signedInUser(this.#request)
    if (!signedInUser) return null
    const memberships = await this.#membershipsOf(signedInUser.userId)
    const chosenWorkspaceId = HttpCookies.read(this.#request, WORKSPACE_COOKIE)
    const membership = memberships.find(candidate => candidate.workspace.workspaceId === chosenWorkspaceId) ?? memberships[0]
    if (!membership) throw new Error(`User ${signedInUser.userId} has no workspace`)
    return { userId: signedInUser.userId, name: People.displayName(signedInUser), email: signedInUser.email, membership, memberships, agentClient: null, tokenScope: null }
  }

  // Accounts created before workspaces existed join one on their next visit; a person an admin removed does not.
  async #membershipsOf(userId: string): Promise<Membership[]> {
    const memberships = await this.#repositories.workspaces.membershipsOf(userId)
    if (memberships.length > 0) return memberships
    const joinedMembership = await this.#repositories.workspaces.joinFirstWorkspace(userId, '我的团队')
    if (joinedMembership === null) throw new RemovedFromWorkspaceError()
    return [joinedMembership]
  }

  #agentClient(): string {
    const declaredClient = this.#request.headers.get(AGENT_CLIENT_HEADER)?.trim().slice(0, MAX_AGENT_CLIENT_LENGTH)
    return declaredClient && declaredClient.length > 0 ? declaredClient : DIRECT_API_CLIENT
  }

  static #bearerToken(request: Request): string | null {
    const authorization = request.headers.get('Authorization') ?? ''
    const [scheme, credentials] = authorization.split(' ')
    return scheme?.toLowerCase() === 'bearer' && credentials ? credentials : null
  }
}
