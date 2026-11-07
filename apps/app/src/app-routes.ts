import { SigningKey, UsercontentSignature } from '@open-artifact/core'
import { ArtifactGate } from './access/artifact-gate.ts'
import { ApiContext } from './api/api-context.ts'
import { ApiRoutes } from './api/api-routes.ts'
import { Admission } from './auth/admission.ts'
import type { Mailer } from './auth/mailer.ts'
import { OpenArtifactAuth } from './auth/open-artifact-auth.ts'
import { RequestIdentity } from './auth/request-identity.ts'
import type { AppEnv } from './env.ts'
import { HttpError, RemovedFromWorkspaceError } from './http-error.ts'
import { MessagePages } from './pages/message-pages.ts'
import { PageRoutes } from './pages/page-routes.ts'
import { People } from './people.ts'
import type { Repositories } from '@open-artifact/core'

const VIEWER = new URLPattern({ pathname: '/a/:artifactId' })
const FULL_VIEW = new URLPattern({ pathname: '/a/:artifactId/full' })
const UNLOCK = new URLPattern({ pathname: '/a/:artifactId/unlock' })
const SETTINGS = new URLPattern({ pathname: '/settings{/:section}?' })
const INVITE = new URLPattern({ pathname: '/invite/:inviteCode' })
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
    if (this.#isCrossSiteWrite(request, context)) return new HttpError(403, 'cross_site_request', 'send this request from the Open Artifact page').toResponse()
    if (requestUrl.pathname.startsWith('/api/')) return ApiRoutes.respond(request, context)
    try {
      return await this.#page(request, requestUrl, context)
    } catch (error) {
      if (error instanceof RemovedFromWorkspaceError) return MessagePages.removedFromWorkspace()
      throw error
    }
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
    // The unlock address only takes the form; opened directly it leads to the artifact, which asks again.
    if (unlockMatch) return new Response(null, { status: 303, headers: { Location: `/a/${unlockMatch.pathname.groups.artifactId ?? ''}` } })
    if (request.method !== 'GET' && request.method !== 'HEAD') return MessagePages.unknownAddress(405)
    if (requestUrl.pathname === '/') return pageRoutes.home(request)
    if (requestUrl.pathname === '/login') return pageRoutes.login(request)
    if (requestUrl.pathname === '/llms.txt') return pageRoutes.llmsTxt()
    const viewerMatch = VIEWER.exec(requestUrl)
    if (viewerMatch) return pageRoutes.viewer(request, decodeURIComponent(viewerMatch.pathname.groups.artifactId ?? ''))
    const fullViewMatch = FULL_VIEW.exec(requestUrl)
    if (fullViewMatch) return pageRoutes.fullView(request, decodeURIComponent(fullViewMatch.pathname.groups.artifactId ?? ''))
    const inviteMatch = INVITE.exec(requestUrl)
    if (inviteMatch) return pageRoutes.invite(request, decodeURIComponent(inviteMatch.pathname.groups.inviteCode ?? ''))
    const settingsMatch = SETTINGS.exec(requestUrl)
    if (settingsMatch) return pageRoutes.settings(request, settingsMatch.pathname.groups.section)
    return MessagePages.unknownAddress(404)
  }

  #contextFor(request: Request, appOrigin: string): ApiContext {
    const { env, repositories, mailer } = this.#dependencies
    const admission = new Admission(env.ALLOWED_EMAIL_DOMAINS, repositories)
    const auth = new OpenArtifactAuth(env, appOrigin, mailer, repositories, admission)
    return new ApiContext({
      repositories,
      gate: new ArtifactGate(repositories, this.#signingKey, Date.now()),
      requestIdentity: new RequestIdentity(auth, repositories, admission, request),
      people: new People(repositories.users),
      mailer,
      auth,
      admission,
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
