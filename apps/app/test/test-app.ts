import { env } from 'cloudflare:workers'
import { AppRoutes } from '../src/app-routes.ts'
import type { Mailer, OutgoingEmail } from '../src/auth/mailer.ts'
import type { TitleTranslator } from '../src/api/title-translator.ts'
import type { AppEnv } from '../src/env.ts'
import { cloudflareRepositories } from '@open-artifact/storage-cloudflare'

export const APP_ORIGIN = 'http://app.test'
export const USERCONTENT_ORIGIN = 'http://usercontent.test'
export const SIGNING_KEY = 'test-signing-key-that-is-long-enough'

/** Keeps sent mail in memory, so tests can follow the sign-in link. */
export class RecordingMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []
  #outOfService = false

  async send(email: OutgoingEmail): Promise<void> {
    if (this.#outOfService) throw new Error('mail service unavailable')
    this.sent.push(email)
  }

  /** Every later send fails, as when no mail service is configured or the provider is down. */
  goOutOfService(): void {
    this.#outOfService = true
  }

  lastTo(address: string): OutgoingEmail | undefined {
    return this.sent.filter(email => email.to === address).at(-1)
  }
}

/** Answers every translation with `english`, null by default as without Workers AI, and keeps the titles asked about. */
export class RecordingTranslator implements TitleTranslator {
  readonly asked: string[] = []
  english: string | null = null

  async toEnglish(title: string): Promise<string | null> {
    this.asked.push(title)
    return this.english
  }
}

export interface Caller {
  /** Session cookie of a signed-in person, or an API token. */
  cookie?: string
  token?: string
  agentClient?: string
  /** Defaults to the app's origin for writes, as a browser on our own page would send. */
  origin?: string | null
}

export interface RequestOptions extends Caller {
  method?: string
  body?: unknown
  form?: Record<string, string>
  headers?: Record<string, string>
}

export class TestApp {
  readonly mailer = new RecordingMailer()
  readonly translator = new RecordingTranslator()
  readonly repositories = cloudflareRepositories(env.DB, env.FILES)
  readonly routes: AppRoutes

