import { AccessTokenSecret, type AccessToken, type AccessTokenScope, type Locale, type Membership } from '@open-artifact/core'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError } from '../http-error.ts'
import { People } from '../people.ts'
import type { Repositories } from '@open-artifact/core'
import { Admission } from './admission.ts'
import type { OpenArtifactAuth, SignedInUser } from './open-artifact-auth.ts'

export const WORKSPACE_COOKIE = 'oa_workspace'
/** A page names the workspace it shows on every write, so a tab left behind by a switch elsewhere cannot act on another one. */
export const WORKSPACE_HEADER = 'X-Open-Artifact-Workspace'
/** Agent clients name themselves in this header; the MCP Worker fills it from the client's MCP handshake. */
export const AGENT_CLIENT_HEADER = 'X-Open-Artifact-Client'
const DIRECT_API_CLIENT = 'API'
const MAX_AGENT_CLIENT_LENGTH = 40
const NEW_TOKEN_HINT = 'create a new one in Settings › Agent access (设置 › Agent 接入)'

type TokenRefusal = 'token_invalid' | 'token_revoked' | 'token_expired' | 'workspace_deleted'

const TOKEN_REFUSAL_MESSAGES: Record<TokenRefusal, string> = {
  token_invalid: `this API token is not valid; ${NEW_TOKEN_HINT} and send it as "Authorization: Bearer oa_pat_…"`,
  token_revoked: `this API token was revoked; ${NEW_TOKEN_HINT}`,
  token_expired: `this API token has expired; ${NEW_TOKEN_HINT}`,
  workspace_deleted:
    'the workspace this API token belongs to was deleted, so the token is not wrong but has nothing to act on; ask your person to restore the workspace within 30 days, or to create a token in another workspace in Settings › Agent access (设置 › Agent 接入)',
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
  /** The interface language the person chose; null until they choose one. */
  locale: Locale | null
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
      case 'workspace_deleted':
        return this.#refuseToken('workspace_deleted')
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
    return { userId: profile.userId, name: People.displayName(profile), hasChosenName: People.hasChosenName(profile), email: profile.email, membership: tokenMembership, memberships: [tokenMembership], agentClient: this.#agentClient(), tokenScope: accessToken.scope, locale: profile.locale }
  }

  #refuseToken(refusal: TokenRefusal): null {
    this.#tokenRefusal = refusal
    return null
  }

  async #sessionIdentity(): Promise<Identity | null> {
    const signedInUser = await this.#auth.signedInUser(this.#request)
    if (!signedInUser) return null
    await this.#claimPagesSharedByEmail(signedInUser)
    const memberships = await this.#membershipsOf(signedInUser)
    const chosenWorkspaceId = HttpCookies.read(this.#request, WORKSPACE_COOKIE)
    const membership = memberships.find(candidate => candidate.workspace.workspaceId === chosenWorkspaceId) ?? RequestIdentity.#landing(memberships, signedInUser.userId)
    return { userId: signedInUser.userId, name: People.displayName(signedInUser), hasChosenName: People.hasChosenName(signedInUser), email: signedInUser.email, membership, memberships, agentClient: null, tokenScope: null, locale: signedInUser.locale }
  }

  // Pages shared with an address are kept by address until its owner signs in, whether or not they had an account then.
  // It runs before joining a workspace, so a refused join never leaves the grants waiting.
  async #claimPagesSharedByEmail(signedInUser: SignedInUser): Promise<void> {
    if (signedInUser.emailVerified) await this.#repositories.artifactAccess.claimPendingGrants(Admission.normalizedEmail(signedInUser.email), signedInUser.userId)
  }

  // Sign-up creates the personal workspace; people who signed up before personal workspaces existed get theirs here.
  async #membershipsOf(signedInUser: SignedInUser): Promise<Membership[]> {
    const memberships = await this.#repositories.workspaces.membershipsOf(signedInUser.userId)
    if (memberships.some(membership => membership.workspace.personalOf === signedInUser.userId)) return memberships
    const m = this.#auth.requestMessages(this.#request.headers, signedInUser.locale)
    await this.#admission.ensurePersonal(signedInUser, Admission.personalWorkspaceName(m, People.displayName(signedInUser)))
    return this.#repositories.workspaces.membershipsOf(signedInUser.userId)
  }

  // With no workspace chosen in this browser, the one joined last other than the personal one: the workspace an invite
  // just brought a newcomer into, or the one a person used before personal workspaces existed. Else the personal one.
  static #landing(memberships: Membership[], userId: string): Membership {
    const landing = memberships.filter(membership => membership.workspace.personalOf !== userId).at(-1) ?? memberships[0]
    if (!landing) throw new Error(`user ${userId} has no workspace, not even a personal one`)
    return landing
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
