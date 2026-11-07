import { ArtifactPath, type CommentThread } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

const ARTIFACT_FILTERS = ['all', 'mine', 'shared', 'removed'] as const
const WAITING_FILTERS = ['waiting_for_me', 'waiting_for_my_agent'] as const
export const HOME_FILTERS = [...ARTIFACT_FILTERS, ...WAITING_FILTERS] as const
export type HomeFilter = (typeof HOME_FILTERS)[number]

const FILTER_LABELS: Record<HomeFilter, string> = {
  all: '全部',
  mine: '我发布的',
  shared: '分享给我的',
  removed: '最近删除',
  waiting_for_me: '等我处理',
  waiting_for_my_agent: '等我的 agent 处理',
}

export interface HomeQuery {
  filter: HomeFilter
  agent: string | null
  search: string
}

/**
 * The artifacts the home page shows for one query, and the counts its side navigation needs. 最近删除 holds the
 * removed artifacts the person may restore; every other filter holds only the ones they can view.
 */
export class HomeListing {
  readonly #visibleArtifacts: OpenedArtifact[]
  readonly #restorableArtifacts: OpenedArtifact[]
  readonly #identity: Identity
  readonly #openThreadsByArtifact: Map<string, CommentThread[]>
  readonly #grantedArtifactIds: Set<string>

