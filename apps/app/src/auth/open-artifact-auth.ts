import { parseLocale, type Locale, type Repositories } from '@open-artifact/core'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { emailOTP, genericOAuth } from 'better-auth/plugins'
import type { AppEnv } from '../env.ts'
import { HttpCookies } from '../http-cookies.ts'
import { messagesFor, type Messages } from '../i18n/messages.ts'
import { fallbackLocaleOf, requestLocaleSignals, resolveLocale } from '../i18n/resolve-locale.ts'
import { Admission, INVITE_COOKIE } from './admission.ts'
import type { Mailer } from './mailer.ts'
import { SignInGuesses } from './sign-in-guesses.ts'

export interface SignedInUser {
  userId: string
  name: string
  email: string
  locale: Locale | null
}

export interface LoginProvider {
  providerId: string
  /** null for company SSO without a configured name; the login page words it in the reader's language. */
  label: string | null
  /** Generic OIDC providers sign in through a different Better Auth endpoint than built-in social ones. */
  kind: 'social' | 'oidc'
}

/** The request part of a Better Auth endpoint context, which its sign-up hooks receive. */
interface AuthEndpointContext {
  request?: Request | undefined
  headers?: Headers | undefined
}

// The part of Better Auth this app calls; its full inferred type is too wide to hold in a field.
interface BetterAuthInstance {
  handler(request: Request): Promise<Response>
  api: {
    getSession(context: { headers: Headers }): Promise<{ user: { id: string; name: string; email: string; locale?: string | null | undefined } } | null>
    updateUser(context: { headers: Headers; body: { name: string } }): Promise<unknown>
    createVerificationOTP(context: { body: { email: string; type: 'sign-in' } }): Promise<string>
  }
}

const SESSION_DAYS = 30
const OIDC_PROVIDER_ID = 'company-sso'
const SIGN_IN_CODE_MINUTES = 10
// Better Auth's own sender swallows every error the mail callback throws, so a refused address or a mail outage
// would still answer "sent". This app mails the code itself and leaves the plugin only the check at sign-in.
const UNUSED_EMAIL_OTP_PATHS = [
  '/email-otp/send-verification-otp',
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/request-password-reset',
  '/forget-password/email-otp',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
]

/** Sign-in for people: a code mailed to them always, GitHub, Google and company SSO when the deployment configures them. */
export class OpenArtifactAuth {
  /** Mails a sign-in code; the code is then checked at `CHECK_CODE_PATH`, which is Better Auth's. */
  static readonly SEND_CODE_PATH = '/api/auth/sign-in/send-code'
  static readonly CHECK_CODE_PATH = '/api/auth/sign-in/email-otp'

  readonly #auth: BetterAuthInstance
  readonly #loginProviders: LoginProvider[]
  readonly #admission: Admission
  readonly #repositories: Repositories
  readonly #mailer: Mailer
  readonly #fallbackLocale: Locale
  readonly #appOrigin: string
  readonly #guesses: SignInGuesses

