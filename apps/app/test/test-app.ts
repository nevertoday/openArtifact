import { env } from 'cloudflare:workers'
import { AppRoutes } from '../src/app-routes.ts'
import type { Mailer, OutgoingEmail } from '../src/auth/mailer.ts'
import type { TitleTranslator } from '../src/api/title-translator.ts'
import type { AppEnv } from '../src/env.ts'
import type { CardDrawing, CardRenderer } from '../src/share/card-renderer.ts'
import { cloudflareRepositories } from '@open-artifact/storage-cloudflare'

export const APP_ORIGIN = 'http://app.test'
export const USERCONTENT_ORIGIN = 'http://usercontent.test'
export const SIGNING_KEY = 'test-signing-key-that-is-long-enough'
const WORKSPACE_WRITE = /^\/api\/((workspace|tokens)(\/|$)|artifacts$)/

/** Keeps sent mail in memory, so tests can read the sign-in code. */
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

  /** The six digits in the last sign-in mail to `address`. */
  lastCodeTo(address: string): string {
    const code = this.lastTo(address)?.subject.match(/\d{6}/)?.[0]
    if (!code) throw new Error(`no sign-in code was mailed to ${address}`)
    return code
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

/** Keeps what it was asked to draw and answers with a stand-in PNG; `failing` makes every drawing throw. */
export class RecordingCardRenderer implements CardRenderer {
  readonly drawn: CardDrawing[] = []
  failing = false

  async render(drawing: CardDrawing): Promise<Uint8Array> {
    if (this.failing) throw new Error('fonts unavailable')
    this.drawn.push(drawing)
    return new TextEncoder().encode(`PNG ${JSON.stringify(drawing)}`)
  }
}

export interface Caller {
  /** Session cookie of a signed-in person, or an API token. */
  cookie?: string
  token?: string
  agentClient?: string
  /** Defaults to the app's origin for writes, as a browser on our own page would send. */
  origin?: string | null
  /**
   * The workspace a browser's page names on a write to the current workspace. Left out, it is the one the cookie
   * selects, as a page that is up to date sends; null sends none.
   */
  workspaceId?: string | null
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
  readonly cardRenderer = new RecordingCardRenderer()
  readonly repositories = cloudflareRepositories(env.DB, env.FILES)
  readonly routes: AppRoutes

  /**
   * Tests sign the same people in many times a minute, so sign-in codes are limited loosely unless
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
    this.routes = new AppRoutes({ env: appEnv, repositories: this.repositories, mailer: this.mailer, titleTranslator: this.translator, cardRenderer: this.cardRenderer, mcpUrl: 'http://mcp.test/mcp' })
  }

  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const method = options.method ?? 'GET'
    const headers = new Headers(options.headers)
    if (options.cookie) headers.set('Cookie', options.cookie)
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
    if (options.agentClient) headers.set('X-Open-Artifact-Client', options.agentClient)
    const origin = options.origin === undefined ? (method === 'GET' ? null : APP_ORIGIN) : options.origin
    if (origin) headers.set('Origin', origin)
    const workspaceId = options.workspaceId === undefined ? await this.#pageWorkspaceId(path, method, options) : options.workspaceId
    if (workspaceId) headers.set('X-Open-Artifact-Workspace', workspaceId)
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

  // What common.js reads off a fresh page: only browser writes to the current workspace need it.
  async #pageWorkspaceId(path: string, method: string, options: RequestOptions): Promise<string | null> {
    if (method === 'GET' || !options.cookie || options.token || !WORKSPACE_WRITE.test(path)) return null
    const me = await this.request('/api/me', { cookie: options.cookie })
    if (!me.ok) return null
    const { workspace } = (await me.json()) as { workspace: { workspaceId: string } }
    return workspace.workspaceId
  }

  async json<Body>(path: string, options: RequestOptions = {}): Promise<{ status: number; body: Body }> {
    const response = await this.request(path, options)
    return { status: response.status, body: (await response.json()) as Body }
  }

  /** Asks for a sign-in code to be mailed to `email`, as the login page does. */
  sendCode(email: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<Response> {
    return this.request('/api/auth/sign-in/send-code', { ...options, method: 'POST', body: { email } })
  }

  /** Types `code` into the login page; the answer sets the session cookie when the code is right. */
  enterCode(email: string, code: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<Response> {
    return this.request('/api/auth/sign-in/email-otp', { ...options, method: 'POST', body: { email, otp: code } })
  }

  /**
   * Signs in with the mailed code, exactly as a person does, and returns the session cookie.
   * `browserCookie` is what the browser already holds, such as the cookie an invite link set.
   */
  async signIn(email: string, browserCookie?: string, headers?: Record<string, string>): Promise<string> {
    const browser = { ...(browserCookie ? { cookie: browserCookie } : {}), ...(headers ? { headers } : {}) }
    const sendResponse = await this.sendCode(email, browser)
    if (!sendResponse.ok) throw new Error(`asking for a sign-in code failed: ${sendResponse.status} ${await sendResponse.text()}`)
    const checkResponse = await this.enterCode(email, this.mailer.lastCodeTo(email), browser)
    const sessionCookie = checkResponse.headers.getSetCookie().map(setCookie => setCookie.split(';')[0]).join('; ')
    if (!sessionCookie.includes('session_token')) throw new Error(`sign-in did not set a session: ${checkResponse.status} ${await checkResponse.text()}`)
    return sessionCookie
  }

  async createToken(cookie: string, scope: 'publish' | 'full' = 'publish', name = 'Claude Code · laptop'): Promise<string> {
    const { body } = await this.json<{ token: string }>('/api/tokens', { method: 'POST', cookie, body: { name, expiresInDays: 30, scope } })
    return body.token
  }

  /** Adds or changes one person's grant the way the share dialog saves it: the whole grant list in one request. */
  async grant(cookie: string, artifactId: string, email: string, role: 'viewer' | 'commenter' | 'editor'): Promise<Response> {
    const sharingPath = `/api/artifacts/${encodeURIComponent(artifactId)}/sharing`
    const sharing = await this.json<{ grants: { userId: string | null; email: string | null; role: string }[] }>(sharingPath, { cookie })
    const address = email.trim().toLowerCase()
    const otherGrants = sharing.body.grants.filter(grant => grant.email?.toLowerCase() !== address).map(grant => (grant.userId === null ? { email: grant.email, role: grant.role } : { userId: grant.userId, role: grant.role }))
    return this.request(sharingPath, { method: 'PUT', cookie, body: { grants: [...otherGrants, { email, role }] } })
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