  constructor(workspaceArtifacts: OpenedArtifact[], identity: Identity, openThreads: CommentThread[], grantedArtifactIds: Set<string>) {
    this.#visibleArtifacts = workspaceArtifacts.filter(openedArtifact => openedArtifact.permissions.canView)
    this.#restorableArtifacts = workspaceArtifacts.filter(openedArtifact => openedArtifact.permissions.canRestore)
    this.#identity = identity
    this.#openThreadsByArtifact = new Map()
    for (const thread of openThreads) this.#openThreadsByArtifact.set(thread.root.artifactId, [...this.#openThreadsOf(thread.root.artifactId), thread])
    this.#grantedArtifactIds = grantedArtifactIds
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
    return [...this.#visibleArtifacts, ...this.#restorableArtifacts].flatMap(({ summary }) => [summary.authorId, summary.removal?.removedBy ?? null])
  }

  agentCounts(): { agent: string; count: number }[] {
    const countByAgent = new Map<string, number>()
    for (const { summary } of this.#visibleArtifacts) {
      const agent = ArtifactLabels.publishedVia(summary.publishedVia)
      countByAgent.set(agent, (countByAgent.get(agent) ?? 0) + 1)
    }
    return [...countByAgent].map(([agent, count]) => ({ agent, count })).sort((left, right) => right.count - left.count)
  }

  /** A search matches the title, the author's name or the source, ignoring case. */
  matching(query: HomeQuery, authorNames: Map<string, string>): OpenedArtifact[] {
    const searchText = query.search.trim().toLowerCase()
    return this.#artifactsFor(query.filter).filter(openedArtifact => {
      const { summary } = openedArtifact
      const source = ArtifactLabels.publishedVia(summary.publishedVia)
      const matchesAgent = query.agent === null || source === query.agent
      const searchedFields = [summary.title, authorNames.get(summary.authorId) ?? '', source]
      const matchesSearch = searchText === '' || searchedFields.some(field => field.toLowerCase().includes(searchText))
      return this.#matchesFilter(openedArtifact, query.filter) && matchesAgent && matchesSearch
    })
  }

  #artifactsFor(filter: HomeFilter): OpenedArtifact[] {
    return filter === 'removed' ? this.#restorableArtifacts : this.#visibleArtifacts
  }

  #matchesFilter(openedArtifact: OpenedArtifact, filter: HomeFilter): boolean {
    switch (filter) {
      case 'all':
        return true
      case 'mine':
        return openedArtifact.summary.authorId === this.#identity.userId
      case 'shared':
        return this.#grantedArtifactIds.has(openedArtifact.summary.artifactId)
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
  identity: Identity
  listing: HomeListing
  query: HomeQuery
  authorNames: Map<string, string>
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

// What each filter holds, under the heading; the count and the search follow it.
const FILTER_DESCRIPTIONS: Record<HomeFilter, string> = {
  all: '团队成员和他们的 agent 发布的 artifact，默认 workspace 内可见。',
  mine: '你发布的，和你的 agent 代你发布的。',
  shared: '作者把你加进分享名单的 artifact。',
  removed: '删除后所有人都看不到。30 天内可以恢复，之后彻底删除。',
  waiting_for_me: '有评论在等你回复。',
  waiting_for_my_agent: '有给 agent 的评论还没解决，等你的 agent 处理。',
}

interface EmptyState {
  icon: IconName
  title: string
  text: string
  action: { label: string; href: string; primary: boolean } | null
}

export class HomePage {
  static render(model: HomeModel): Response {
    const shownArtifacts = model.listing.matching(model.query, model.authorNames)
    const topBarMiddle = html`${PageShell.workspaceSwitcher(model.identity)}${HomePage.#searchBox(model.query)}<a class="xxd-btn app-topbar__action" data-variant="ghost" data-size="sm" href="/settings/agents">${PageShell.icon('Bot')}Agent 接入</a>`
    const main = model.query.filter === 'removed' ? HomePage.#removedSection(shownArtifacts, model) : HomePage.#artifactsSection(shownArtifacts, model)
    const body = html`${PageShell.topBar(model.identity, topBarMiddle)}${PageShell.withSidebar(HomePage.#sidebar(model), main)}
${PageShell.jsonData('home-config', { justRemoved: HomePage.#justRemovedJson(model.justRemoved) })}`
    return PageShell.render({ title: 'Open Artifact', body, scripts: ['common.js', 'home.js'], frameOrigin: model.usercontentOrigin })
  }

  static #artifactsSection(shownArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    return html`${model.identity.hasChosenName ? '' : HomePage.#nameNudge(model.identity)}<header class="xxd-page-header home-header">
  <div class="xxd-page-header__row">
    <h1 class="xxd-page-header__title">${HomePage.#heading(model.query)}</h1>
    <div class="xxd-page-header__actions"><a class="xxd-btn" data-variant="primary" href="/settings/agents">让 agent 发布</a></div>
  </div>
  <p class="xxd-page-header__desc">${HomePage.#description(model.query)}</p>
</header>
${HomePage.#resultLine(shownArtifacts.length, model.query)}
${shownArtifacts.length > 0 ? HomePage.#grid(shownArtifacts, model) : HomePage.#emptyState(HomePage.#emptyStateOf(model.query))}`
  }

  static #nameNudge(identity: Identity): SafeHtml {
    return html`<div class="xxd-banner home-name-nudge" role="status">${PageShell.icon('UserRound')}<div>
  <p class="xxd-banner__title">设置你的名字</p>
  <p class="xxd-banner__text">现在团队成员在评论和通知里看到的是「${identity.name}」。设一个大家认得出的名字。</p>
</div><div class="xxd-banner__actions"><a class="xxd-btn" data-size="sm" href="/settings/profile">去设置</a></div></div>`
  }

  // The heading names what the list shows, so it never runs the workspace name into a sentence.
  static #heading(query: HomeQuery): string {
    if (query.agent !== null) return `${query.agent} 发布的`
    return query.filter === 'all' ? '全部 artifact' : FILTER_LABELS[query.filter]
  }

  static #description(query: HomeQuery): string {
    return query.agent === null ? FILTER_DESCRIPTIONS[query.filter] : `来源是 ${query.agent} 的 artifact。`
  }

  // Said in a live region, so a screen reader hears the count change as the search narrows.
  static #resultLine(shownCount: number, query: HomeQuery): SafeHtml {
    const searchText = query.search.trim()
    const line = searchText === '' ? `${shownCount} 个` : `搜索「${searchText}」· ${shownCount} 个`
    return html`<p class="xxd-text home-result-line" data-variant="secondary" role="status">${line}</p>`
  }

  // Removed artifacts have no page to open; the list offers only 恢复 until they are purged.
  static #removedSection(removedArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    const header = html`<header class="xxd-page-header">
  <div class="xxd-page-header__row"><h1 class="xxd-page-header__title">${FILTER_LABELS.removed}</h1></div>
  <p class="xxd-page-header__desc">${FILTER_DESCRIPTIONS.removed}</p>
</header>`
    if (removedArtifacts.length === 0) return html`${header}${HomePage.#emptyState({ icon: 'Trash2', title: '没有可以恢复的 artifact', text: '你删除的 artifact 会在这里留 30 天。', action: null })}`
    const row = ({ summary }: OpenedArtifact) => {
      const removal = summary.removal
      if (removal === null) throw new Error(`Artifact ${summary.artifactId} is listed as removed but has no removal`)
      return html`<tr data-removed-row="${summary.artifactId}">
    <td>${summary.title}</td>
    <td><span class="xxd-text" data-variant="secondary">${model.authorNames.get(removal.removedBy)} ${ArtifactLabels.removal(removal.removedAsAdmin)} · ${PageShell.relativeTime(removal.removedAt, model.now)}</span></td>
    <td><span class="xxd-text" data-variant="secondary">${ArtifactLabels.purgeIn(removal.purgeAt, model.now)}</span></td>
    <td class="xxd-table__actions"><button type="button" class="xxd-btn" data-size="xs" data-restore-artifact="${summary.artifactId}" data-title="${summary.title}">${PageShell.icon('RotateCcw', 14)}恢复</button></td>
  </tr>`
    }
    return html`${header}<div class="xxd-table-wrap"><table class="xxd-table">
  <thead><tr><th>标题</th><th>删除</th><th>保留</th><th class="xxd-table__actions"><span class="xxd-sr-only">操作</span></th></tr></thead>
  <tbody>${removedArtifacts.map(row)}</tbody>
</table></div>`
  }

  static #justRemovedJson(justRemoved: OpenedArtifact | null) {
    if (justRemoved === null) return null
    const { summary } = justRemoved
    return { artifactId: summary.artifactId, title: summary.title, removedAsAdmin: summary.removal?.removedAsAdmin ?? false }
  }

  // Enter submits as a plain GET; home.js also filters as the person types. The filter and source go along.
  static #searchBox(query: HomeQuery): SafeHtml {
    return html`<form class="xxd-input-wrap app-search" role="search" action="/" method="get" data-home-search>
  ${PageShell.icon('Search')}<label class="xxd-sr-only" for="artifact-search">搜索标题、作者或 agent</label>
  <input class="xxd-input" data-size="sm" id="artifact-search" name="q" type="search" placeholder="搜索标题、作者或 agent" autocomplete="off" value="${query.search}">
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
    const search = model.query.search
    const filterLink = (filter: HomeFilter) => {
      const isCurrent = model.query.filter === filter && model.query.agent === null
      const count = model.listing.countFor(filter)
      const somethingWaits = WAITING_FILTERS.some(waitingFilter => waitingFilter === filter) && count > 0
      // An empty badge is hidden: a column of zeros says nothing, so only a filter holding something shows its count.
      return html`<a class="xxd-sidebar__item" ${filter === 'removed' ? html`data-removed-count` : ''} href="${HomePage.#homePath({ filter, agent: null, search })}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(FILTER_ICONS[filter], 18)}<span>${FILTER_LABELS[filter]}</span><span class="xxd-badge" ${somethingWaits ? html`data-tone="warning"` : ''} title="${count} 个 artifact">${count > 0 ? count : ''}</span></a>`
    }
    const agentLink = ({ agent, count }: { agent: string; count: number }) => {
      const isCurrent = model.query.agent === agent
      return html`<a class="xxd-sidebar__item" href="${HomePage.#homePath({ filter: 'all', agent, search })}" title="${agent}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(HomePage.#sourceIcon(agent), 18)}<span>${agent}</span><span class="xxd-badge" title="${count} 个 artifact">${count}</span></a>`
    }
    const agentCounts = model.listing.agentCounts()
    return html`<nav class="xxd-sidebar app-sidebar home-sidebar" aria-label="筛选"><div class="xxd-sidebar__body">
  <div class="home-sidebar__filter-row">
    <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">筛选</div>${ARTIFACT_FILTERS.map(filterLink)}</div>
    <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">待处理</div>${WAITING_FILTERS.map(filterLink)}</div>
  </div>
  ${agentCounts.length > 0 ? html`<div class="xxd-sidebar__group home-sidebar__sources"><div class="xxd-sidebar__label">来源</div>${agentCounts.map(agentLink)}</div>` : ''}
  ${agentCounts.length > 1 || model.query.agent !== null ? HomePage.#sourcePicker(model, agentCounts) : ''}
</div></nav>`
  }

  // On narrow screens the sources become one select, so the filters keep a row of their own. With a single source
  // there is nothing to pick, so the select is left out unless a source is already chosen and needs a way back.
  static #sourcePicker(model: HomeModel, agentCounts: { agent: string; count: number }[]): SafeHtml {
    const option = (label: string, path: string, selected: boolean) => html`<option value="${path}" ${selected ? new SafeHtml('selected') : ''}>${label}</option>`
    const search = model.query.search
    return html`<label class="xxd-select home-source-picker"><span class="xxd-sr-only">来源</span><select data-source-picker>
  ${option('全部来源', HomePage.#homePath({ filter: model.query.agent === null ? model.query.filter : 'all', agent: null, search }), model.query.agent === null)}
  ${agentCounts.map(({ agent, count }) => option(`${agent}（${count}）`, HomePage.#homePath({ filter: 'all', agent, search }), model.query.agent === agent))}
</select></label>`
  }

  static #sourceIcon(agent: string): IconName {
    return agent === ArtifactLabels.publishedVia(null) ? 'Globe' : 'Bot'
  }

  static #grid(shownArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    return html`<div class="xxd-grid artifact-grid">${shownArtifacts.map(openedArtifact => HomePage.#card(openedArtifact, model))}</div>`
  }

  static #card({ summary }: OpenedArtifact, model: HomeModel): SafeHtml {
    const unresolvedCount = model.listing.unresolvedCount(summary.artifactId)
    const forAgentCount = model.listing.forAgentCount(summary.artifactId)
    const forAgentPart = forAgentCount > 0 ? ` · 其中 ${forAgentCount} 条给 agent` : ''
    const publishedBy = ArtifactLabels.publishedBy(model.authorNames.get(summary.authorId) ?? '', summary.publishedVia)
    // Visible to the workspace is the default, which the 全部 description states, so only a different reach gets a badge.
    const sharingBadge = summary.sharing.visibility === 'workspace' ? '' : html`<span class="xxd-badge">${ArtifactLabels.sharingBadge(summary.sharing, model.now)}</span>`
    const commentBadge = unresolvedCount > 0 ? html`<span class="xxd-badge" data-appearance="dot" data-tone="warning">${unresolvedCount} 条未解决评论${forAgentPart}</span>` : ''
    return html`<a class="xxd-card artifact-card" href="${ArtifactPath.of(summary)}">
  <div class="xxd-card__media artifact-cover" aria-hidden="true">
    <span class="artifact-cover__title"></span><span class="artifact-cover__line"></span><span class="artifact-cover__line"></span>
    <span class="artifact-cover__blocks"><span></span><span></span><span></span></span>
    ${HomePage.#livePreview(model.previewUrls.get(summary.artifactId))}
  </div>
  <div class="xxd-card__body">
    <p class="xxd-card__title artifact-card__title" title="${summary.title}">${summary.title}</p>
    <p class="xxd-card__meta artifact-meta" title="${publishedBy} · ${ArtifactLabels.updatedAgo(summary.updatedAt, model.now)}${summary.version > 1 ? ` · v${summary.version}` : ''}"><span>${publishedBy}</span>${PageShell.relativeTime(summary.updatedAt, model.now)}${summary.version > 1 ? html`<span class="xxd-mono">v${summary.version}</span>` : ''}</p>
    ${sharingBadge || commentBadge ? html`<div class="xxd-cluster artifact-card__badges">${sharingBadge}${commentBadge}</div>` : ''}
  </div>
</a>`
  }

  // Scripts may run so charts and data pages look right; without allow-same-origin the preview is as isolated as the viewer.
  static #livePreview(previewUrl: string | undefined): SafeHtml | string {
    if (!previewUrl) return ''
    return html`<iframe class="artifact-cover__preview" src="${previewUrl}" sandbox="allow-scripts" loading="lazy" tabindex="-1" referrerpolicy="no-referrer" title=""></iframe>`
  }

  // A search that finds nothing is undone by clearing the search alone; each filter says what would fill it.
  static #emptyStateOf(query: HomeQuery): EmptyState {
    const searchText = query.search.trim()
    if (searchText !== '') {
      return { icon: 'SearchX', title: `没有找到「${searchText}」`, text: '搜索会查标题、作者的名字和发布它的 agent。', action: { label: '清除搜索', href: HomePage.#homePath({ ...query, search: '' }), primary: false } }
    }
    if (query.agent !== null) return { icon: 'SearchX', title: `没有来自 ${query.agent} 的 artifact`, text: '', action: { label: '查看全部', href: '/', primary: false } }
    switch (query.filter) {
      case 'all':
        return { icon: 'Inbox', title: '还没有 artifact', text: '在「Agent 接入」里连接你的 agent，然后让它把设计文档、报告或看板发布到这里。', action: { label: '连接 agent', href: '/settings/agents', primary: true } }
      case 'mine':
        return { icon: 'UserRound', title: '你还没有发布 artifact', text: '连接你的 agent，让它把页面发布到这里。', action: { label: '连接 agent', href: '/settings/agents', primary: true } }
      case 'shared':
        return { icon: 'Users', title: '还没有人把 artifact 分享给你', text: '作者在分享设置里加上你之后，会出现在这里。', action: null }
      case 'waiting_for_me':
        return { icon: 'MessageSquareText', title: '没有等你回复的评论', text: '有人评论你的 artifact，或回复你的评论时，会出现在这里。', action: null }
      case 'waiting_for_my_agent':
        return { icon: 'Bot', title: '没有给 agent 的评论', text: '有人在评论时选「给 agent」，你的 agent 就会在这里看到要做的事。', action: null }
      case 'removed':
        return { icon: 'Trash2', title: '没有可以恢复的 artifact', text: '', action: null }
    }
  }

  static #emptyState(emptyState: EmptyState): SafeHtml {
    const { icon, title, text, action } = emptyState
    return html`<section class="xxd-empty">
  ${PageShell.icon(icon, 24)}
  <h2 class="xxd-empty__title">${title}</h2>
  ${text ? html`<p class="xxd-empty__text">${text}</p>` : ''}
  ${action ? html`<div class="xxd-empty__actions"><a class="xxd-btn" ${action.primary ? html`data-variant="primary"` : ''} href="${action.href}">${action.label}</a></div>` : ''}
</section>`
  }
}
