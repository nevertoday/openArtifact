import { PublicLinkPassword, UsercontentSignature } from '@open-artifact/core'
import { ArtifactGate, type OpenedArtifact } from '../access/artifact-gate.ts'
import type { ApiContext } from '../api/api-context.ts'
import type { Identity } from '../auth/request-identity.ts'
import { AgentGuide } from '../guide/agent-guide.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HOME_FILTERS, HomeListing, HomePage, type HomeFilter } from './home-page.ts'
import { LoginPage } from './login-page.ts'
import { MessagePages } from './message-pages.ts'
import { SETTINGS_SECTIONS, SettingsPage, type SettingsSection } from './settings-page.ts'
import { ViewerPage, type ViewerModel } from './viewer-page.ts'

const SIGNED_URL_LIFETIME_MS = 6 * 60 * 60 * 1000
const UNLOCK_COOKIE_SECONDS = 30 * 24 * 60 * 60
const MAX_LIVE_PREVIEWS = 12

export interface PageRouteSettings {
  usercontentOrigin: string
  mcpUrl: string
  usercontentSignature: UsercontentSignature
  unlockRateLimiter: RateLimit
}

/** The web pages people open in the browser. */
export class PageRoutes {
  readonly #context: ApiContext
  readonly #settings: PageRouteSettings

  constructor(context: ApiContext, settings: PageRouteSettings) {
    this.#context = context
    this.#settings = settings
  }

