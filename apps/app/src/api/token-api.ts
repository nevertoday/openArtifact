import { ACCESS_TOKEN_SCOPES, AccessTokenSecret, type AccessToken } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_TOKEN_NAME_LENGTH = 80
const DAY = 24 * 60 * 60 * 1000
const MAX_LIFETIME_DAYS = 366

/** Personal API tokens an agent uses to act as its person; managed only from a signed-in browser. */
export class TokenApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async list(): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const accessTokens = await this.#context.repositories.accessTokens.listForUser(identity.userId)
    return Response.json({ tokens: accessTokens.map(accessToken => TokenApi.#tokenJson(accessToken)) })
  }

  async create(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const requestBody = await JsonBody.of(request)
    const lifetimeDays = TokenApi.#lifetimeDaysOf(requestBody)
    const plaintextToken = AccessTokenSecret.generate()
    const accessToken = await this.#context.repositories.accessTokens.create({
      userId: identity.userId,
      workspaceId: identity.membership.workspace.workspaceId,
      name: requestBody.text('name', MAX_TOKEN_NAME_LENGTH),
      tokenHash: await AccessTokenSecret.hashOf(plaintextToken),
      // Publishing is what most agents need; changing who can see an artifact takes a deliberate choice.
      scope: requestBody.oneOf('scope', ACCESS_TOKEN_SCOPES, 'publish'),
      expiresAt: lifetimeDays === null ? null : Date.now() + lifetimeDays * DAY,
    })
    // The plaintext leaves the server this once; only its hash is stored.
    return Response.json({ token: plaintextToken, ...TokenApi.#tokenJson(accessToken) }, { status: 201 })
  }

  async revoke(tokenId: string): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const revoked = await this.#context.repositories.accessTokens.revoke(tokenId, identity.userId)
    if (!revoked) throw HttpError.notFound(`active token ${tokenId}`)
    return new Response(null, { status: 204 })
  }

  /** null means the token never expires. */
  static #lifetimeDaysOf(requestBody: JsonBody): number | null {
    const expiresInDays = requestBody.raw('expiresInDays')
    if (expiresInDays === null) return null
    const isWholeDays = Number.isInteger(expiresInDays)
    const isOfferedLifetime = isWholeDays && (expiresInDays as number) >= 1 && (expiresInDays as number) <= MAX_LIFETIME_DAYS
    if (!isOfferedLifetime) throw HttpError.badRequest(`expiresInDays must be 1 to ${MAX_LIFETIME_DAYS}, or null for a token that never expires`)
    return expiresInDays as number
  }

  static #tokenJson(accessToken: AccessToken) {
    return {
      tokenId: accessToken.tokenId,
      name: accessToken.name,
      scope: accessToken.scope,
      workspaceId: accessToken.workspaceId,
      expiresAt: accessToken.expiresAt,
      revokedAt: accessToken.revokedAt,
      lastUsedAt: accessToken.lastUsedAt,
      createdAt: accessToken.createdAt,
    }
  }
}
