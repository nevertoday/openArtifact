import { ArtifactPath, CommentThread, parseLocale, PublicLinkPassword, WorkspaceDeletion, type ArtifactPage, type Invite } from '@open-artifact/core'
import { ArtifactGate, type OpenedArtifact } from '../access/artifact-gate.ts'
import type { ApiContext } from '../api/api-context.ts'
import { INVITE_COOKIE } from '../auth/admission.ts'
import { WORKSPACE_COOKIE, type Identity } from '../auth/request-identity.ts'
import { AgentGuide } from '../guide/agent-guide.ts'
import { PersonalPages } from '../personal-pages.ts'
import { HttpCookies } from '../http-cookies.ts'
import { HttpError } from '../http-error.ts'
import { LOCALE_COOKIE } from '../i18n/resolve-locale.ts'
import { HOME_FILTERS, HomeListing, HomePage, type HomeFilter } from './home-page.ts'
import { LoginPage } from './login-page.ts'
import { MessagePages, type PasswordPrompt } from './message-pages.ts'
import { PersonalPage } from './personal-page.ts'
import { ProfileShareCard, ShareCard } from '../share/share-card.ts'
import { SettingsPage, type WorkspaceAdministration } from './settings-page.ts'
import { SETTINGS_SECTIONS, type SettingsSection } from './settings-sections.ts'
import { ViewerPage, type Byline, type OlderVersion, type ViewerModel } from './viewer-page.ts'