  constructor(env: AppEnv, appOrigin: string, mailer: Mailer, repositories: Repositories, admission: Admission) {
    this.#loginProviders = OpenArtifactAuth.#configuredProviders(env)
    this.#fallbackLocale = fallbackLocaleOf(env)
    this.#appOrigin = appOrigin
    this.#guesses = new SignInGuesses(repositories.signInCodeFailures)
    this.#admission = admission
    this.#repositories = repositories
    this.#mailer = mailer
    this.#auth = betterAuth({
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: appOrigin,
      basePath: '/api/auth',
      session: { expiresIn: SESSION_DAYS * 24 * 60 * 60 },
      // Read with the session so every page knows the person's language without another query; set only through /locale.
      user: { additionalFields: { locale: { type: 'string', required: false, input: false } } },
      socialProviders: OpenArtifactAuth.#socialProviders(env),
      disabledPaths: UNUSED_EMAIL_OTP_PATHS,
      plugins: [
        emailOTP({
          otpLength: 6,
          expiresIn: SIGN_IN_CODE_MINUTES * 60,
          storeOTP: 'hashed',
          sendVerificationOTP: async () => {
            throw new Error(`sign-in codes are mailed through ${OpenArtifactAuth.SEND_CODE_PATH}`)
          },
        }),
        ...OpenArtifactAuth.#companySso(env),
      ],
      databaseHooks: {
        user: {
          create: {
            // OAuth and SSO sign-ups reach this hook without passing #sendSignInCode, so admission is checked here too.
            before: async (newUser, endpointContext) => {
              if (!(await this.#admission.mayCreateAccount(newUser.email, OpenArtifactAuth.#inviteCodeIn(endpointContext)))) throw OpenArtifactAuth.#refusal()
            },
            // Every person belongs to a workspace from their first sign-in on, so the first to sign up becomes its admin.
            // Pages shared with the address before it had an account open to the new person from now on.
            after: async (createdUser, endpointContext) => {
              const headers = OpenArtifactAuth.#headersOf(endpointContext)
              const firstWorkspaceName = this.requestMessages(headers, null).server.firstWorkspaceName
              await this.#admission.join({ userId: createdUser.id, email: createdUser.email }, OpenArtifactAuth.#inviteCodeIn(endpointContext), firstWorkspaceName)
              await this.#repositories.artifactAccess.claimPendingGrants(Admission.normalizedEmail(createdUser.email), createdUser.id)
            },
          },
        },
      },
      telemetry: { enabled: false },
    })
  }

  // A code is mailed only to a person who has an account or may create one, so a refused address hears why at once.
  async #sendSignInCode(request: Request): Promise<Response> {
    // Better Auth checks the origin of its own endpoints; without the same check another site could mail codes for us.
    if (request.headers.get('Origin') !== this.#appOrigin) return Response.json({ code: 'INVALID_ORIGIN', message: 'sign-in codes are asked for from this site only' }, { status: 403 })
    const email = await OpenArtifactAuth.#emailIn(request)
    if (!Admission.looksLikeEmail(email)) return Response.json({ code: 'INVALID_EMAIL', message: 'a valid email is required' }, { status: 400 })
    if (await this.#guesses.isLocked(email)) return OpenArtifactAuth.#lockedOut()
    const account = await this.#repositories.users.findByEmail(email)
    const mayCreateAccount = account !== null || (await this.#admission.mayCreateAccount(email, OpenArtifactAuth.#inviteCodeIn({ headers: request.headers })))
    if (!mayCreateAccount) return Response.json({ code: Admission.REFUSAL_CODE, message: Admission.REFUSAL }, { status: 403 })
    const code = await this.#auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } })
    const m = this.requestMessages(request.headers, account?.locale ?? null)
    try {
      await this.#mailer.send({ to: email, subject: m.mail.signIn.subject(code), text: m.mail.signIn.body({ code, minutes: SIGN_IN_CODE_MINUTES }) })
    } catch (error) {
      console.error('a sign-in code could not be mailed', error)
      return Response.json({ code: 'CODE_NOT_MAILED', message: 'the sign-in code could not be mailed; try again later' }, { status: 503 })
    }
    return Response.json({ success: true })
  }

  /** The language of a request that may come before anyone is signed in: `account` is the person's choice, if known. */
  requestMessages(headers: Headers | null, account: Locale | null): Messages {
    return messagesFor(resolveLocale({ account, ...requestLocaleSignals(headers), fallback: this.#fallbackLocale }))
  }

  get loginProviders(): LoginProvider[] {
    return this.#loginProviders
  }

  handle(request: Request): Promise<Response> {
    const path = request.method === 'POST' ? new URL(request.url).pathname : null
    if (path === OpenArtifactAuth.SEND_CODE_PATH) return this.#sendSignInCode(request)
    if (path === OpenArtifactAuth.CHECK_CODE_PATH) return this.#checkSignInCode(request)
    return this.#auth.handler(request)
  }

  // Better Auth checks the code; this counts the wrong ones across codes, which the plugin does only per code.
  async #checkSignInCode(request: Request): Promise<Response> {
    const email = await OpenArtifactAuth.#emailIn(request.clone())
    if (await this.#guesses.isLocked(email)) return OpenArtifactAuth.#lockedOut()
    const answer = await this.#auth.handler(request)
    if (answer.status === 400 || answer.status === 403) {
      const { code } = (await answer.clone().json().catch(() => ({}))) as { code?: unknown }
      if (code === 'INVALID_OTP' || code === 'TOO_MANY_ATTEMPTS') await this.#guesses.recordWrong(email)
    }
    return answer
  }

  static async #emailIn(request: Request): Promise<string> {
    const requestBody: unknown = await request.json().catch(() => null)
    const rawEmail = typeof requestBody === 'object' && requestBody !== null ? (requestBody as { email?: unknown }).email : null
    return typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  }

  static #lockedOut(): Response {
    return Response.json({ code: 'SIGN_IN_LOCKED', message: 'too many wrong codes for this email today; sign in another way or try again tomorrow' }, { status: 429 })
  }

  async signedInUser(request: Request): Promise<SignedInUser | null> {
    const session = await this.#auth.api.getSession({ headers: request.headers })
    if (!session) return null
    return { userId: session.user.id, name: session.user.name, email: session.user.email, locale: parseLocale(session.user.locale) }
  }

  async rename(request: Request, name: string): Promise<void> {
    await this.#auth.api.updateUser({ headers: request.headers, body: { name } })
  }

  static #refusal(): APIError {
    return new APIError('FORBIDDEN', { message: Admission.REFUSAL, code: Admission.REFUSAL_CODE })
  }

  static #inviteCodeIn(endpointContext: AuthEndpointContext | null | undefined): string | null {
    const headers = OpenArtifactAuth.#headersOf(endpointContext)
    return headers ? HttpCookies.read({ headers }, INVITE_COOKIE) : null
  }

  static #headersOf(endpointContext: AuthEndpointContext | null | undefined): Headers | null {
    return endpointContext?.request?.headers ?? endpointContext?.headers ?? null
  }

