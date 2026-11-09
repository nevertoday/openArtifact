import { ArtifactPath, SigningKey, UsercontentSignature } from '@open-artifact/core'
import { ArtifactGate } from './access/artifact-gate.ts'
import { ArtifactPageAddress } from './access/artifact-page-address.ts'
import { operatorMailbox, type AbuseReporting } from './api/abuse-report-api.ts'
import { ApiContext } from './api/api-context.ts'
import { ApiRoutes } from './api/api-routes.ts'
import type { TitleTranslator } from './api/title-translator.ts'
import { Admission } from './auth/admission.ts'
import { SignInLimits } from './auth/sign-in-limits.ts'
import type { Mailer } from './auth/mailer.ts'
import { OpenArtifactAuth } from './auth/open-artifact-auth.ts'
import { RequestIdentity } from './auth/request-identity.ts'
import type { AppEnv } from './env.ts'
import { HttpError } from './http-error.ts'
import { fallbackLocaleOf, requestLocaleSignals } from './i18n/resolve-locale.ts'
import { MessagePages } from './pages/message-pages.ts'
import { PageRoutes } from './pages/page-routes.ts'
import type { CardRenderer } from './share/card-renderer.ts'
import { CardRoutes } from './share/card-routes.ts'
import type { Repositories } from '@open-artifact/core'

const VIEWER = new URLPattern({ pathname: '/a/:segment' })
const FULL_VIEW = new URLPattern({ pathname: '/a/:segment/full' })
const UNLOCK = new URLPattern({ pathname: '/a/:segment/unlock' })
const SETTINGS = new URLPattern({ pathname: '/settings{/:section}?' })
const INVITE = new URLPattern({ pathname: '/invite/:inviteCode' })
const PERSONAL_PAGE = new URLPattern({ pathname: '/@:handle' })
const ARTIFACT_CARD = new URLPattern({ pathname: '/a/:segment/card.png' })
const PERSONAL_PAGE_CARD = new URLPattern({ pathname: '/@:handle/card.png' })
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface AppDependencies {
  env: AppEnv
  repositories: Repositories
  mailer: Mailer
  titleTranslator: TitleTranslator
  /** Draws the pictures X shows for shared links. */
  cardRenderer: CardRenderer
  mcpUrl: string
}

export class AppRoutes {
  readonly #dependencies: AppDependencies
  readonly #signingKey: SigningKey
  readonly #artifactPages: ArtifactPageAddress
  readonly #signInLimits: SignInLimits
  readonly #abuseReporting: AbuseReporting

  constructor(dependencies: AppDependencies) {
    this.#dependencies = dependencies
    this.#signingKey = new SigningKey(dependencies.env.USERCONTENT_SIGNING_KEY)
    this.#artifactPages = new ArtifactPageAddress(dependencies.env.USERCONTENT_ORIGIN, new UsercontentSignature(this.#signingKey))
    this.#signInLimits = new SignInLimits({ byEmail: dependencies.env.SIGN_IN_EMAIL_RATE_LIMITER, byAddress: dependencies.env.SIGN_IN_ADDRESS_RATE_LIMITER })
    this.#abuseReporting = { mailbox: operatorMailbox(dependencies.env), senderLimiter: dependencies.env.REPORT_RATE_LIMITER, addressKey: this.#signingKey }
  }

