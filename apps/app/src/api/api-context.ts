import type { ArtifactGate } from '../access/artifact-gate.ts'
import type { ArtifactPageAddress } from '../access/artifact-page-address.ts'
import type { Admission } from '../auth/admission.ts'
import type { Mailer } from '../auth/mailer.ts'
import type { OpenArtifactAuth } from '../auth/open-artifact-auth.ts'
import { WORKSPACE_HEADER, type Identity, type RequestIdentity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import { Notifier } from '../notifications/notifier.ts'
import { People } from '../people.ts'
import { PersonalPages } from '../personal-pages.ts'
import { MailLimits } from './mail-limits.ts'
import { PublishLimits } from './publish-limits.ts'
import type { TitleTranslator } from './title-translator.ts'
import { ArtifactPath, type AddressedArtifact, type Locale, type Repositories } from '@open-artifact/core'
import { messagesFor, type Messages } from '../i18n/messages.ts'
import { resolveLocale, type LocaleSignals } from '../i18n/resolve-locale.ts'

export interface ApiContextFields {
  repositories: Repositories
  gate: ArtifactGate
  requestIdentity: RequestIdentity
  mailer: Mailer
  auth: OpenArtifactAuth
  admission: Admission
  appOrigin: string
  artifactPages: ArtifactPageAddress
  titleTranslator: TitleTranslator
  /** What the request says about language before anyone is identified; the account's choice is added later. */
  localeSignals: Omit<LocaleSignals, 'account'>
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
  readonly titleTranslator: TitleTranslator
  readonly mailLimits: MailLimits
  readonly publishLimits: PublishLimits
  readonly #localeSignals: Omit<LocaleSignals, 'account'>
  #locale: Promise<Locale> | null = null

  constructor(fields: ApiContextFields) {
    this.repositories = fields.repositories
    this.gate = fields.gate
    this.requestIdentity = fields.requestIdentity
    this.people = new People(fields.repositories.users, async () => (await this.messages()).server.deletedPerson)
    this.mailer = fields.mailer
    this.notifier = new Notifier(fields.repositories, fields.mailer, artifact => this.artifactUrl(artifact), fields.localeSignals.fallback)
    this.auth = fields.auth
    this.admission = fields.admission
    this.appOrigin = fields.appOrigin
    this.artifactPages = fields.artifactPages
    this.personalPages = new PersonalPages(fields.repositories, fields.appOrigin)
    this.titleTranslator = fields.titleTranslator
    this.mailLimits = new MailLimits(fields.repositories.outboundMail)
    this.publishLimits = new PublishLimits(fields.repositories.artifacts)
    this.#localeSignals = fields.localeSignals
  }

  /** The language this request is answered in. A request whose identity cannot be resolved still gets one. */
  locale(): Promise<Locale> {
    this.#locale ??= this.identity()
      .catch(() => null)
      .then(identity => resolveLocale({ account: identity?.locale ?? null, ...this.#localeSignals }))
    return this.#locale
  }

  async messages(): Promise<Messages> {
    return messagesFor(await this.locale())
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

  /**
   * The workspace cookie is shared by every tab, so a write from the browser must name the workspace its page showed.
   * A token always acts in its own workspace, and a request from nobody is left to the handler's 401.
   */
  async requireNamedWorkspace(request: Request): Promise<void> {
    if (this.requestIdentity.usesAccessToken) return
    const identity = await this.identity()
    if (identity === null) return
    if (request.headers.get(WORKSPACE_HEADER) !== identity.membership.workspace.workspaceId) {
      throw new HttpError(409, 'workspace_changed', 'another tab switched to a different workspace since this page loaded; reload the page and try again')
    }
  }

  inviteUrl(inviteCode: string): string {
    return `${this.appOrigin}/invite/${encodeURIComponent(inviteCode)}`
  }

  artifactUrl(artifact: AddressedArtifact): string {
    return `${this.appOrigin}${ArtifactPath.of(artifact)}`
  }
}
