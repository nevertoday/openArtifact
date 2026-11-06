import type { Repositories } from '@open-artifact/core'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { genericOAuth, magicLink } from 'better-auth/plugins'
import type { AppEnv } from '../env.ts'
import { HttpCookies } from '../http-cookies.ts'
import { Admission, INVITE_COOKIE } from './admission.ts'
import type { Mailer } from './mailer.ts'

export interface SignedInUser {
  userId: string
  name: string
  email: string
}

export interface LoginProvider {
  providerId: string
  label: string
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
    getSession(context: { headers: Headers }): Promise<{ user: { id: string; name: string; email: string } } | null>
    updateUser(context: { headers: Headers; body: { name: string } }): Promise<unknown>
  }
}

const SESSION_DAYS = 30
const OIDC_PROVIDER_ID = 'company-sso'

/** Sign-in for people: email link always, GitHub, Google and company SSO when the deployment configures them. */
export class OpenArtifactAuth {
  readonly #auth: BetterAuthInstance
  readonly #loginProviders: LoginProvider[]
  readonly #admission: Admission
  readonly #repositories: Repositories
  readonly #mailer: Mailer

  constructor(env: AppEnv, appOrigin: string, mailer: Mailer, repositories: Repositories, admission: Admission) {
    this.#loginProviders = OpenArtifactAuth.#configuredProviders(env)
    this.#admission = admission
    this.#repositories = repositories
    this.#mailer = mailer
    this.#auth = betterAuth({
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: appOrigin,
      basePath: '/api/auth',
      session: { expiresIn: SESSION_DAYS * 24 * 60 * 60 },
      socialProviders: OpenArtifactAuth.#socialProviders(env),
      plugins: [
        magicLink({ sendMagicLink: ({ email, url }, endpointContext) => this.#sendSignInLink(email, url, endpointContext) }),
        ...OpenArtifactAuth.#companySso(env),
      ],
      databaseHooks: {
        user: {
          create: {
            // OAuth and SSO sign-ups reach this hook without passing #sendSignInLink, so admission is checked here too.
            before: async (newUser, endpointContext) => {
              if (!(await this.#admission.mayCreateAccount(newUser.email, OpenArtifactAuth.#inviteCodeIn(endpointContext)))) throw OpenArtifactAuth.#refusal()
            },
            // Every person belongs to a workspace from their first sign-in on, so the first to sign up becomes its admin.
            after: async (createdUser, endpointContext) => {
              await this.#admission.join({ userId: createdUser.id, email: createdUser.email }, OpenArtifactAuth.#inviteCodeIn(endpointContext))
            },
          },
        },
      },
      telemetry: { enabled: false },
    })
  }

  // A link is mailed only to a person who has an account or may create one, so a refused address hears why at once.
  async #sendSignInLink(email: string, url: string, endpointContext: AuthEndpointContext | null | undefined): Promise<void> {
    const hasAccount = (await this.#repositories.users.findByEmail(email)) !== null
    const mayCreateAccount = hasAccount || (await this.#admission.mayCreateAccount(email, OpenArtifactAuth.#inviteCodeIn(endpointContext)))
    if (!mayCreateAccount) throw OpenArtifactAuth.#refusal()
    await this.#mailer.send({ to: email, subject: '登录 Open Artifact', text: `点下面的链接登录 Open Artifact，链接 5 分钟内有效：\n\n${url}\n\n如果不是你本人操作，忽略这封邮件即可。` })
  }

  get loginProviders(): LoginProvider[] {
    return this.#loginProviders
  }

  handle(request: Request): Promise<Response> {
    return this.#auth.handler(request)
  }

  async signedInUser(request: Request): Promise<SignedInUser | null> {
    const session = await this.#auth.api.getSession({ headers: request.headers })
    if (!session) return null
    return { userId: session.user.id, name: session.user.name, email: session.user.email }
  }

  async rename(request: Request, name: string): Promise<void> {
    await this.#auth.api.updateUser({ headers: request.headers, body: { name } })
  }

  static #refusal(): APIError {
    return new APIError('FORBIDDEN', { message: Admission.REFUSAL, code: Admission.REFUSAL_CODE })
  }

  static #inviteCodeIn(endpointContext: AuthEndpointContext | null | undefined): string | null {
    const headers = endpointContext?.request?.headers ?? endpointContext?.headers
    return headers ? HttpCookies.read({ headers }, INVITE_COOKIE) : null
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
    if (OpenArtifactAuth.#companySsoConfigured(env)) providers.push({ providerId: OIDC_PROVIDER_ID, label: env.OIDC_DISPLAY_NAME ?? '公司 SSO', kind: 'oidc' })
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