  async respond(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname === '/health') return Response.json({ service: 'open-artifact-app', status: 'ok' })
    const context = this.#contextFor(request, requestUrl.origin)
    if (requestUrl.pathname.startsWith('/api/auth/')) return (await this.#signInLimits.refusalFor(request)) ?? context.auth.handle(request)
    if (this.#isCrossSiteWrite(request, context)) return new HttpError(403, 'cross_site_request', 'send this request from the Open Artifact page').toResponse()
    if (requestUrl.pathname.startsWith('/api/')) return ApiRoutes.respond(request, context)
    return this.#page(request, requestUrl, context)
  }

  async #page(request: Request, requestUrl: URL, context: ApiContext): Promise<Response> {
    const pageRoutes = new PageRoutes(context, {
      usercontentOrigin: this.#dependencies.env.USERCONTENT_ORIGIN,
      mcpUrl: this.#dependencies.mcpUrl,
      unlockRateLimiter: this.#dependencies.env.UNLOCK_RATE_LIMITER,
    })
    const unlockMatch = UNLOCK.exec(requestUrl)
    const unlockSegment = decodeURIComponent(unlockMatch?.pathname.groups.segment ?? '')
    if (unlockMatch && request.method === 'POST') return pageRoutes.unlock(request, unlockSegment)
    // The unlock address only takes the form; opened directly it leads to the artifact, which asks again.
    if (unlockMatch) return new Response(null, { status: 303, headers: { Location: ArtifactPath.atSegment(unlockSegment) } })
    if (requestUrl.pathname === '/locale' && request.method === 'POST') return pageRoutes.chooseLocale(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') return MessagePages.unknownAddress(await context.messages(), 405)
    if (requestUrl.pathname === '/') return pageRoutes.home(request)
    if (requestUrl.pathname === '/login') return pageRoutes.login(request)
    if (requestUrl.pathname === '/llms.txt') return pageRoutes.llmsTxt()
    const artifactCardMatch = ARTIFACT_CARD.exec(requestUrl)
    if (artifactCardMatch) return new CardRoutes(context, this.#dependencies.cardRenderer).article(request, decodeURIComponent(artifactCardMatch.pathname.groups.segment ?? ''))
    const personalPageCardMatch = PERSONAL_PAGE_CARD.exec(requestUrl)
    if (personalPageCardMatch) return new CardRoutes(context, this.#dependencies.cardRenderer).profile(request, decodeURIComponent(personalPageCardMatch.pathname.groups.handle ?? ''))
    const viewerMatch = VIEWER.exec(requestUrl)
    if (viewerMatch) return pageRoutes.viewer(request, decodeURIComponent(viewerMatch.pathname.groups.segment ?? ''))
    const fullViewMatch = FULL_VIEW.exec(requestUrl)
    if (fullViewMatch) return pageRoutes.fullView(request, decodeURIComponent(fullViewMatch.pathname.groups.segment ?? ''))
    const inviteMatch = INVITE.exec(requestUrl)
    if (inviteMatch) return pageRoutes.invite(request, decodeURIComponent(inviteMatch.pathname.groups.inviteCode ?? ''))
    const personalPageMatch = PERSONAL_PAGE.exec(requestUrl)
    if (personalPageMatch) return pageRoutes.personalPage(request, decodeURIComponent(personalPageMatch.pathname.groups.handle ?? ''))
    const settingsMatch = SETTINGS.exec(requestUrl)
    if (settingsMatch) return pageRoutes.settings(request, settingsMatch.pathname.groups.section)
    return MessagePages.unknownAddress(await context.messages(), 404)
  }

  #contextFor(request: Request, appOrigin: string): ApiContext {
    const { env, repositories, mailer, titleTranslator } = this.#dependencies
    const admission = new Admission(env.ALLOWED_EMAIL_DOMAINS, repositories)
    const auth = new OpenArtifactAuth(env, appOrigin, mailer, repositories, admission)
    return new ApiContext({
      repositories,
      gate: new ArtifactGate(repositories, this.#signingKey, Date.now()),
      requestIdentity: new RequestIdentity(auth, repositories, admission, request),
      mailer,
      auth,
      admission,
      appOrigin,
      artifactPages: this.#artifactPages,
      titleTranslator,
      abuseReporting: this.#abuseReporting,
      sharedDataWriteLimiter: env.SHARED_DATA_WRITE_RATE_LIMITER,
      localeSignals: { ...requestLocaleSignals(request.headers), fallback: fallbackLocaleOf(env) },
    })
  }

  // A browser sends the session cookie with any request; a write that does not come from our own pages is refused.
  // Requests carrying an API token are not affected, since another site cannot attach one.
  #isCrossSiteWrite(request: Request, context: ApiContext): boolean {
    if (!UNSAFE_METHODS.has(request.method) || context.requestIdentity.usesAccessToken) return false
    return request.headers.get('Origin') !== context.appOrigin
  }
}
