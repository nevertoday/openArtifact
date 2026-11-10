import type { Messages } from '../i18n/messages.ts'
import { ArtifactPath, type ArtifactVisibility, type CommentThread, type DeletedWorkspace } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

const ARTIFACT_FILTERS = ['all', 'mine', 'shared', 'removed'] as const
const WAITING_FILTERS = ['waiting_for_me', 'waiting_for_my_agent'] as const
export const HOME_FILTERS = [...ARTIFACT_FILTERS, ...WAITING_FILTERS] as const
export type HomeFilter = (typeof HOME_FILTERS)[number]

export const HOME_SORTS = ['updated', 'title', 'comments'] as const
export type HomeSort = (typeof HOME_SORTS)[number]
export const HOME_VISIBILITIES = ['workspace', 'private', 'specified', 'public_link'] as const satisfies readonly ArtifactVisibility[]
/** Cards on the page at first, and how many more each further load brings. */
export const HOME_PAGE_SIZE = 24

export interface HomeQuery {
  filter: HomeFilter
  agent: string | null
  visibility: ArtifactVisibility | null
  sort: HomeSort
  search: string
  /** How many matching artifacts come before the first card shown. */
  from: number
}

/** One screenful of a listing: the cards to show, how many match in all, and where the next screenful starts. */
export interface HomeListingPage {
  artifacts: OpenedArtifact[]
  total: number
  nextFrom: number | null
}

/**
 * The artifacts the home page shows for one query, and the counts its side navigation needs. 最近删除 holds the
 * removed artifacts the person may restore; 与我共享 follows the person, holding what was granted to them in any
 * workspace; every other filter holds the current workspace's artifacts they can view.
 */
export class HomeListing {
  readonly #visibleArtifacts: OpenedArtifact[]
  readonly #restorableArtifacts: OpenedArtifact[]
  readonly #identity: Identity
  readonly #openThreadsByArtifact: Map<string, CommentThread[]>
  readonly #sharedArtifacts: OpenedArtifact[]

  constructor(workspaceArtifacts: OpenedArtifact[], identity: Identity, openThreads: CommentThread[], sharedArtifacts: OpenedArtifact[]) {
    this.#visibleArtifacts = workspaceArtifacts.filter(openedArtifact => openedArtifact.permissions.canView)
    this.#restorableArtifacts = workspaceArtifacts.filter(openedArtifact => openedArtifact.permissions.canRestore)
    this.#identity = identity
    this.#openThreadsByArtifact = new Map()
    for (const thread of openThreads) this.#openThreadsByArtifact.set(thread.root.artifactId, [...this.#openThreadsOf(thread.root.artifactId), thread])
    this.#sharedArtifacts = sharedArtifacts
  }

  unresolvedCount(artifactId: string): number {
    return this.#openThreadsOf(artifactId).length
  }

  forAgentCount(artifactId: string): number {
    return this.#openThreadsOf(artifactId).filter(thread => thread.root.forAgent).length
  }

  countFor(filter: HomeFilter): number {
    return this.#artifactsFor(filter).filter(openedArtifact => this.#matchesFilter(openedArtifact, filter)).length
  }

  /** The artifact just removed on the viewer page, when the person may still restore it. */
  restorable(artifactId: string | null): OpenedArtifact | null {
    return this.#restorableArtifacts.find(openedArtifact => openedArtifact.summary.artifactId === artifactId) ?? null
  }

