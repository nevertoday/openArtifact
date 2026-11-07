import { CommentThread, PublicLinkPassword, type Invite } from '@open-artifact/core'
import { ArtifactGate, type OpenedArtifact } from '../access/artifact-gate.ts'
import type { ApiContext } from '../api/api-context.ts'
import { INVITE_COOKIE } from '../auth/admission.ts'
import { WORKSPACE_COOKIE, type Identity } from '../auth/request-identity.ts'
import { AgentGuide } from '../guide/agent-guide.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HOME_FILTERS, HomeListing, HomePage, type HomeFilter } from './home-page.ts'
import { LoginPage } from './login-page.ts'
import { MessagePages, type PasswordPrompt } from './message-pages.ts'
import { SettingsPage, type WorkspaceAdministration } from './settings-page.ts'
import { SETTINGS_SECTIONS, type SettingsSection } from './settings-sections.ts'
import { ViewerPage, type OlderVersion, type ViewerModel } from './viewer-page.ts'

const UNLOCK_COOKIE_SECONDS = 30 * 24 * 60 * 60
const MAX_LIVE_PREVIEWS = 12
const AUDIT_EVENTS_SHOWN = 50
const YEAR_SECONDS = 365 * 24 * 60 * 60

export interface PageRouteSettings {
  usercontentOrigin: string
  mcpUrl: string
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
    return LoginPage.render(this.#context.auth.loginProviders, nextPath)
  }

  /**
   * Where an invite link lands. A visitor signs in first, with the invite kept in a cookie for sign-up;
   * a signed-in person joins the invite's workspace and goes home, switched to it.
   */
  async invite(request: Request, inviteCode: string): Promise<Response> {
    const invite = await this.#context.repositories.invites.findPendingByCode(inviteCode, Date.now())
    if (!invite) return MessagePages.inviteUnusable()
    const identity = await this.#context.identity()
    if (!identity) return this.#inviteLogin(request, invite)
    const acceptance = await this.#context.admission.accept(invite, identity)
    switch (acceptance.status) {
      case 'joined':
      case 'already_member':
        return this.#homeIn(request, invite.workspaceId)
      case 'removed':
        return MessagePages.removedFromWorkspace()
      case 'other_address':
        return MessagePages.inviteForOtherAddress(acceptance.invitedEmail)
    }
  }

