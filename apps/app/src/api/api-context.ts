import type { ArtifactGate } from '../access/artifact-gate.ts'
import type { Mailer } from '../auth/mailer.ts'
import type { OpenArtifactAuth } from '../auth/open-artifact-auth.ts'
import type { Identity, RequestIdentity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import type { People } from '../people.ts'
import type { Repositories } from '@open-artifact/core'

export interface ApiContextFields {
  repositories: Repositories
  gate: ArtifactGate
  requestIdentity: RequestIdentity
  people: People
  mailer: Mailer
  auth: OpenArtifactAuth
  appOrigin: string
}

/** What every API handler of one request shares. */
export class ApiContext {
  readonly repositories: Repositories
  readonly gate: ArtifactGate
  readonly requestIdentity: RequestIdentity
  readonly people: People
  readonly mailer: Mailer
  readonly auth: OpenArtifactAuth
  readonly appOrigin: string

  constructor(fields: ApiContextFields) {
    this.repositories = fields.repositories
    this.gate = fields.gate
    this.requestIdentity = fields.requestIdentity
    this.people = fields.people
    this.mailer = fields.mailer
    this.auth = fields.auth
    this.appOrigin = fields.appOrigin
  }

  identity(): Promise<Identity | null> {
    return this.requestIdentity.resolve()
  }

  async requireIdentity(): Promise<Identity> {
    const identity = await this.identity()
    if (!identity) throw HttpError.unauthorized()
    return identity
  }

  /** Token management and account settings stay out of reach of a leaked API token. */
  async requireBrowserSession(): Promise<Identity> {
    if (this.requestIdentity.usesAccessToken) throw HttpError.forbidden('manage this with an API token; sign in on the web page instead')
    return this.requireIdentity()
  }

  /** Workspace administration happens in the browser, by an admin of the current workspace. */
  async requireWorkspaceAdmin(action: string): Promise<Identity> {
    const identity = await this.requireBrowserSession()
    if (identity.membership.role !== 'admin') throw HttpError.forbidden(`${action}; ask a workspace admin`)
    return identity
  }

  viewerUrl(artifactId: string): string {
    return `${this.appOrigin}/a/${encodeURIComponent(artifactId)}`
  }
}