  /** Everyone named on the page: authors, and who removed what. */
  peopleIds(): (string | null)[] {
    return [...this.#visibleArtifacts, ...this.#restorableArtifacts, ...this.#sharedArtifacts].flatMap(({ summary }) => [summary.authorId, summary.removal?.removedBy ?? null])
  }

  agentCounts(): { agent: string; count: number }[] {
    const countByAgent = new Map<string, number>()
    for (const { summary } of this.#visibleArtifacts) {
      const agent = HomeListing.sourceOf(summary.publishedVia)
      countByAgent.set(agent, (countByAgent.get(agent) ?? 0) + 1)
    }
    return [...countByAgent].map(([agent, count]) => ({ agent, count })).sort((left, right) => right.count - left.count)
  }

  /**
   * The source a listing filters by, in the address as `?agent=`: the agent's client name, or the empty string for
   * the web page, which no agent can be called. The address stays the same whatever language the page is in.
   */
  static sourceOf(publishedVia: string | null): string {
    return publishedVia ?? ''
  }

  static sourceLabel(m: Messages, source: string): string {
    return ArtifactLabels.publishedVia(m, source === '' ? null : source)
  }

  /** A search matches the title, the author's name or the source, ignoring case. The list comes most recently updated first. */
  matching(m: Messages, query: HomeQuery, authorNames: Map<string, string>): OpenedArtifact[] {
    const searchText = query.search.trim().toLowerCase()
    const matches = this.#artifactsFor(query.filter).filter(openedArtifact => {
      const { summary } = openedArtifact
      const matchesAgent = query.agent === null || HomeListing.sourceOf(summary.publishedVia) === query.agent
      const matchesVisibility = query.visibility === null || summary.sharing.visibility === query.visibility
      const searchedFields = [summary.title, authorNames.get(summary.authorId) ?? '', ArtifactLabels.publishedVia(m, summary.publishedVia)]
      const matchesSearch = searchText === '' || searchedFields.some(field => field.toLowerCase().includes(searchText))
      return this.#matchesFilter(openedArtifact, query.filter) && matchesAgent && matchesVisibility && matchesSearch
    })
    switch (query.sort) {
      case 'updated':
        return matches
      case 'title':
        return [...matches].sort((left, right) => left.summary.title.localeCompare(right.summary.title, m.meta.lang))
      case 'comments':
        return [...matches].sort((left, right) => this.unresolvedCount(right.summary.artifactId) - this.unresolvedCount(left.summary.artifactId))
    }
  }

  page(m: Messages, query: HomeQuery, authorNames: Map<string, string>): HomeListingPage {
    const matches = this.matching(m, query, authorNames)
    const end = query.from + HOME_PAGE_SIZE
    return { artifacts: matches.slice(query.from, end), total: matches.length, nextFrom: end < matches.length ? end : null }
  }

  /** How many artifacts of the listing each visibility holds, for the filter that narrows by it. */
  visibilityCounts(): Map<ArtifactVisibility, number> {
    const counts = new Map<ArtifactVisibility, number>()
    for (const { summary } of this.#visibleArtifacts) counts.set(summary.sharing.visibility, (counts.get(summary.sharing.visibility) ?? 0) + 1)
    return counts
  }

  /** The workspaces of shared artifacts outside the current one, whose cards name where they come from. */
  otherWorkspaceIds(): string[] {
    const currentWorkspaceId = this.#identity.membership.workspace.workspaceId
    return [...new Set(this.#sharedArtifacts.map(({ summary }) => summary.workspaceId))].filter(workspaceId => workspaceId !== currentWorkspaceId)
  }

  #artifactsFor(filter: HomeFilter): OpenedArtifact[] {
    switch (filter) {
      case 'removed':
        return this.#restorableArtifacts
      case 'shared':
        return this.#sharedArtifacts
      default:
        return this.#visibleArtifacts
    }
  }

  #matchesFilter(openedArtifact: OpenedArtifact, filter: HomeFilter): boolean {
    switch (filter) {
      case 'all':
        return true
      case 'mine':
        return openedArtifact.summary.authorId === this.#identity.userId
      case 'shared':
        return true
      case 'waiting_for_me':
        return this.#openThreadsOf(openedArtifact.summary.artifactId).some(thread => thread.isWaitingFor(this.#identity.userId, openedArtifact.summary.authorId))
      case 'waiting_for_my_agent':
        return this.#openThreadsOf(openedArtifact.summary.artifactId).some(thread => thread.isWaitingForAgentOf(this.#identity.userId, openedArtifact.summary.authorId))
      case 'removed':
        return openedArtifact.summary.removal !== null
    }
  }

  #openThreadsOf(artifactId: string): CommentThread[] {
    return this.#openThreadsByArtifact.get(artifactId) ?? []
  }
}