  async #inviteLogin(request: Request, invite: Invite): Promise<Response> {
    const [inviterNames, workspace] = await Promise.all([this.#context.people.namesOf([invite.invitedBy]), this.#context.repositories.workspaces.findWorkspace(invite.workspaceId)])
    if (!workspace) throw new Error(`Invite ${invite.inviteId} names workspace ${invite.workspaceId}, which does not exist`)
    const invitation = { inviterName: inviterNames.get(invite.invitedBy) ?? '', workspaceName: workspace.name, email: invite.email }
    const invitePath = new URL(request.url).pathname
    const loginPage = LoginPage.render(this.#context.auth.loginProviders, invitePath, invitation)
    const secondsLeft = Math.ceil((invite.expiresAt - Date.now()) / 1000)
    loginPage.headers.append('Set-Cookie', HttpCookies.serialize(INVITE_COOKIE, invite.code, { maxAgeSeconds: secondsLeft }, this.#isSecure(request)))
    return loginPage
  }

  #homeIn(request: Request, workspaceId: string): Response {
    const workspaceCookie = HttpCookies.serialize(WORKSPACE_COOKIE, workspaceId, { maxAgeSeconds: YEAR_SECONDS }, this.#isSecure(request))
    return new Response(null, { status: 302, headers: { Location: new URL('/', this.#context.appOrigin).toString(), 'Set-Cookie': workspaceCookie } })
  }

  #isSecure(request: Request): boolean {
    return new URL(request.url).protocol === 'https:'
  }

  async home(request: Request): Promise<Response> {
    const identity = await this.#context.identity()
    if (!identity) return this.#redirectToLogin(request)
    const searchParams = new URL(request.url).searchParams
    const [workspaceArtifacts, openThreadComments, grantsOfUser] = await Promise.all([
      this.#context.gate.listWorkspace(identity),
      this.#context.repositories.comments.listInOpenThreads(identity.membership.workspace.workspaceId),
      this.#context.repositories.artifactAccess.listGrantsOfUser(identity.userId),
    ])
    const listing = new HomeListing(workspaceArtifacts, identity, CommentThread.allOf(openThreadComments), new Set(grantsOfUser.map(grant => grant.artifactId)))
    const requestedFilter = searchParams.get('filter')
    const query = {
      filter: HOME_FILTERS.find(filter => filter === requestedFilter) ?? ('all' as HomeFilter),
      agent: searchParams.get('agent'),
      search: searchParams.get('q') ?? '',
    }
    const authorNames = await this.#context.people.namesOf(listing.peopleIds())
    const previewUrls = await this.#previewUrls(listing.matching(query, authorNames))
    const justRemoved = listing.restorable(searchParams.get('removed'))
    return HomePage.render({ identity, listing, query, authorNames, previewUrls, justRemoved, usercontentOrigin: this.#settings.usercontentOrigin, now: Date.now() })
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
    if (!openedArtifact) return MessagePages.notFound(identity ? null : PageRoutes.#pathOf(request))
    if (!openedArtifact.permissions.canView) return this.#refusal(request, openedArtifact, identity)
    const requestedVersion = Number(new URL(request.url).searchParams.get('v') ?? openedArtifact.summary.version)
    const versionExists = Number.isInteger(requestedVersion) && requestedVersion >= 1 && requestedVersion <= openedArtifact.summary.version
    const shownVersion = versionExists ? requestedVersion : openedArtifact.summary.version
    const showsOlderVersion = shownVersion !== openedArtifact.summary.version
    if (showsOlderVersion && !openedArtifact.permissions.canSeeVersions) return identity ? MessagePages.notFound(null) : this.#redirectToLogin(request)
    const now = Date.now()
    const authorNames = await this.#context.people.namesOf([openedArtifact.summary.authorId])
    return {
      openedArtifact,
      identity,
      authorName: authorNames.get(openedArtifact.summary.authorId) ?? '',
      shownVersion,
      olderVersion: shownVersion === openedArtifact.summary.version ? null : await this.#olderVersion(artifactId, shownVersion),
      artifactUrl: await this.#context.artifactPages.entryPageUrl(artifactId, shownVersion, now),
      usercontentOrigin: this.#settings.usercontentOrigin,
      now,
    }
  }

  async #olderVersion(artifactId: string, version: number): Promise<OlderVersion> {
    const versionHistory = await this.#context.repositories.artifacts.listVersions(artifactId)
    const versionRecord = versionHistory.find(candidate => candidate.version === version)
    if (!versionRecord) throw new Error(`Version ${version} of artifact ${artifactId} is missing from its history`)
    const authorNames = await this.#context.people.namesOf([versionRecord.authorId])
    return { version, authorName: authorNames.get(versionRecord.authorId) ?? '', publishedAt: versionRecord.createdAt }
  }

  async unlock(request: Request, artifactId: string): Promise<Response> {
    const summary = await this.#context.repositories.artifacts.findSummary(artifactId)
    const passwordHash = summary?.sharing.publicLinkPasswordHash ?? null
    if (!summary || passwordHash === null) return MessagePages.notFound(`/a/${encodeURIComponent(artifactId)}`)
    // Each guess costs a PBKDF2 run, so guessing is limited per visitor and artifact.
    const visitorAddress = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success: withinAttemptLimit } = await this.#settings.unlockRateLimiter.limit({ key: `${artifactId}:${visitorAddress}` })
    if (!withinAttemptLimit) return PageRoutes.#backToPasswordPrompt(artifactId, 'wait')
    const formData = await request.formData()
    const password = String(formData.get('password') ?? '')
    if (!(await PublicLinkPassword.verify(password, passwordHash))) return PageRoutes.#backToPasswordPrompt(artifactId, 'wrong')
    const unlockCookie = HttpCookies.serialize(
      ArtifactGate.unlockCookieName(artifactId),
      await this.#context.gate.unlockCookieValue(summary),
      { maxAgeSeconds: UNLOCK_COOKIE_SECONDS, path: '/' },
      new URL(request.url).protocol === 'https:',
    )
    return new Response(null, { status: 303, headers: { Location: `/a/${encodeURIComponent(artifactId)}`, 'Set-Cookie': unlockCookie } })
  }

  /** Reloading the result shows the prompt again instead of resubmitting the password. */
  static #backToPasswordPrompt(artifactId: string, prompt: Exclude<PasswordPrompt, 'ask'>): Response {
    return new Response(null, { status: 303, headers: { Location: `/a/${encodeURIComponent(artifactId)}?password=${prompt}` } })
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
    const now = Date.now()
    const previewedArtifacts = shownArtifacts.filter(openedArtifact => openedArtifact.permissions.canView).slice(0, MAX_LIVE_PREVIEWS)
    const previewUrls = await Promise.all(
      previewedArtifacts.map(async ({ summary }) => {
        const entryPageUrl = await this.#context.artifactPages.entryPageUrl(summary.artifactId, summary.version, now)
        return [summary.artifactId, `${entryPageUrl}?preview`] as const
      }),
    )
    return new Map(previewUrls)
  }

  llmsTxt(): Response {
    const guide = new AgentGuide(this.#context.appOrigin, this.#settings.mcpUrl)
    return new Response(guide.file('llms-txt').content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  async #settingsPage(identity: Identity, section: SettingsSection): Promise<Response> {
    const [accessTokens, members, administration] = await Promise.all([
      this.#context.repositories.accessTokens.listForUser(identity.userId),
      this.#context.repositories.workspaces.listMembers(identity.membership.workspace.workspaceId),
      section === 'workspace' ? this.#workspaceAdministration(identity) : null,
    ])
    const guideFiles = new AgentGuide(this.#context.appOrigin, this.#settings.mcpUrl).files()
    return SettingsPage.render({ identity, section, mcpUrl: this.#settings.mcpUrl, appOrigin: this.#context.appOrigin, accessTokens, guideFiles, members, administration, now: Date.now() })
  }

  // Only an admin sees every artifact's metadata and the audit log; a member gets null.
  async #workspaceAdministration(identity: Identity): Promise<WorkspaceAdministration | null> {
    if (identity.membership.role !== 'admin') return null
    const [artifacts, auditEvents] = await Promise.all([
      this.#context.gate.listWorkspace(identity),
      this.#context.repositories.auditLog.listLatest(identity.membership.workspace.workspaceId, AUDIT_EVENTS_SHOWN),
    ])
    const artifactPeople = artifacts.flatMap(({ summary }) => [summary.authorId, summary.removal?.removedBy ?? null])
    const [artifactNames, auditNames] = await Promise.all([this.#context.people.namesOf(artifactPeople), this.#context.people.namesInAuditEvents(auditEvents)])
    return { artifacts, auditEvents, names: new Map([...artifactNames, ...auditNames]) }
  }

  async #refusal(request: Request, openedArtifact: OpenedArtifact, identity: Identity | null): Promise<Response> {
    const { summary, permissions } = openedArtifact
    if (permissions.needsPublicLinkPassword) return MessagePages.publicLinkPassword(summary.artifactId, PageRoutes.#passwordPromptOf(request))
    if (!identity) return this.#redirectToLogin(request)
    if (!ArtifactGate.mayAskForAccess(openedArtifact, identity)) return MessagePages.notFound(null)
    const authorNames = await this.#context.people.namesOf([summary.authorId])
    return MessagePages.noAccess(summary.artifactId, authorNames.get(summary.authorId) ?? '')
  }

  static #passwordPromptOf(request: Request): PasswordPrompt {
    const requestedPrompt = new URL(request.url).searchParams.get('password')
    return requestedPrompt === 'wrong' || requestedPrompt === 'wait' ? requestedPrompt : 'ask'
  }

  static #pathOf(request: Request): string {
    const requestUrl = new URL(request.url)
    return requestUrl.pathname + requestUrl.search
  }

  #redirectToLogin(request: Request): Response {
    const loginUrl = new URL('/login', this.#context.appOrigin)
    loginUrl.searchParams.set('next', PageRoutes.#pathOf(request))
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
