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

export interface HomeQuery {
  filter: HomeFilter
  agent: string | null
  search: string
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

  /** A search matches the title, the author's name or the source, ignoring case. */
  matching(m: Messages, query: HomeQuery, authorNames: Map<string, string>): OpenedArtifact[] {
    const searchText = query.search.trim().toLowerCase()
    return this.#artifactsFor(query.filter).filter(openedArtifact => {
      const { summary } = openedArtifact
      const matchesAgent = query.agent === null || HomeListing.sourceOf(summary.publishedVia) === query.agent
      const searchedFields = [summary.title, authorNames.get(summary.authorId) ?? '', ArtifactLabels.publishedVia(m, summary.publishedVia)]
      const matchesSearch = searchText === '' || searchedFields.some(field => field.toLowerCase().includes(searchText))
      return this.#matchesFilter(openedArtifact, query.filter) && matchesAgent && matchesSearch
    })
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
  authorNames: Map<string, string>
  /** The deleted workspaces the person may restore as their admin. */
  deletedWorkspaces: DeletedWorkspace[]
  /** Names of the workspaces, other than the current one, that shared artifacts come from. */
  workspaceNames: Map<string, string>
  /** Signed preview addresses of the cards that show a live thumbnail. */
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
    const shownArtifacts = model.listing.matching(model.m, model.query, model.authorNames)
    const topBarMiddle = html`${PageShell.workspaceSwitcher(model.m, model.identity, model.deletedWorkspaces, model.now)}${HomePage.#searchBox(model.m, model.query)}<a class="xxd-btn app-topbar__action" data-variant="ghost" data-size="sm" href="/settings/agents">${PageShell.icon('Bot')}${model.m.home.connectAgents}</a>`
    const main = model.query.filter === 'removed' ? HomePage.#removedSection(shownArtifacts, model) : HomePage.#artifactsSection(shownArtifacts, model)
    const body = html`${PageShell.topBar(model.m, model.identity, topBarMiddle)}${PageShell.withSidebar(HomePage.#sidebar(model), main)}
${PageShell.jsonData('home-config', { justRemoved: HomePage.#justRemovedJson(model.justRemoved) })}`
    return PageShell.render({ m: model.m, title: 'Open Artifact', body, scripts: ['common.js', 'home.js'], frameOrigin: model.usercontentOrigin })
  }

  static #artifactsSection(shownArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    return html`${model.identity.hasChosenName || shownArtifacts.length === 0 ? '' : HomePage.#nameNudge(model.m, model.identity)}<header class="xxd-page-header home-header">
  <div class="xxd-page-header__row">
    <h1 class="xxd-page-header__title">${HomePage.#heading(model.m, model.query)}${shownArtifacts.length > 0 && model.query.search.trim() === '' ? html`<span class="home-count">${String(shownArtifacts.length)}</span>` : ''}</h1>
    ${shownArtifacts.length > 0 ? html`<div class="xxd-page-header__actions"><a class="xxd-btn" data-variant="primary" href="/settings/agents">${model.m.home.letAgentPublish}</a></div>` : ''}
  </div>
  <p class="xxd-page-header__desc">${HomePage.#description(model.m, model.query)}</p>
</header>
${model.query.search.trim() !== '' ? HomePage.#resultLine(model.m, shownArtifacts.length, model.query) : ''}
${shownArtifacts.length > 0 ? HomePage.#grid(shownArtifacts, model) : HomePage.#emptyState(HomePage.#emptyStateOf(model.m, model.query, model.identity))}`
  }

  static #nameNudge(m: Messages, identity: Identity): SafeHtml {
    return html`<a class="home-name-nudge" href="/settings/profile">${PageShell.avatar(identity.name, { size: 'sm' })}<b>${m.home.nameNudge.title}</b><span>${m.home.nameNudge.text(identity.name)}</span>${PageShell.icon('ArrowRight', 14)}</a>`
  }

  // The heading names what the list shows, so it never runs the workspace name into a sentence.
  static #heading(m: Messages, query: HomeQuery): string {
    if (query.agent !== null) return m.home.headingByAgent(HomeListing.sourceLabel(m, query.agent))
    return query.filter === 'all' ? m.home.headingAll : m.home.filters[query.filter]
  }

  static #description(m: Messages, query: HomeQuery): string {
    return query.agent === null ? m.home.filterDescriptions[query.filter] : m.home.descriptionByAgent(HomeListing.sourceLabel(m, query.agent))
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
      <button type="button" class="xxd-btn" data-size="xs" data-variant="danger" data-purge-artifact="${summary.artifactId}" data-title="${summary.title}">${PageShell.icon('Trash2', 14)}${m.home.removedTable.purge}</button></td>
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

  // Enter submits as a plain GET; home.js also filters as the person types. The filter and source go along.
  static #searchBox(m: Messages, query: HomeQuery): SafeHtml {
    return html`<form class="xxd-input-wrap app-search" role="search" action="/" method="get" data-home-search>
  ${PageShell.icon('Search')}<label class="xxd-sr-only" for="artifact-search">${m.home.searchPlaceholder}</label>
  <input class="xxd-input" data-size="sm" id="artifact-search" name="q" type="search" placeholder="${m.home.searchPlaceholder}" autocomplete="off" value="${query.search}">
  ${query.filter !== 'all' ? html`<input type="hidden" name="filter" value="${query.filter}">` : ''}
  ${query.agent !== null ? html`<input type="hidden" name="agent" value="${query.agent}">` : ''}
</form>`
  }

  /** The home address for a filter or a source; a search in progress stays. */
  static #homePath(query: HomeQuery): string {
    const searchParams = new URLSearchParams()
    if (query.filter !== 'all') searchParams.set('filter', query.filter)
    if (query.agent !== null) searchParams.set('agent', query.agent)
    if (query.search.trim() !== '') searchParams.set('q', query.search.trim())
    const queryString = searchParams.toString()
    return queryString === '' ? '/' : `/?${queryString}`
  }

  static #sidebar(model: HomeModel): SafeHtml {
    const { m } = model
    const search = model.query.search
    const filterLink = (filter: HomeFilter) => {
      const isCurrent = model.query.filter === filter && model.query.agent === null
      const count = model.listing.countFor(filter)
      const somethingWaits = WAITING_FILTERS.some(waitingFilter => waitingFilter === filter) && count > 0
      // An empty badge is hidden: a column of zeros says nothing, so only a filter holding something shows its count.
      return html`<a class="xxd-sidebar__item" ${filter === 'removed' ? html`data-removed-count` : ''} href="${HomePage.#homePath({ filter, agent: null, search })}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(FILTER_ICONS[filter], 18)}<span>${m.home.filters[filter]}</span><span class="xxd-badge" ${somethingWaits ? html`data-tone="warning"` : ''} title="${m.home.sidebar.countTitle(count)}">${count > 0 ? count : ''}</span></a>`
    }
    const agentLink = ({ agent, count }: { agent: string; count: number }) => {
      const isCurrent = model.query.agent === agent
      return html`<a class="xxd-sidebar__item" href="${HomePage.#homePath({ filter: 'all', agent, search })}" title="${HomeListing.sourceLabel(m, agent)}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(HomePage.#sourceIcon(agent), 18)}<span>${HomeListing.sourceLabel(m, agent)}</span><span class="xxd-badge" title="${m.home.sidebar.countTitle(count)}">${count}</span></a>`
    }
    const agentCounts = model.listing.agentCounts()
    return html`<nav class="xxd-sidebar app-sidebar home-sidebar" aria-label="${m.home.sidebar.filter}"><div class="xxd-sidebar__body">
  <div class="home-sidebar__filter-row">
    <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${m.home.sidebar.filter}</div>${ARTIFACT_FILTERS.map(filterLink)}</div>
    <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${m.home.sidebar.waiting}</div>${WAITING_FILTERS.map(filterLink)}</div>
  </div>
  ${agentCounts.length > 1 ? html`<div class="xxd-sidebar__group home-sidebar__sources"><div class="xxd-sidebar__label">${m.home.sidebar.sources}</div>${agentCounts.map(agentLink)}</div>` : ''}
  ${agentCounts.length > 1 || model.query.agent !== null ? HomePage.#sourcePicker(model, agentCounts) : ''}
</div></nav>`
  }

  // On narrow screens the sources become one select, so the filters keep a row of their own. With a single source
  // there is nothing to pick, so the select is left out unless a source is already chosen and needs a way back.
  static #sourcePicker(model: HomeModel, agentCounts: { agent: string; count: number }[]): SafeHtml {
    const option = (label: string, path: string, selected: boolean) => html`<option value="${path}" ${selected ? new SafeHtml('selected') : ''}>${label}</option>`
    const search = model.query.search
    return html`<label class="xxd-select home-source-picker"><span class="xxd-sr-only">${model.m.home.sidebar.sources}</span><select data-source-picker>
  ${option(model.m.home.sidebar.allSources, HomePage.#homePath({ filter: model.query.agent === null ? model.query.filter : 'all', agent: null, search }), model.query.agent === null)}
  ${agentCounts.map(({ agent, count }) => option(model.m.home.sidebar.sourceOption({ agent: HomeListing.sourceLabel(model.m, agent), count }), HomePage.#homePath({ filter: 'all', agent, search }), model.query.agent === agent))}
</select></label>`
  }

  static #sourceIcon(agent: string): IconName {
    return agent === HomeListing.sourceOf(null) ? 'Globe' : 'Bot'
  }

  static #grid(shownArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    return html`<div class="xxd-grid artifact-grid">${shownArtifacts.map(openedArtifact => HomePage.#card(openedArtifact, model))}</div>`
  }

  static #card({ summary }: OpenedArtifact, model: HomeModel): SafeHtml {
    const unresolvedCount = model.listing.unresolvedCount(summary.artifactId)
    const forAgentCount = model.listing.forAgentCount(summary.artifactId)
    const publishedBy = ArtifactLabels.publishedBy(model.m, model.authorNames.get(summary.authorId) ?? '', summary.publishedVia)
    // Visible to the workspace is the default, which the 全部 description states, so only a different reach gets a badge.
    const visibility = summary.sharing.visibility
    const sharingBadge = visibility === 'workspace' ? '' : html`<span class="artifact-chip" data-visibility="${visibility}">${PageShell.icon(SHARING_ICONS[visibility], 14)}${ArtifactLabels.sharingBadge(model.m, summary.sharing, model.now)}</span>`
    const commentsText = model.m.home.unresolvedComments({ count: unresolvedCount, forAgent: forAgentCount })
    const commentBadge = unresolvedCount > 0 ? html`<span class="artifact-chip artifact-chip--comments" title="${commentsText}"><span class="artifact-chip__dot"></span>${PageShell.icon('MessageSquare', 14)}${String(unresolvedCount)}<span class="xxd-sr-only">${commentsText}</span></span>` : ''
    const otherWorkspace = model.workspaceNames.get(summary.workspaceId)
    const workspaceBadge = otherWorkspace === undefined ? '' : html`<span class="artifact-chip" title="${model.m.home.fromWorkspace(otherWorkspace)}">${PageShell.icon('Users', 14)}${otherWorkspace}</span>`
    const authorName = model.authorNames.get(summary.authorId) ?? ''
    return html`<a class="xxd-card artifact-card" href="${ArtifactPath.of(summary)}">
  <div class="xxd-card__media artifact-cover" aria-hidden="true">
    <span class="artifact-cover__title"></span><span class="artifact-cover__line"></span><span class="artifact-cover__line"></span>
    <span class="artifact-cover__blocks"><span></span><span></span><span></span></span>
    ${HomePage.#livePreview(model.previewUrls.get(summary.artifactId))}
    ${workspaceBadge || sharingBadge ? html`<span class="artifact-cover__chips">${workspaceBadge}${sharingBadge}</span>` : ''}
    ${commentBadge}
  </div>
  <div class="xxd-card__body">
    <p class="xxd-card__title artifact-card__title" title="${summary.title}">${summary.title}</p>
    <p class="xxd-card__meta artifact-meta" title="${publishedBy} · ${ArtifactLabels.updatedAgo(model.m, summary.updatedAt, model.now)}${summary.version > 1 ? ` · v${summary.version}` : ''}">${PageShell.avatar(authorName, { size: 'sm' })}<span>${authorName}</span>${summary.publishedVia ? html`<span>${summary.publishedVia}</span>` : ''}${PageShell.relativeTime(model.m, summary.updatedAt, model.now)}${summary.version > 1 ? html`<span class="xxd-mono">v${summary.version}</span>` : ''}</p>
  </div>
</a>`
  }

  // Scripts may run so charts and data pages look right; without allow-same-origin the preview is as isolated as the viewer.
  static #livePreview(previewUrl: string | undefined): SafeHtml | string {
    if (!previewUrl) return ''
    return html`<iframe class="artifact-cover__preview" src="${previewUrl}" sandbox="allow-scripts" loading="lazy" tabindex="-1" referrerpolicy="no-referrer" title=""></iframe>`
  }

  // A search that finds nothing is undone by clearing the search alone; each filter says what would fill it.
  static #emptyStateOf(m: Messages, query: HomeQuery, identity: Identity): EmptyState {
    const { empty } = m.home
    const searchText = query.search.trim()
    if (searchText !== '') {
      return { icon: 'SearchX', title: empty.searchTitle(searchText), text: empty.searchText, actions: [{ label: empty.clearSearch, href: HomePage.#homePath({ ...query, search: '' }), primary: false }] }
    }
    if (query.agent !== null) return { icon: 'SearchX', title: empty.agentTitle(HomeListing.sourceLabel(m, query.agent)), text: '', actions: [{ label: empty.viewAll, href: '/', primary: false }] }
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