  static #socialProviders(env: AppEnv) {
    return {
      ...(OpenArtifactAuth.#githubConfigured(env) ? { github: { clientId: env.GITHUB_CLIENT_ID as string, clientSecret: env.GITHUB_CLIENT_SECRET as string } } : {}),
      ...(OpenArtifactAuth.#googleConfigured(env) ? { google: { clientId: env.GOOGLE_CLIENT_ID as string, clientSecret: env.GOOGLE_CLIENT_SECRET as string } } : {}),
    }
  }

  static #companySso(env: AppEnv) {
    if (!OpenArtifactAuth.#companySsoConfigured(env)) return []
    return [
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER_ID,
            discoveryUrl: env.OIDC_DISCOVERY_URL as string,
            clientId: env.OIDC_CLIENT_ID as string,
            clientSecret: env.OIDC_CLIENT_SECRET as string,
            scopes: ['openid', 'email', 'profile'],
            pkce: true,
          },
        ],
      }),
    ]
  }

  static #configuredProviders(env: AppEnv): LoginProvider[] {
    const providers: LoginProvider[] = []
    if (OpenArtifactAuth.#companySsoConfigured(env)) providers.push({ providerId: OIDC_PROVIDER_ID, label: env.OIDC_DISPLAY_NAME ?? null, kind: 'oidc' })
    if (OpenArtifactAuth.#githubConfigured(env)) providers.push({ providerId: 'github', label: 'GitHub', kind: 'social' })
    if (OpenArtifactAuth.#googleConfigured(env)) providers.push({ providerId: 'google', label: 'Google', kind: 'social' })
    return providers
  }

  static #companySsoConfigured(env: AppEnv): boolean {
    return Boolean(env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET)
  }

  static #githubConfigured(env: AppEnv): boolean {
    return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
  }

  static #googleConfigured(env: AppEnv): boolean {
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  }
}