  async login(request: Request): Promise<Response> {
    const nextPath = PageRoutes.#safeNextPath(new URL(request.url).searchParams.get('next'), this.#context.appOrigin)
    if (await this.#context.identity()) return Response.redirect(new URL(nextPath, this.#context.appOrigin).toString(), 302)
    return LoginPage.render(this.#context.auth.loginProviders, nextPath, new URL(this.#context.appOrigin).host)
  }

  async home(request: Request): Promise<Response> {
    const identity = await this.#context.identity()
    if (!identity) return this.#redirectToLogin(request)
    const searchParams = new URL(request.url).searchParams
    const [visibleArtifacts, waitingForAgent, grantsOfUser] = await Promise.all([
      this.#context.gate.listVisible(identity),
      this.#context.repositories.comments.countWaitingForAgent(identity.membership.workspace.workspaceId),
      this.#context.repositories.artifactAccess.listGrantsOfUser(identity.userId),
    ])
    const listing = new HomeListing(visibleArtifacts, identity, waitingForAgent, new Set(grantsOfUser.map(grant => grant.artifactId)))
    const requestedFilter = searchParams.get('filter')
    const query = {
      filter: HOME_FILTERS.find(filter => filter === requestedFilter) ?? ('all' as HomeFilter),
      agent: searchParams.get('agent'),
      search: searchParams.get('q') ?? '',
    }
    const authorNames = await this.#context.people.namesOf(visibleArtifacts.map(openedArtifact => openedArtifact.summary.authorId))
    const previewUrls = await this.#previewUrls(listing.matching(query))
    return HomePage.render({ identity, listing, query, authorNames, previewUrls, usercontentOrigin: this.#settings.usercontentOrigin, now: Date.now() })
  }

  async viewer(request: Request, artifactId: string): Promise<Response> {
    const viewing = await this.#viewing(request, artifactId)
    return viewing instanceof Response ? viewing : ViewerPage.render(viewing)
  }

  async fullView(request: Request, artifactId: string): Promise<Response> {
    const viewing = await this.#viewing(request, artifactId)
    return viewing instanceof Response ? viewing : ViewerPage.renderFull(viewing)
  }

  // Both pages decide access and sign a fresh file URL on every visit, so their addresses are safe to pass around.
  async #viewing(request: Request, artifactId: string): Promise<ViewerModel | Response> {
    const identity = await this.#context.identity()
    const openedArtifact = await this.#context.gate.open(artifactId, identity, request)
    if (!openedArtifact) return MessagePages.notFound(identity !== null)
    if (!openedArtifact.permissions.canView) return this.#refusal(request, artifactId, identity, openedArtifact.permissions.needsPublicLinkPassword)
    const requestedVersion = Number(new URL(request.url).searchParams.get('v') ?? openedArtifact.summary.version)
    const versionExists = Number.isInteger(requestedVersion) && requestedVersion >= 1 && requestedVersion <= openedArtifact.summary.version
    const shownVersion = versionExists ? requestedVersion : openedArtifact.summary.version
    const now = Date.now()
    const signedPrefix = await this.#settings.usercontentSignature.signedPrefix(artifactId, shownVersion, now + SIGNED_URL_LIFETIME_MS)
    const authorNames = await this.#context.people.namesOf([openedArtifact.summary.authorId])
    return {
      openedArtifact,
      identity,
      authorName: authorNames.get(openedArtifact.summary.authorId) ?? '',
      shownVersion,
      artifactUrl: `${this.#settings.usercontentOrigin}${signedPrefix}index.html`,
      usercontentOrigin: this.#settings.usercontentOrigin,
      now,
    }
  }

  async unlock(request: Request, artifactId: string): Promise<Response> {
    const summary = await this.#context.repositories.artifacts.findSummary(artifactId)
    const passwordHash = summary?.sharing.publicLinkPasswordHash ?? null
    if (!summary || passwordHash === null) return MessagePages.notFound(false)
    // Each guess costs a PBKDF2 run, so guessing is limited per visitor and artifact.
    const visitorAddress = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success: withinAttemptLimit } = await this.#settings.unlockRateLimiter.limit({ key: `${artifactId}:${visitorAddress}` })
    if (!withinAttemptLimit) return MessagePages.tooManyPasswordAttempts()
    const formData = await request.formData()
    const password = String(formData.get('password') ?? '')
    if (!(await PublicLinkPassword.verify(password, passwordHash))) return MessagePages.publicLinkPassword(artifactId, true)
    const unlockCookie = HttpCookies.serialize(
      ArtifactGate.unlockCookieName(artifactId),
      await this.#context.gate.unlockCookieValue(summary),
      { maxAgeSeconds: UNLOCK_COOKIE_SECONDS, path: '/' },
      new URL(request.url).protocol === 'https:',
    )
    return new Response(null, { status: 303, headers: { Location: `/a/${encodeURIComponent(artifactId)}`, 'Set-Cookie': unlockCookie } })
  }

  async settings(request: Request, requestedSection: string | undefined): Promise<Response> {
    const identity = await this.#context.identity()
    if (!identity || this.#context.requestIdentity.usesAccessToken) return this.#redirectToLogin(request)
    const section = SETTINGS_SECTIONS.find(candidate => candidate === requestedSection)
    if (!section) return Response.redirect(new URL('/settings/agents', this.#context.appOrigin).toString(), 302)
    return this.#settingsPage(identity, section)
  }

  // Live previews of the first cards stand in for screenshots; the rest keep their colour cover.
  async #previewUrls(shownArtifacts: OpenedArtifact[]): Promise<Map<string, string>> {
    const expiresAt = Date.now() + SIGNED_URL_LIFETIME_MS
    const previewedArtifacts = shownArtifacts.slice(0, MAX_LIVE_PREVIEWS)
    const previewUrls = await Promise.all(
      previewedArtifacts.map(async ({ summary }) => {
        const signedPrefix = await this.#settings.usercontentSignature.signedPrefix(summary.artifactId, summary.version, expiresAt)
        return [summary.artifactId, `${this.#settings.usercontentOrigin}${signedPrefix}index.html?preview`] as const
      }),
    )
    return new Map(previewUrls)
  }

  llmsTxt(): Response {
    const guide = new AgentGuide(this.#context.appOrigin, this.#settings.mcpUrl)
    return new Response(guide.file('llms-txt').content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  async #settingsPage(identity: Identity, section: SettingsSection): Promise<Response> {
    const [accessTokens, members] = await Promise.all([
      this.#context.repositories.accessTokens.listForUser(identity.userId),
      this.#context.repositories.workspaces.listMembers(identity.membership.workspace.workspaceId),
    ])
    const guideFiles = new AgentGuide(this.#context.appOrigin, this.#settings.mcpUrl).files()
    return SettingsPage.render({ identity, section, mcpUrl: this.#settings.mcpUrl, accessTokens, guideFiles, members })
  }

  #refusal(request: Request, artifactId: string, identity: Identity | null, needsPublicLinkPassword: boolean): Response {
    if (needsPublicLinkPassword) return MessagePages.publicLinkPassword(artifactId, false)
    if (!identity) return this.#redirectToLogin(request)
    return MessagePages.notFound(true)
  }

  #redirectToLogin(request: Request): Response {
    const requestUrl = new URL(request.url)
    const loginUrl = new URL('/login', this.#context.appOrigin)
    loginUrl.searchParams.set('next', requestUrl.pathname + requestUrl.search)
    return Response.redirect(loginUrl.toString(), 302)
  }

  // Resolved the way the browser will resolve it, so tricks like "/\t/evil.com" cannot lead off the site.
  static #safeNextPath(nextPath: string | null, appOrigin: string): string {
    if (nextPath === null) return '/'
    const resolvedUrl = new URL(nextPath, appOrigin)
    const staysOnSite = resolvedUrl.origin === appOrigin
    return staysOnSite ? resolvedUrl.pathname + resolvedUrl.search : '/'
  }
}