export interface HomeModel {
  m: Messages
  identity: Identity
  listing: HomeListing
  query: HomeQuery
  /** The screenful of cards this page shows. */
  page: HomeListingPage
  authorNames: Map<string, string>
  /** The deleted workspaces the person may restore as their admin. */
  deletedWorkspaces: DeletedWorkspace[]
  /** Names of the workspaces, other than the current one, that shared artifacts come from. */
  workspaceNames: Map<string, string>
  /** Signed preview addresses of the cards on this page. */
  previewUrls: Map<string, string>
  /** Removed on the viewer page a moment ago; the page offers to undo it. */
  justRemoved: OpenedArtifact | null
  usercontentOrigin: string
  now: number
}

const FILTER_ICONS: Record<HomeFilter, IconName> = {
  all: 'LayoutGrid',
  mine: 'UserRound',
  shared: 'Users',
  removed: 'Trash2',
  waiting_for_me: 'MessageSquareText',
  waiting_for_my_agent: 'Bot',
}

interface EmptyState {
  icon: IconName
  title: string
  text: string
  actions: { label: string; href: string; primary: boolean }[]
  /** How a new workspace gets going, shown as numbered cards under the text. */
  steps?: readonly string[]
}

const SHARING_ICONS = { private: 'Lock', specified: 'UserRound', public_link: 'Globe' } as const satisfies Record<Exclude<ArtifactVisibility, 'workspace'>, IconName>

export class HomePage {
  static render(model: HomeModel): Response {
    const topBarMiddle = html`${PageShell.workspaceSwitcher(model.m, model.identity, model.deletedWorkspaces, model.now)}${PageShell.searchButton(model.m, model.query.search)}<a class="xxd-btn app-topbar__action" data-variant="ghost" data-size="sm" href="/settings/agents">${PageShell.icon('Bot')}${model.m.home.connectAgents}</a>`
    const main = model.query.filter === 'removed' ? HomePage.#removedSection(model.listing.matching(model.m, model.query, model.authorNames), model) : HomePage.#artifactsSection(model)
    const body = html`${PageShell.topBar(model.m, model.identity, topBarMiddle)}${PageShell.withSidebar(HomePage.#sidebar(model), main)}
${PageShell.jsonData('home-config', { justRemoved: HomePage.#justRemovedJson(model.justRemoved) })}`
    return PageShell.render({ m: model.m, title: 'Open Artifact', body, scripts: ['common.js', 'home.js'], frameOrigin: model.usercontentOrigin })
  }

