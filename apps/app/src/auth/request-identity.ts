import { AccessTokenSecret, type AccessToken, type AccessTokenScope, type Membership } from '@open-artifact/core'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError, RemovedFromWorkspaceError } from '../http-error.ts'
import { People } from '../people.ts'
import type { Repositories } from '@open-artifact/core'
import { INVITE_COOKIE, type Admission } from './admission.ts'
import type { OpenArtifactAuth } from './open-artifact-auth.ts'

export const WORKSPACE_COOKIE = 'oa_workspace'
/** Agent clients name themselves in this header; the MCP Worker fills it from the client's MCP handshake. */
export const AGENT_CLIENT_HEADER = 'X-Open-Artifact-Client'
const DIRECT_API_CLIENT = 'API'
const MAX_AGENT_CLIENT_LENGTH = 40
const NEW_TOKEN_HINT = 'create a new one in 设置 › Agent 接入'

type TokenRefusal = 'token_invalid' | 'token_revoked' | 'token_expired'

const TOKEN_REFUSAL_MESSAGES: Record<TokenRefusal, string> = {
  token_invalid: `this API token is not valid; ${NEW_TOKEN_HINT} and send it as "Authorization: Bearer oa_pat_…"`,
  token_revoked: `this API token was revoked; ${NEW_TOKEN_HINT}`,
  token_expired: `this API token has expired; ${NEW_TOKEN_HINT}`,
}

export interface Identity {
  userId: string
  name: string
  /** Whether `name` is one the person chose, rather than their email's local part. */
  hasChosenName: boolean
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
  readonly #admission: Admission
  readonly #request: Request
  #resolvedIdentity: Promise<Identity | null> | null = null
  #tokenRefusal: TokenRefusal | null = null

  constructor(auth: OpenArtifactAuth, repositories: Repositories, admission: Admission, request: Request) {
    this.#auth = auth
    this.#repositories = repositories
    this.#admission = admission
    this.#request = request
  }

  get usesAccessToken(): boolean {
    return RequestIdentity.#bearerToken(this.#request) !== null
  }

  resolve(): Promise<Identity | null> {
    this.#resolvedIdentity ??= this.usesAccessToken ? this.#tokenIdentity() : this.#sessionIdentity()
    return this.#resolvedIdentity
  }

  /** The 401 for a request that identifies nobody: why its token was refused, or that it needs to sign in. */
  async unauthorized(): Promise<HttpError> {
    await this.resolve()
    return this.#tokenRefusal === null ? HttpError.unauthorized() : new HttpError(401, this.#tokenRefusal, TOKEN_REFUSAL_MESSAGES[this.#tokenRefusal])
  }

  /** A token that no longer works is refused outright, so an agent never mistakes it for anonymous access. */
  async rejectRefusedToken(): Promise<void> {
    if (this.usesAccessToken && (await this.resolve()) === null) throw await this.unauthorized()
  }

  async #tokenIdentity(): Promise<Identity | null> {
    const bearerToken = RequestIdentity.#bearerToken(this.#request) ?? ''
    if (!AccessTokenSecret.looksLikeToken(bearerToken)) return this.#refuseToken('token_invalid')
    const tokenUse = await this.#repositories.accessTokens.useToken(await AccessTokenSecret.hashOf(bearerToken), Date.now())
    switch (tokenUse.status) {
      case 'unknown':
        return this.#refuseToken('token_invalid')
      case 'revoked':
        return this.#refuseToken('token_revoked')
      case 'expired':
        return this.#refuseToken('token_expired')
      case 'active':
        return this.#identityOfToken(tokenUse.accessToken)
    }
  }

  async #identityOfToken(accessToken: AccessToken): Promise<Identity | null> {
    const profile = (await this.#repositories.users.profilesOf([accessToken.userId])).get(accessToken.userId)
    const memberships = await this.#repositories.workspaces.membershipsOf(accessToken.userId)
    // A token stops working in a workspace its owner has left.
    const tokenMembership = memberships.find(membership => membership.workspace.workspaceId === accessToken.workspaceId)
    if (!profile || !tokenMembership) return this.#refuseToken('token_invalid')
    // A token acts only in the workspace it was created for, even when its owner belongs to others.
    return { userId: profile.userId, name: People.displayName(profile), hasChosenName: People.hasChosenName(profile), email: profile.email, membership: tokenMembership, memberships: [tokenMembership], agentClient: this.#agentClient(), tokenScope: accessToken.scope }
  }

  #refuseToken(refusal: TokenRefusal): null {
    this.#tokenRefusal = refusal
    return null
  }

  async #sessionIdentity(): Promise<Identity | null> {
    const signedInUser = await this.#auth.signedInUser(this.#request)
    if (!signedInUser) return null
    const memberships = await this.#membershipsOf(signedInUser)
    const chosenWorkspaceId = HttpCookies.read(this.#request, WORKSPACE_COOKIE)
    const membership = memberships.find(candidate => candidate.workspace.workspaceId === chosenWorkspaceId) ?? memberships[0]
    if (!membership) throw new Error(`User ${signedInUser.userId} has no workspace`)
    return { userId: signedInUser.userId, name: People.displayName(signedInUser), hasChosenName: People.hasChosenName(signedInUser), email: signedInUser.email, membership, memberships, agentClient: null, tokenScope: null }
  }

  // A person joins a workspace on the first visit after sign-in, through the invite link this browser opened if any.
  async #membershipsOf(signedInUser: { userId: string; email: string }): Promise<Membership[]> {
    const memberships = await this.#repositories.workspaces.membershipsOf(signedInUser.userId)
    if (memberships.length > 0) return memberships
    const joinedMembership = await this.#admission.join(signedInUser, HttpCookies.read(this.#request, INVITE_COOKIE))
    if (joinedMembership === null) throw new RemovedFromWorkspaceError()
    return [joinedMembership]
  }

  #agentClient(): string {
    const declaredClient = this.#request.headers.get(AGENT_CLIENT_HEADER)?.trim() ?? ''
    return declaredClient.length > 0 ? RequestIdentity.#shortClientName(declaredClient) : DIRECT_API_CLIENT
  }

  // A long name is cut at the last word that fits, never inside a word, and says it was cut.
  static #shortClientName(clientName: string): string {
    if (clientName.length <= MAX_AGENT_CLIENT_LENGTH) return clientName
    const fitting = clientName.slice(0, MAX_AGENT_CLIENT_LENGTH - 1)
    const lastSpace = fitting.lastIndexOf(' ')
    return `${(lastSpace > 0 ? fitting.slice(0, lastSpace) : fitting).trimEnd()}…`
  }

  static #bearerToken(request: Request): string | null {
    const authorization = request.headers.get('Authorization') ?? ''
    const [scheme, credentials] = authorization.split(' ')
    return scheme?.toLowerCase() === 'bearer' && credentials ? credentials : null
  }
}
