import type { ArtifactVisibility } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import type { JsonBody } from './json-body.ts'

const DAY_MS = 24 * 60 * 60 * 1000
export const AGENT_PUBLIC_LINK_DAYS = 7

export interface PublicLinkChange {
  /** The visibility before the request; null when the request creates the artifact. */
  visibilityBefore: ArtifactVisibility | null
  visibilityAfter: ArtifactVisibility
  savedExpiresAt: number | null
  /** Put on the author's personal page, where it is meant to stay. */
  listedAfter: boolean
}

/**
 * When a public link expires, as one request sets it. A person on the web page always chooses. An agent that
 * opens a public link without saying when it should expire gets 7 days, so a link it forgets does not stay open,
 * unless it lists the artifact on the author's personal page, which is meant to last.
 */
export class PublicLinkExpiry {
  readonly expiresAt: number | null
  /** The 7-day expiry given to an agent that did not choose one, which the author should hear about; null otherwise. */
  readonly agentDefaultExpiresAt: number | null

  private constructor(expiresAt: number | null, agentDefaultExpiresAt: number | null) {
    this.expiresAt = expiresAt
    this.agentDefaultExpiresAt = agentDefaultExpiresAt
  }

  /** `publicLinkExpiresAt` in the body is a future time in milliseconds, or null for never; absent keeps the saved one. */
  static of(requestBody: JsonBody, identity: Identity, change: PublicLinkChange, now: number): PublicLinkExpiry {
    if (requestBody.has('publicLinkExpiresAt')) return new PublicLinkExpiry(PublicLinkExpiry.#requestedExpiry(requestBody, now), null)
    const isAgent = identity.agentClient !== null
    const opensPublicLink = change.visibilityAfter === 'public_link' && change.visibilityBefore !== 'public_link'
    if (isAgent && opensPublicLink && !change.listedAfter) {
      const agentDefaultExpiresAt = now + AGENT_PUBLIC_LINK_DAYS * DAY_MS
      return new PublicLinkExpiry(agentDefaultExpiresAt, agentDefaultExpiresAt)
    }
    // Keeping the saved expiry lets an author still save after the link has expired.
    return new PublicLinkExpiry(change.savedExpiresAt, null)
  }

  static #requestedExpiry(requestBody: JsonBody, now: number): number | null {
    const expiresAt = requestBody.raw('publicLinkExpiresAt')
    if (expiresAt === null) return null
    const isFutureTime = Number.isInteger(expiresAt) && (expiresAt as number) > now
    if (!isFutureTime) throw HttpError.badRequest('publicLinkExpiresAt must be a future time in milliseconds, or null for never')
    return expiresAt as number
  }
}