  static #artifactsSection(model: HomeModel): SafeHtml {
    const { m, query, page } = model
    const isNarrowed = query.agent !== null || query.visibility !== null
    const hasCards = page.total > 0
    return html`${model.identity.hasChosenName || !hasCards ? '' : HomePage.#nameNudge(m, model.identity)}<header class="xxd-page-header home-header">
  <div class="xxd-page-header__row">
    <h1 class="xxd-page-header__title">${query.filter === 'all' ? m.home.headingAll : m.home.filters[query.filter]}${hasCards && query.search.trim() === '' ? html`<span class="home-count">${String(page.total)}</span>` : ''}</h1>
    ${hasCards ? html`<div class="xxd-page-header__actions"><a class="xxd-btn" data-variant="primary" href="/settings/agents">${m.home.letAgentPublish}</a></div>` : ''}
  </div>
  <p class="xxd-page-header__desc">${m.home.filterDescriptions[query.filter]}</p>
</header>
${hasCards || isNarrowed ? HomePage.#toolbar(model) : ''}
${query.search.trim() !== '' ? HomePage.#resultLine(m, page.total, query) : ''}
${hasCards ? HomePage.#grid(model) : HomePage.#emptyState(HomePage.#emptyStateOf(m, query, model.identity))}`
  }

  /**
   * Narrowing and ordering the list: where a page came from, who can see it, and what comes first. Each is a plain
   * select that goes to the list's new address, so it works the same on a phone; what narrows the list also shows
   * as a tag that takes it off again.
   */
  static #toolbar(model: HomeModel): SafeHtml {
    const { m, query, listing } = model
    const tools = m.home.toolbar
    const pathWith = (change: Partial<HomeQuery>) => HomePage.#homePath({ ...query, from: 0, ...change })
    const option = (label: string, path: string, selected: boolean) => html`<option value="${path}" ${selected ? new SafeHtml('selected') : ''}>${label}</option>`
    const select = (label: string, name: string, options: SafeHtml[]) => html`<label class="xxd-select home-toolbar__select" data-size="sm"><span class="xxd-sr-only">${label}</span><select data-navigate data-toolbar="${name}">${options}</select></label>`
    const agentCounts = listing.agentCounts()
    const visibilityCounts = listing.visibilityCounts()
    const sources = agentCounts.length > 1 || query.agent !== null
      ? select(tools.source, 'source', [
          option(tools.allSources, pathWith({ agent: null }), query.agent === null),
          ...agentCounts.map(({ agent, count }) => option(tools.withCount({ label: HomeListing.sourceLabel(m, agent), count }), pathWith({ agent }), query.agent === agent)),
        ])
      : ''
    const visibilities = visibilityCounts.size > 1 || query.visibility !== null
      ? select(tools.visibility, 'visibility', [
          option(tools.allVisibilities, pathWith({ visibility: null }), query.visibility === null),
          ...HOME_VISIBILITIES.filter(visibility => visibilityCounts.has(visibility) || query.visibility === visibility).map(visibility =>
            option(tools.withCount({ label: ArtifactLabels.visibility(m, visibility), count: visibilityCounts.get(visibility) ?? 0 }), pathWith({ visibility }), query.visibility === visibility),
          ),
        ])
      : ''
    const sort = select(tools.sort, 'sort', HOME_SORTS.map(sortBy => option(tools.sorts[sortBy], pathWith({ sort: sortBy }), query.sort === sortBy)))
    const tag = (label: string, path: string) => html`<a class="xxd-chip home-toolbar__tag" data-size="sm" href="${path}" aria-label="${tools.clear(label)}">${label}${PageShell.icon('X', 14)}</a>`
    return html`<div class="home-toolbar" role="group" aria-label="${tools.label}">
  ${sources}${visibilities}
  ${query.agent !== null ? tag(HomeListing.sourceLabel(m, query.agent), pathWith({ agent: null })) : ''}
  ${query.visibility !== null ? tag(ArtifactLabels.visibility(m, query.visibility), pathWith({ visibility: null })) : ''}
  <span class="home-toolbar__spacer"></span>${sort}
</div>`
  }

  static #nameNudge(m: Messages, identity: Identity): SafeHtml {
    return html`<a class="home-name-nudge" href="/settings/profile">${PageShell.avatar(identity.name, { size: 'sm' })}<b>${m.home.nameNudge.title}</b><span>${m.home.nameNudge.text(identity.name)}</span>${PageShell.icon('ArrowRight', 14)}</a>`
  }

  // Said in a live region, so a screen reader hears the count change as the search narrows.
  static #resultLine(m: Messages, shownCount: number, query: HomeQuery): SafeHtml {
    const searchText = query.search.trim()
    const line = searchText === '' ? m.home.resultCount(shownCount) : m.home.searchResultCount({ search: searchText, count: shownCount })
    return html`<p class="xxd-text home-result-line" data-variant="secondary" role="status">${line}</p>`
  }

  // Removed artifacts have no page to open; the list offers 恢复, and 永久删除 to free their space before the purge.
  static #removedSection(removedArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    const { m } = model
    const header = html`<header class="xxd-page-header">
  <div class="xxd-page-header__row"><h1 class="xxd-page-header__title">${m.home.filters.removed}</h1></div>
  <p class="xxd-page-header__desc">${m.home.filterDescriptions.removed}</p>
</header>`
    if (removedArtifacts.length === 0) return html`${header}${HomePage.#emptyState({ icon: 'Trash2', ...m.home.empty.filters.removed, actions: [] })}`
    const row = ({ summary }: OpenedArtifact) => {
      const removal = summary.removal
      if (removal === null) throw new Error(`Artifact ${summary.artifactId} is listed as removed but has no removal`)
      return html`<tr data-removed-row="${summary.artifactId}">
    <td>${summary.title}</td>
    <td><span class="xxd-text" data-variant="secondary">${ArtifactLabels.removedBy(m, model.authorNames.get(removal.removedBy) ?? '', removal.removedAsAdmin)} · ${PageShell.relativeTime(m, removal.removedAt, model.now)}</span></td>
    <td><span class="xxd-text" data-variant="secondary">${ArtifactLabels.purgeIn(m, removal.purgeAt, model.now)}</span></td>
    <td class="xxd-table__actions"><button type="button" class="xxd-btn" data-size="xs" data-restore-artifact="${summary.artifactId}" data-title="${summary.title}">${PageShell.icon('RotateCcw', 14)}${m.home.removedTable.restore}</button>
      <button type="button" class="xxd-btn" data-size="xs" data-variant="danger-outline" data-purge-artifact="${summary.artifactId}" data-title="${summary.title}">${PageShell.icon('Trash2', 14)}${m.home.removedTable.purge}</button></td>
  </tr>`
    }
    return html`${header}<div class="xxd-table-wrap"><table class="xxd-table stack-table">
  <thead><tr><th>${m.home.removedTable.title}</th><th>${m.home.removedTable.removed}</th><th>${m.home.removedTable.kept}</th><th class="xxd-table__actions"><span class="xxd-sr-only">${m.home.removedTable.actions}</span></th></tr></thead>
  <tbody>${removedArtifacts.map(row)}</tbody>
</table></div>`
  }

  static #justRemovedJson(justRemoved: OpenedArtifact | null) {
    if (justRemoved === null) return null
    const { summary } = justRemoved
    return { artifactId: summary.artifactId, title: summary.title, removedAsAdmin: summary.removal?.removedAsAdmin ?? false }
  }

  /** The home address of a query; whatever is at its default stays out of the address. */
  static #homePath(query: HomeQuery): string {
    const searchParams = new URLSearchParams()
    if (query.filter !== 'all') searchParams.set('filter', query.filter)
    if (query.agent !== null) searchParams.set('agent', query.agent)
    if (query.visibility !== null) searchParams.set('visibility', query.visibility)
    if (query.sort !== 'updated') searchParams.set('sort', query.sort)
    if (query.search.trim() !== '') searchParams.set('q', query.search.trim())
    if (query.from > 0) searchParams.set('from', String(query.from))
    const queryString = searchParams.toString()
    return queryString === '' ? '/' : `/?${queryString}`
  }

  static #sidebar(model: HomeModel): SafeHtml {
    const { m } = model
    const filterLink = (filter: HomeFilter) => {
      const isCurrent = model.query.filter === filter
      const count = model.listing.countFor(filter)
      const somethingWaits = WAITING_FILTERS.some(waitingFilter => waitingFilter === filter) && count > 0
      // An empty badge is hidden: a column of zeros says nothing, so only a filter holding something shows its count.
      return html`<a class="xxd-sidebar__item" ${filter === 'removed' ? html`data-removed-count` : ''} href="${HomePage.#homePath({ ...model.query, filter, agent: null, visibility: null, from: 0 })}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(FILTER_ICONS[filter], 18)}<span>${m.home.filters[filter]}</span><span class="xxd-badge" ${somethingWaits ? html`data-tone="warning"` : ''} title="${m.home.sidebar.countTitle(count)}">${count > 0 ? count : ''}</span></a>`
    }
    return html`<nav class="xxd-sidebar app-sidebar home-sidebar" aria-label="${m.home.sidebar.filter}"><div class="xxd-sidebar__body">
  <div class="home-sidebar__filter-row">
    <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${m.home.sidebar.filter}</div>${ARTIFACT_FILTERS.map(filterLink)}</div>
    <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${m.home.sidebar.waiting}</div>${WAITING_FILTERS.map(filterLink)}</div>
  </div>
</div></nav>`
  }

  static #grid(model: HomeModel): SafeHtml {
    const { m, query, page } = model
    const more = page.nextFrom === null
      ? ''
      : html`<p class="home-more"><a class="xxd-btn" href="${HomePage.#homePath({ ...query, from: page.nextFrom })}" data-load-more>${m.home.loadMore(page.total - page.nextFrom)}</a></p>`
    const earlier = query.from > 0 ? html`<p class="home-more"><a class="xxd-btn" data-variant="ghost" href="${HomePage.#homePath({ ...query, from: 0 })}">${PageShell.icon('ArrowLeft', 14)}${m.home.backToFirst}</a></p>` : ''
    return html`${earlier}<div class="xxd-grid artifact-grid" data-artifact-grid>${page.artifacts.map(openedArtifact => HomePage.#card(openedArtifact, model))}</div>${more}`
  }

  static #card({ summary }: OpenedArtifact, model: HomeModel): SafeHtml {
    const { m } = model
    const unresolvedCount = model.listing.unresolvedCount(summary.artifactId)
    const forAgentCount = model.listing.forAgentCount(summary.artifactId)
    const authorName = model.authorNames.get(summary.authorId) ?? ''
    const publishedBy = ArtifactLabels.publishedBy(m, authorName, summary.publishedVia)
    // Visible to the workspace is the default, which the 全部 description states, so only a different reach gets a badge.
    const visibility = summary.sharing.visibility
    const sharingBadge = visibility === 'workspace' ? '' : html`<span class="artifact-chip" data-visibility="${visibility}">${PageShell.icon(SHARING_ICONS[visibility], 14)}${ArtifactLabels.sharingBadge(m, summary.sharing, model.now)}</span>`
    const commentsText = m.home.unresolvedComments({ count: unresolvedCount, forAgent: forAgentCount })
    const commentBadge = unresolvedCount > 0 ? html`<span class="artifact-chip artifact-chip--comments" title="${commentsText}"><span class="artifact-chip__dot"></span>${PageShell.icon('MessageSquare', 14)}<span aria-hidden="true">${String(unresolvedCount)}</span><span class="xxd-sr-only">${commentsText}</span></span>` : ''
    const otherWorkspace = model.workspaceNames.get(summary.workspaceId)
    const workspaceBadge = otherWorkspace === undefined ? '' : html`<span class="artifact-chip" title="${m.home.fromWorkspace(otherWorkspace)}">${PageShell.icon('Users', 14)}${otherWorkspace}</span>`
    // The cover is decoration; what it says about the card (who can see it, what waits on it) is read out with the link.
    return html`<a class="xxd-card artifact-card" href="${ArtifactPath.of(summary)}">
  <div class="xxd-card__media artifact-cover">
    <span class="artifact-cover__sketch" aria-hidden="true"><span class="artifact-cover__title"></span><span class="artifact-cover__line"></span><span class="artifact-cover__line"></span>
    <span class="artifact-cover__blocks"><span></span><span></span><span></span></span></span>
    ${HomePage.#livePreview(model.previewUrls.get(summary.artifactId))}
    ${workspaceBadge || sharingBadge ? html`<span class="artifact-cover__chips">${workspaceBadge}${sharingBadge}</span>` : ''}
    ${commentBadge}
  </div>
  <div class="xxd-card__body">
    <p class="xxd-card__title artifact-card__title" title="${summary.title}">${summary.title}</p>
    <p class="xxd-card__meta artifact-meta" title="${publishedBy} · ${ArtifactLabels.updatedAgo(m, summary.updatedAt, model.now)}${summary.version > 1 ? ` · v${summary.version}` : ''}">${PageShell.avatar(authorName, { size: 'sm' })}<span class="artifact-meta__who">${authorName}</span>${summary.publishedVia ? html`<span class="artifact-meta__agent">${PageShell.agentMark(summary.publishedVia)}${summary.publishedVia}</span>` : ''}${PageShell.relativeTime(m, summary.updatedAt, model.now)}${summary.version > 1 ? html`<span class="xxd-mono">v${summary.version}</span>` : ''}</p>
  </div>
</a>`
  }

  // Scripts may run so charts and data pages look right; without allow-same-origin the preview is as isolated as the viewer.
  static #livePreview(previewUrl: string | undefined): SafeHtml | string {
    if (!previewUrl) return ''
    return html`<iframe class="artifact-cover__preview" src="${previewUrl}" sandbox="allow-scripts" loading="lazy" tabindex="-1" referrerpolicy="no-referrer" title="" aria-hidden="true"></iframe>`
  }

  // A search that finds nothing is undone by clearing the search alone; each filter says what would fill it.
  static #emptyStateOf(m: Messages, query: HomeQuery, identity: Identity): EmptyState {
    const { empty } = m.home
    const searchText = query.search.trim()
    if (searchText !== '') {
      return { icon: 'SearchX', title: empty.searchTitle(searchText), text: empty.searchText, actions: [{ label: empty.clearSearch, href: HomePage.#homePath({ ...query, search: '' }), primary: false }] }
    }
    if (query.agent !== null || query.visibility !== null) {
      return { icon: 'SearchX', title: empty.narrowedTitle, text: '', actions: [{ label: empty.viewAll, href: HomePage.#homePath({ ...query, agent: null, visibility: null, from: 0 }), primary: false }] }
    }
    const connectAgent = { label: empty.connectAgent, href: '/settings/agents', primary: true }
    // An empty workspace is the moment to bring people in; only its admins can invite them.
    const inviteMembers = identity.membership.role === 'admin' ? [{ label: empty.inviteMembers, href: '/settings/members', primary: false }] : []
    switch (query.filter) {
      case 'all':
        return { icon: 'Inbox', ...empty.filters.all, actions: [connectAgent, ...inviteMembers], steps: empty.firstSteps }
      case 'mine':
        return { icon: 'UserRound', ...empty.filters.mine, actions: [connectAgent] }
      case 'shared':
        return { icon: 'Users', ...empty.filters.shared, actions: [] }
      case 'waiting_for_me':
        return { icon: 'MessageSquareText', ...empty.filters.waiting_for_me, actions: [] }
      case 'waiting_for_my_agent':
        return { icon: 'Bot', ...empty.filters.waiting_for_my_agent, actions: [] }
      case 'removed':
        return { icon: 'Trash2', title: empty.filters.removed.title, text: '', actions: [] }
    }
  }

  static #emptyState(emptyState: EmptyState): SafeHtml {
    const { icon, title, text, actions, steps } = emptyState
    return html`<section class="xxd-empty">
  ${PageShell.icon(icon, 24)}
  <h2 class="xxd-empty__title">${title}</h2>
  ${text ? html`<p class="xxd-empty__text">${text}</p>` : ''}
  ${steps ? html`<ol class="home-first-steps">${steps.map(step => html`<li>${step}</li>`)}</ol>` : ''}
  ${actions.length > 0 ? html`<div class="xxd-empty__actions xxd-cluster">${actions.map(action => html`<a class="xxd-btn" ${action.primary ? html`data-variant="primary"` : ''} href="${action.href}">${action.label}</a>`)}</div>` : ''}
</section>`
  }
}