  /**
   * Tests sign the same people in many times a minute, so sign-in links are limited loosely unless
   * `productionSignInLimits` asks for the limits the app is deployed with.
   */
  constructor(options: { allowedEmailDomains?: string; productionSignInLimits?: boolean } = { allowedEmailDomains: 'example.com' }) {
    const appEnv: AppEnv = {
      DB: env.DB,
      FILES: env.FILES,
      UNLOCK_RATE_LIMITER: env.UNLOCK_RATE_LIMITER,
      SIGN_IN_EMAIL_RATE_LIMITER: options.productionSignInLimits ? env.SIGN_IN_EMAIL_RATE_LIMITER : env.LOOSE_SIGN_IN_RATE_LIMITER,
      SIGN_IN_ADDRESS_RATE_LIMITER: options.productionSignInLimits ? env.SIGN_IN_ADDRESS_RATE_LIMITER : env.LOOSE_SIGN_IN_RATE_LIMITER,
      ...(options.allowedEmailDomains === undefined ? {} : { ALLOWED_EMAIL_DOMAINS: options.allowedEmailDomains }),
      USERCONTENT_ORIGIN,
      MCP_ORIGIN: 'http://mcp.test',
      BETTER_AUTH_SECRET: 'test-better-auth-secret-of-enough-length',
      USERCONTENT_SIGNING_KEY: SIGNING_KEY,
      // Tests assert Chinese wording, so they hold the default language fixed whatever a deployment sets.
      DEFAULT_LOCALE: 'zh-CN',
    }
    this.routes = new AppRoutes({ env: appEnv, repositories: this.repositories, mailer: this.mailer, titleTranslator: this.translator, mcpUrl: 'http://mcp.test/mcp' })
  }

  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const method = options.method ?? 'GET'
    const headers = new Headers(options.headers)
    if (options.cookie) headers.set('Cookie', options.cookie)
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
    if (options.agentClient) headers.set('X-Open-Artifact-Client', options.agentClient)
    const origin = options.origin === undefined ? (method === 'GET' ? null : APP_ORIGIN) : options.origin
    if (origin) headers.set('Origin', origin)
    let body: BodyInit | null = null
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(options.body)
    } else if (options.form) {
      body = new URLSearchParams(options.form)
      headers.set('Content-Type', 'application/x-www-form-urlencoded')
    }
    return this.routes.respond(new Request(`${APP_ORIGIN}${path}`, { method, headers, body, redirect: 'manual' }))
  }

  async json<Body>(path: string, options: RequestOptions = {}): Promise<{ status: number; body: Body }> {
    const response = await this.request(path, options)
    return { status: response.status, body: (await response.json()) as Body }
  }

  /**
   * Signs in through the emailed link, exactly as a person does, and returns the session cookie.
   * `browserCookie` is what the browser already holds, such as the cookie an invite link set.
   */
  async signIn(email: string, browserCookie?: string): Promise<string> {
    const sendResponse = await this.request('/api/auth/sign-in/magic-link', { method: 'POST', body: { email, callbackURL: '/' }, ...(browserCookie ? { cookie: browserCookie } : {}) })
    if (!sendResponse.ok) throw new Error(`magic link request failed: ${sendResponse.status} ${await sendResponse.text()}`)
    const signInLink = this.mailer.lastTo(email)?.text.match(/https?:\/\/\S+/)?.[0]
    if (!signInLink) throw new Error(`no sign-in link was mailed to ${email}`)
    const verifyHeaders = new Headers(browserCookie ? { Cookie: browserCookie } : {})
    const verifyResponse = await this.routes.respond(new Request(signInLink, { redirect: 'manual', headers: verifyHeaders }))
    const sessionCookie = verifyResponse.headers.getSetCookie().map(setCookie => setCookie.split(';')[0]).join('; ')
    if (!sessionCookie.includes('session_token')) throw new Error(`sign-in did not set a session: ${verifyResponse.status}`)
    return sessionCookie
  }

  async createToken(cookie: string, scope: 'publish' | 'full' = 'publish', name = 'Claude Code · laptop'): Promise<string> {
    const { body } = await this.json<{ token: string }>('/api/tokens', { method: 'POST', cookie, body: { name, expiresInDays: 30, scope } })
    return body.token
  }

  /** Adds or changes one person's grant the way the share dialog saves it: the whole grant list in one request. */
  async grant(cookie: string, artifactId: string, email: string, role: 'viewer' | 'commenter' | 'editor'): Promise<Response> {
    const sharingPath = `/api/artifacts/${encodeURIComponent(artifactId)}/sharing`
    const person = await this.json<{ userId: string }>(`${sharingPath}/people?email=${encodeURIComponent(email)}`, { cookie })
    if (person.status !== 200) throw new Error(`no person to grant: ${person.status} ${JSON.stringify(person.body)}`)
    const sharing = await this.json<{ grants: { userId: string; role: string }[] }>(sharingPath, { cookie })
    const otherGrants = sharing.body.grants.filter(grant => grant.userId !== person.body.userId).map(grant => ({ userId: grant.userId, role: grant.role }))
    return this.request(sharingPath, { method: 'PUT', cookie, body: { grants: [...otherGrants, { userId: person.body.userId, role }] } })
  }

  /** `path` is the artifact's address on the app, the path of the returned `url`. */
  async publish(caller: Caller, title: string, page = '<h1>hello</h1>', visibility?: string): Promise<{ artifactId: string; version: number; url: string; path: string }> {
    const { status, body } = await this.json<{ artifactId: string; version: number; url: string }>('/api/artifacts', {
      ...caller,
      method: 'POST',
      body: { title, visibility, files: [{ path: 'index.html', content: page }] },
    })
    if (status !== 201) throw new Error(`publish failed with ${status}: ${JSON.stringify(body)}`)
    return { ...body, path: new URL(body.url).pathname }
  }
}
