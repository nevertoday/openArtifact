import type { ArtifactGate } from '../access/artifact-gate.ts'
import type { ArtifactPageAddress } from '../access/artifact-page-address.ts'
import type { Admission } from '../auth/admission.ts'
import type { Mailer } from '../auth/mailer.ts'
import type { OpenArtifactAuth } from '../auth/open-artifact-auth.ts'
import type { Identity, RequestIdentity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import { Notifier } from '../notifications/notifier.ts'
import type { People } from '../people.ts'
import { PersonalPages } from '../personal-pages.ts'
import { ArtifactPath, type AddressedArtifact, type Repositories } from '@open-artifact/core'

export interface ApiContextFields {
  repositories: Repositories
  gate: ArtifactGate
  requestIdentity: RequestIdentity
  people: People
  mailer: Mailer
  auth: OpenArtifactAuth
  admission: Admission
  appOrigin: string
  artifactPages: ArtifactPageAddress
}

/** What every API handler of one request shares. */
export class ApiContext {
  readonly repositories: Repositories
  readonly gate: ArtifactGate
  readonly requestIdentity: RequestIdentity
  readonly people: People
  readonly notifier: Notifier
  /** For mail to addresses that have no account yet, such as invites; mail to people goes through the notifier. */
  readonly mailer: Mailer
  readonly auth: OpenArtifactAuth
  readonly admission: Admission
  readonly appOrigin: string
  readonly artifactPages: ArtifactPageAddress
  readonly personalPages: PersonalPages

  constructor(fields: ApiContextFields) {
    this.repositories = fields.repositories
    this.gate = fields.gate
    this.requestIdentity = fields.requestIdentity
    this.people = fields.people
    this.mailer = fields.mailer
    this.notifier = new Notifier(fields.repositories, fields.mailer, artifact => this.artifactUrl(artifact))
    this.auth = fields.auth
    this.admission = fields.admission
    this.appOrigin = fields.appOrigin
    this.artifactPages = fields.artifactPages
    this.personalPages = new PersonalPages(fields.repositories, fields.appOrigin)
  }

  identity(): Promise<Identity | null> {
    return this.requestIdentity.resolve()
  }

  async requireIdentity(): Promise<Identity> {
    const identity = await this.identity()
    if (!identity) throw await this.requestIdentity.unauthorized()
    return identity
  }

  /** Token management and account settings stay out of reach of a leaked API token. */
  async requireBrowserSession(): Promise<Identity> {
    if (this.requestIdentity.usesAccessToken) throw new HttpError(403, 'browser_session_required', 'you cannot manage this with an API token; sign in on the web page instead')
    return this.requireIdentity()
  }

  /** Workspace administration happens in the browser, by an admin of the current workspace. */
  async requireWorkspaceAdmin(action: string): Promise<Identity> {
    const identity = await this.requireBrowserSession()
    if (identity.membership.role !== 'admin') throw HttpError.adminRequired(action)
    return identity
  }

  inviteUrl(inviteCode: string): string {
    return `${this.appOrigin}/invite/${encodeURIComponent(inviteCode)}`
  }

  artifactUrl(artifact: AddressedArtifact): string {
    return `${this.appOrigin}${ArtifactPath.of(artifact)}`
  }
}