const UNLOCK_COOKIE_SECONDS = 30 * 24 * 60 * 60
const MAX_LIVE_PREVIEWS = 12
const AUDIT_EVENTS_SHOWN = 50
const DAY_SECONDS = 24 * 60 * 60
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
    return LoginPage.render(await this.#context.messages(), this.#context.auth.loginProviders, nextPath)
  }

  /**
   * Where an invite link lands. A visitor signs in first, with the invite kept in a cookie for sign-up;
   * a signed-in person joins the invite's workspace and goes home, switched to it.
   */
  async invite(request: Request, inviteCode: string): Promise<Response> {
    const invite = await this.#context.repositories.invites.findPendingByCode(inviteCode, Date.now())
    if (!invite) return MessagePages.inviteUnusable(await this.#context.messages())
    const identity = await this.#context.identity()
    if (!identity) return this.#inviteLogin(request, invite)
    const acceptance = await this.#context.admission.accept(invite, identity)
    switch (acceptance.status) {
      case 'joined':
      case 'already_member':
        return this.#homeIn(request, invite.workspaceId)
      case 'removed':
        return MessagePages.removedFromWorkspace(await this.#context.messages())
      case 'other_address':
        return MessagePages.inviteForOtherAddress(await this.#context.messages(), acceptance.invitedEmail)
    }
  }

  async #inviteLogin(request: Request, invite: Invite): Promise<Response> {
    const [inviterNames, workspace] = await Promise.all([this.#context.people.namesOf([invite.invitedBy]), this.#context.repositories.workspaces.findWorkspace(invite.workspaceId)])
    if (!workspace) throw new Error(`Invite ${invite.inviteId} names workspace ${invite.workspaceId}, which does not exist`)
    const invitation = { inviterName: inviterNames.get(invite.invitedBy) ?? '', workspaceName: workspace.name, email: invite.email }
    const invitePath = new URL(request.url).pathname
    const loginPage = LoginPage.render(await this.#context.messages(), this.#context.auth.loginProviders, invitePath, invitation)
    // The cookie only has to outlast signing up, so a link that never expires is kept for a day.
    const secondsLeft = invite.expiresAt === null ? DAY_SECONDS : Math.ceil((invite.expiresAt - Date.now()) / 1000)
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

  /**
   * The language switch's form. The choice is kept in this browser, and on the account of a person signed in here so
   * it follows them to other devices and into their mail; then the page they switched on opens again.
   */
  async chooseLocale(request: Request): Promise<Response> {
    const locale = parseLocale(String((await request.formData()).get('locale') ?? ''))
    if (!locale) return HttpError.fieldInvalid('locale', 'choose one of the offered languages').toResponse()
    const identity = this.#context.requestIdentity.usesAccessToken ? null : await this.#context.identity()
    if (identity) await this.#context.repositories.users.setLocale(identity.userId, locale)
    const referer = URL.parse(request.headers.get('Referer') ?? '')
    const backPath = PageRoutes.#safeNextPath(referer?.origin === this.#context.appOrigin ? `${referer.pathname}${referer.search}` : null, this.#context.appOrigin)
    const localeCookie = HttpCookies.serialize(LOCALE_COOKIE, locale, { maxAgeSeconds: YEAR_SECONDS }, this.#isSecure(request))
    return new Response(null, { status: 303, headers: { Location: new URL(backPath, this.#context.appOrigin).toString(), 'Set-Cookie': localeCookie } })
  }

  async home(request: Request): Promise<Response> {
    const identity = await this.#context.identity()
    if (!identity) return this.#redirectToLogin(request)
    const searchParams = new URL(request.url).searchParams
    const [workspaceArtifacts, openThreadComments, sharedArtifacts] = await Promise.all([
      this.#context.gate.listWorkspace(identity),
      this.#context.repositories.comments.listInOpenThreads(identity.membership.workspace.workspaceId),
      this.#context.gate.listSharedWith(identity),
    ])
    const listing = new HomeListing(workspaceArtifacts, identity, CommentThread.allOf(openThreadComments), sharedArtifacts)
    const [workspaceNames, deletedWorkspaces] = await Promise.all([
      this.#workspaceNames(listing.otherWorkspaceIds()),
      this.#context.repositories.workspaces.listRestorable(identity.userId, WorkspaceDeletion.purgeCutoff(Date.now())),
    ])
    const requestedFilter = searchParams.get('filter')
    const query = {
      filter: HOME_FILTERS.find(filter => filter === requestedFilter) ?? ('all' as HomeFilter),
      agent: searchParams.get('agent'),
      search: searchParams.get('q') ?? '',
    }
    const [authorNames, m] = await Promise.all([this.#context.people.namesOf(listing.peopleIds()), this.#context.messages()])
    const previewUrls = await this.#previewUrls(listing.matching(m, query, authorNames))
    const justRemoved = listing.restorable(searchParams.get('removed'))
    return HomePage.render({ m, identity, listing, query, authorNames, workspaceNames, deletedWorkspaces, previewUrls, justRemoved, usercontentOrigin: this.#settings.usercontentOrigin, now: Date.now() })
  }

  async #workspaceNames(workspaceIds: string[]): Promise<Map<string, string>> {
    const workspaces = await Promise.all(workspaceIds.map(workspaceId => this.#context.repositories.workspaces.findWorkspace(workspaceId)))
    return new Map(workspaces.flatMap(workspace => (workspace === null ? [] : [[workspace.workspaceId, workspace.name] as const])))
  }

  /** Anyone may read a personal page; `/@me` takes a signed-in person to their own, making it the first time. */
  async personalPage(request: Request, handle: string): Promise<Response> {
    const identity = await this.#context.identity()
    if (handle === 'me') return identity ? this.#redirectToOwnPersonalPage(identity) : this.#redirectToLogin(request)
    const profile = await this.#context.personalPages.findByHandle(handle)
    if (!profile) return MessagePages.unknownAddress(await this.#context.messages(), 404)
    const now = Date.now()
    const [entries, names] = await Promise.all([this.#context.personalPages.entriesOf(profile.userId, now), this.#context.people.namesOf([profile.userId])])
    const previewUrls = new Map(
      await Promise.all(entries.map(async entry => [entry.artifactId, `${await this.#context.artifactPages.entryPageUrl(entry.artifactId, entry.version, now)}?preview`] as const)),
    )
    const name = names.get(profile.userId) ?? profile.handle
    const pageUrl = this.#context.personalPages.url(profile.handle)
    const cardVariant = await ProfileShareCard.variant(ProfileShareCard.drawing(name, profile.handle, entries))
    return PersonalPage.render({
      m: await this.#context.messages(),
      profile,
      name,
      entries,
      previewUrls,
      shareCards: new Map(entries.map(entry => [entry.artifactId, this.#context.personalPages.shareCardOf(entry, now)])),
      isOwner: identity?.userId === profile.userId,
      pageUrl,
      cardImageUrl: `${pageUrl}/card.png?v=${cardVariant}`,
      usercontentOrigin: this.#settings.usercontentOrigin,
      now,
    })
  }

  async #redirectToOwnPersonalPage(identity: Identity): Promise<Response> {
    const profile = await this.#context.personalPages.claim(identity.userId)
    return new Response(null, { status: 302, headers: { Location: PersonalPages.path(profile.handle) } })
  }

  /** `segment` is the part of the address after /a/, as the link has it. */
  async viewer(request: Request, segment: string): Promise<Response> {
    const viewing = await this.#viewing(request, segment, 'viewer')
    return viewing instanceof Response ? viewing : ViewerPage.render(viewing)
  }

  async fullView(request: Request, segment: string): Promise<Response> {
    const viewing = await this.#viewing(request, segment, 'full')
    return viewing instanceof Response ? viewing : ViewerPage.renderFull(viewing)
  }

  // Both pages decide access and sign a fresh file URL on every visit, so their addresses are safe to pass around.
  async #viewing(request: Request, segment: string, page: ArtifactPage): Promise<ViewerModel | Response> {
    const identity = await this.#context.identity()
    const reference = ArtifactPath.parse(segment)
    const openedArtifact = reference ? await this.#context.gate.openReferenced(reference, identity, request) : null
    if (!openedArtifact) return MessagePages.notFound(await this.#context.messages(), identity ? null : PageRoutes.#pathOf(request))
    if (!openedArtifact.permissions.canView) return this.#refusal(request, segment, openedArtifact, identity)
    // The redirect spells out the artifact's words, so it comes only after the same check that shows its title.
    if (segment !== ArtifactPath.segmentOf(openedArtifact.summary)) return PageRoutes.#movedTo(`${ArtifactPath.of(openedArtifact.summary, page)}${new URL(request.url).search}`)
    const artifactId = openedArtifact.summary.artifactId
    const versionParameter = new URL(request.url).searchParams.get('v')
    const requestedVersion = Number(versionParameter ?? openedArtifact.summary.version)
    const versionExists = ArtifactGate.hasVersion(openedArtifact, requestedVersion)
    const shownVersion = versionExists ? requestedVersion : openedArtifact.summary.version
    const asksForMissingVersion = versionParameter !== null && Number.isInteger(requestedVersion) && !versionExists
    const showsOlderVersion = shownVersion !== openedArtifact.summary.version
    if (showsOlderVersion && !openedArtifact.permissions.canSeeVersions) return identity ? MessagePages.notFound(await this.#context.messages(), null) : this.#redirectToLogin(request)
    const now = Date.now()
    const authorNames = await this.#context.people.namesOf([openedArtifact.summary.authorId])
    const authorName = authorNames.get(openedArtifact.summary.authorId) ?? ''
    return {
      m: await this.#context.messages(),
      openedArtifact,
      identity,
      authorName,
      byline: ViewerPage.isPublicLinkVisitor(openedArtifact) || openedArtifact.permissions.canManageSharing ? await this.#bylineOf(openedArtifact, authorName, now) : null,
      shownVersion,
      missingVersion: asksForMissingVersion ? requestedVersion : null,
      olderVersion: shownVersion === openedArtifact.summary.version ? null : await this.#olderVersion(artifactId, shownVersion),
      artifactUrl: await this.#context.artifactPages.entryPageUrl(artifactId, shownVersion, now),
      usercontentOrigin: this.#settings.usercontentOrigin,
      now,
    }
  }

  // A stranger reading a listed artifact can follow the author to their page and on to the next piece.
  async #bylineOf(openedArtifact: OpenedArtifact, authorName: string, now: number): Promise<Byline | null> {
    const { summary } = openedArtifact
    const [entries, profile] = await Promise.all([this.#context.personalPages.entriesOf(summary.authorId, now), this.#context.repositories.profiles.findByUser(summary.authorId)])
    const position = entries.findIndex(entry => entry.artifactId === summary.artifactId)
    if (position < 0 || !profile) return null
    const next = entries[(position + 1) % entries.length]
    return {
      authorName,
      personalPagePath: PersonalPages.path(profile.handle),
      share: ShareCard.of(summary, openedArtifact.shareReadiness, this.#context.appOrigin),
      next: next && next.artifactId !== summary.artifactId ? { path: ArtifactPath.of(next), title: next.title } : null,
    }
  }

  async #olderVersion(artifactId: string, version: number): Promise<OlderVersion> {
    const versionHistory = await this.#context.repositories.artifacts.listVersions(artifactId)
    const versionRecord = versionHistory.find(candidate => candidate.version === version)
    if (!versionRecord) throw new Error(`Version ${version} of artifact ${artifactId} is missing from its history`)
    const authorNames = await this.#context.people.namesOf([versionRecord.authorId])
    return { version, authorName: authorNames.get(versionRecord.authorId) ?? '', publishedAt: versionRecord.createdAt }
  }

  /** Every answer leads back to the address as the link had it; the viewer redirects from there once the password lets the visitor in. */
  async unlock(request: Request, segment: string): Promise<Response> {
    const requestedPath = ArtifactPath.atSegment(segment)
    const reference = ArtifactPath.parse(segment)
    const summary = reference ? await this.#context.gate.find(reference) : null
    const passwordHash = summary?.sharing.publicLinkPasswordHash ?? null
    if (!summary || passwordHash === null) return MessagePages.notFound(await this.#context.messages(), requestedPath)
    // Each guess costs a PBKDF2 run, so guessing is limited per visitor and artifact.
    const visitorAddress = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success: withinAttemptLimit } = await this.#settings.unlockRateLimiter.limit({ key: `${summary.artifactId}:${visitorAddress}` })
    if (!withinAttemptLimit) return PageRoutes.#backToPasswordPrompt(requestedPath, 'wait')
    const formData = await request.formData()
    const password = String(formData.get('password') ?? '')
    if (!(await PublicLinkPassword.verify(password, passwordHash))) return PageRoutes.#backToPasswordPrompt(requestedPath, 'wrong')
    const unlockCookie = HttpCookies.serialize(
      ArtifactGate.unlockCookieName(summary.artifactId),
      await this.#context.gate.unlockCookieValue(summary),
      { maxAgeSeconds: UNLOCK_COOKIE_SECONDS, path: '/' },
      new URL(request.url).protocol === 'https:',
    )
    return new Response(null, { status: 303, headers: { Location: requestedPath, 'Set-Cookie': unlockCookie } })
  }

  /** Reloading the result shows the prompt again instead of resubmitting the password. */
  static #backToPasswordPrompt(requestedPath: string, prompt: Exclude<PasswordPrompt, 'ask'>): Response {
    return new Response(null, { status: 303, headers: { Location: `${requestedPath}?password=${prompt}` } })
  }

  // Not cached: whether a link redirects depends on who opens it, and its words may change again.
  static #movedTo(path: string): Response {
    return new Response(null, { status: 301, headers: { Location: path, 'Cache-Control': 'no-store' } })
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
    const [accessTokens, members, administration, usage] = await Promise.all([
      this.#context.repositories.accessTokens.listForUser(identity.userId),
      this.#context.repositories.workspaces.listMembers(identity.membership.workspace.workspaceId),
      section === 'workspace' ? this.#workspaceAdministration(identity) : null,
      section === 'workspace' ? this.#context.repositories.artifacts.usageOf(identity.membership.workspace.workspaceId) : null,
    ])
    const guideFiles = new AgentGuide(this.#context.appOrigin, this.#settings.mcpUrl).files()
    return SettingsPage.render({ m: await this.#context.messages(), identity, section, mcpUrl: this.#settings.mcpUrl, appOrigin: this.#context.appOrigin, accessTokens, guideFiles, members, administration, usage, now: Date.now() })
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

  async #refusal(request: Request, segment: string, openedArtifact: OpenedArtifact, identity: Identity | null): Promise<Response> {
    const { summary, permissions } = openedArtifact
    if (permissions.needsPublicLinkPassword) return MessagePages.publicLinkPassword(await this.#context.messages(), ArtifactPath.atSegment(segment, 'unlock'), PageRoutes.#passwordPromptOf(request))
    if (!identity) return this.#redirectToLogin(request)
    if (!ArtifactGate.mayAskForAccess(openedArtifact, identity)) return MessagePages.notFound(await this.#context.messages(), null)
    const authorNames = await this.#context.people.namesOf([summary.authorId])
    return MessagePages.noAccess(await this.#context.messages(), summary.artifactId, authorNames.get(summary.authorId) ?? '')
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
