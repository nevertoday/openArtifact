import { env } from 'cloudflare:workers'
import { AppRoutes } from '../src/app-routes.ts'
import type { Mailer, OutgoingEmail } from '../src/auth/mailer.ts'
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
}

export class TestApp {
  readonly mailer = new RecordingMailer()
  readonly repositories = cloudflareRepositories(env.DB, env.FILES)
  readonly routes: AppRoutes

  constructor(options: { allowedEmailDomains?: string } = { allowedEmailDomains: 'example.com' }) {
    const appEnv: AppEnv = {
      DB: env.DB,
      FILES: env.FILES,
      UNLOCK_RATE_LIMITER: env.UNLOCK_RATE_LIMITER,
      ...(options.allowedEmailDomains === undefined ? {} : { ALLOWED_EMAIL_DOMAINS: options.allowedEmailDomains }),
      USERCONTENT_ORIGIN,
      MCP_ORIGIN: 'http://mcp.test',
      BETTER_AUTH_SECRET: 'test-better-auth-secret-of-enough-length',
      USERCONTENT_SIGNING_KEY: SIGNING_KEY,
    }
    this.routes = new AppRoutes({ env: appEnv, repositories: this.repositories, mailer: this.mailer, mcpUrl: 'http://mcp.test/mcp' })
  }

  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const method = options.method ?? 'GET'
    const headers = new Headers()
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

  /** Signs in through the emailed link, exactly as a person does, and returns the session cookie. */
  async signIn(email: string): Promise<string> {
    const sendResponse = await this.request('/api/auth/sign-in/magic-link', { method: 'POST', body: { email, callbackURL: '/' } })
    if (!sendResponse.ok) throw new Error(`magic link request failed: ${sendResponse.status} ${await sendResponse.text()}`)
    const signInLink = this.mailer.lastTo(email)?.text.match(/https?:\/\/\S+/)?.[0]
    if (!signInLink) throw new Error(`no sign-in link was mailed to ${email}`)
    const verifyResponse = await this.routes.respond(new Request(signInLink, { redirect: 'manual' }))
    const sessionCookie = verifyResponse.headers.getSetCookie().map(setCookie => setCookie.split(';')[0]).join('; ')
    if (!sessionCookie.includes('session_token')) throw new Error(`sign-in did not set a session: ${verifyResponse.status}`)
    return sessionCookie
  }

  async createToken(cookie: string, name = 'Claude Code · laptop'): Promise<string> {
    const { body } = await this.json<{ token: string }>('/api/tokens', { method: 'POST', cookie, body: { name, expiresInDays: 30 } })
    return body.token
  }

  async publish(caller: Caller, title: string, page = '<h1>hello</h1>', visibility?: string): Promise<{ artifactId: string; version: number; url: string }> {
    const { status, body } = await this.json<{ artifactId: string; version: number; url: string }>('/api/artifacts', {
      ...caller,
      method: 'POST',
      body: { title, visibility, files: [{ path: 'index.html', content: page }] },
    })
    if (status !== 201) throw new Error(`publish failed with ${status}: ${JSON.stringify(body)}`)
    return body
  }
}
