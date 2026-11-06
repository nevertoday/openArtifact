import { SigningKey, UsercontentSignature } from '@open-artifact/core'
import { ArtifactGate } from './access/artifact-gate.ts'
import { ApiContext } from './api/api-context.ts'
import { ApiRoutes } from './api/api-routes.ts'
import type { Mailer } from './auth/mailer.ts'
import { OpenArtifactAuth } from './auth/open-artifact-auth.ts'
import { RequestIdentity } from './auth/request-identity.ts'
import type { AppEnv } from './env.ts'
import { HttpError } from './http-error.ts'
import { PageRoutes } from './pages/page-routes.ts'
import { People } from './people.ts'
import type { Repositories } from '@open-artifact/core'

const VIEWER = new URLPattern({ pathname: '/a/:artifactId' })
const UNLOCK = new URLPattern({ pathname: '/a/:artifactId/unlock' })
const SETTINGS = new URLPattern({ pathname: '/settings{/:section}?' })
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface AppDependencies {
  env: AppEnv
  repositories: Repositories
  mailer: Mailer
  mcpUrl: string
}

export class AppRoutes {
  readonly #dependencies: AppDependencies
  readonly #signingKey: SigningKey

  constructor(dependencies: AppDependencies) {
    this.#dependencies = dependencies
    this.#signingKey = new SigningKey(dependencies.env.USERCONTENT_SIGNING_KEY)
  }

  async respond(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/health') return Response.json({ service: 'open-artifact-app', status: 'ok' })
    const context = this.#contextFor(request, requestUrl.origin)
    if (requestUrl.pathname.startsWith('/api/auth/')) return context.auth.handle(request)
    if (this.#isCrossSiteWrite(request, context)) return HttpError.forbidden('send this request from the Open Artifact page').toResponse()
    if (requestUrl.pathname.startsWith('/api/')) return ApiRoutes.respond(request, context)
    return this.#page(request, requestUrl, context)
  }

  async #page(request: Request, requestUrl: URL, context: ApiContext): Promise<Response> {
    const pageRoutes = new PageRoutes(context, {
      usercontentOrigin: this.#dependencies.env.USERCONTENT_ORIGIN,
      mcpUrl: this.#dependencies.mcpUrl,
      usercontentSignature: new UsercontentSignature(this.#signingKey),
      unlockRateLimiter: this.#dependencies.env.UNLOCK_RATE_LIMITER,
    })
    const unlockMatch = UNLOCK.exec(requestUrl)
    if (unlockMatch && request.method === 'POST') return pageRoutes.unlock(request, decodeURIComponent(unlockMatch.pathname.groups.artifactId ?? ''))
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    if (requestUrl.pathname === '/') return pageRoutes.home(request)
    if (requestUrl.pathname === '/login') return pageRoutes.login(request)
    if (requestUrl.pathname === '/llms.txt') return pageRoutes.llmsTxt()
    const viewerMatch = VIEWER.exec(requestUrl)
    if (viewerMatch) return pageRoutes.viewer(request, decodeURIComponent(viewerMatch.pathname.groups.artifactId ?? ''))
    const settingsMatch = SETTINGS.exec(requestUrl)
    if (settingsMatch) return pageRoutes.settings(request, settingsMatch.pathname.groups.section)
    return new Response('Not found', { status: 404 })
  }

  #contextFor(request: Request, appOrigin: string): ApiContext {
    const { env, repositories, mailer } = this.#dependencies
    const auth = new OpenArtifactAuth(env, appOrigin, mailer, repositories)
    return new ApiContext({
      repositories,
      gate: new ArtifactGate(repositories, this.#signingKey, Date.now()),
      requestIdentity: new RequestIdentity(auth, repositories, request),
      people: new People(repositories.users),
      mailer,
      auth,
      appOrigin,
    })
  }

  // A browser sends the session cookie with any request; a write that does not come from our own pages is refused.
  // Requests carrying an API token are not affected, since another site cannot attach one.
  #isCrossSiteWrite(request: Request, context: ApiContext): boolean {
    if (!UNSAFE_METHODS.has(request.method) || context.requestIdentity.usesAccessToken) return false
    return request.headers.get('Origin') !== context.appOrigin
  }
}
