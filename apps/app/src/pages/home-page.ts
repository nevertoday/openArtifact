import type { CommentThread } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, type SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

const ARTIFACT_FILTERS = ['all', 'mine', 'shared', 'removed'] as const
const WAITING_FILTERS = ['waiting_for_me', 'waiting_for_my_agent'] as const
export const HOME_FILTERS = [...ARTIFACT_FILTERS, ...WAITING_FILTERS] as const
export type HomeFilter = (typeof HOME_FILTERS)[number]

const FILTER_LABELS: Record<HomeFilter, string> = {
  all: '全部',
  mine: '我发布的',
  shared: '共享给我',
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

  matching(query: HomeQuery): OpenedArtifact[] {
    const searchText = query.search.trim().toLowerCase()
    return this.#artifactsFor(query.filter).filter(openedArtifact => {
      const matchesAgent = query.agent === null || ArtifactLabels.publishedVia(openedArtifact.summary.publishedVia) === query.agent
      const matchesSearch = searchText === '' || openedArtifact.summary.title.toLowerCase().includes(searchText)
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

export class HomePage {
  static render(model: HomeModel): Response {
    const shownArtifacts = model.listing.matching(model.query)
    const topBarMiddle = html`${PageShell.workspaceSwitcher(model.identity)}${HomePage.#searchBox(model.query)}<a class="xxd-btn app-topbar__action" data-variant="ghost" data-size="sm" href="/settings/agents">${PageShell.icon('Bot')}Agent 接入</a>`
    const main = model.query.filter === 'removed' ? HomePage.#removedSection(shownArtifacts, model) : HomePage.#artifactsSection(shownArtifacts, model)
    const body = html`${PageShell.topBar(model.identity, topBarMiddle)}${PageShell.withSidebar(HomePage.#sidebar(model), main)}
${PageShell.jsonData('home-config', { justRemoved: HomePage.#justRemovedJson(model.justRemoved) })}`
    return PageShell.render({ title: 'Open Artifact', body, scripts: ['common.js', 'home.js'], frameOrigin: model.usercontentOrigin })
  }

  static #artifactsSection(shownArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    return html`<header class="xxd-page-header">
  <div class="xxd-page-header__row">
    <h1 class="xxd-page-header__title">${model.identity.membership.workspace.name}的 artifact</h1>
    <div class="xxd-page-header__actions"><a class="xxd-btn" data-variant="primary" href="/settings/agents">让 agent 发布</a></div>
  </div>
  <p class="xxd-page-header__desc">由团队成员的 agent 发布，默认整个 workspace 可见</p>
</header>
${shownArtifacts.length > 0 ? HomePage.#grid(shownArtifacts, model) : HomePage.#emptyState(model)}`
  }

  // Removed artifacts have no page to open; the list offers only 恢复 until they are purged.
  static #removedSection(removedArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    const header = html`<header class="xxd-page-header">
  <div class="xxd-page-header__row"><h1 class="xxd-page-header__title">最近删除</h1></div>
  <p class="xxd-page-header__desc">删除后所有人都看不到。30 天内可以恢复，之后彻底删除。</p>
</header>`
    if (removedArtifacts.length === 0) return html`${header}<section class="xxd-empty">${PageShell.icon('Trash2', 24)}<h2 class="xxd-empty__title">没有可以恢复的 artifact</h2></section>`
    const row = ({ summary }: OpenedArtifact) => {
      const removal = summary.removal
      if (removal === null) throw new Error(`Artifact ${summary.artifactId} is listed as removed but has no removal`)
      return html`<tr data-removed-row="${summary.artifactId}">
    <td>${summary.title}</td>
    <td><span class="xxd-text" data-variant="secondary">${model.authorNames.get(removal.removedBy)} ${ArtifactLabels.removal(removal.removedAsAdmin)} · ${ArtifactLabels.updatedAgo(removal.removedAt, model.now)}</span></td>
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

  static #searchBox(query: HomeQuery): SafeHtml {
    return html`<form class="xxd-input-wrap app-search" role="search" action="/" method="get">
  ${PageShell.icon('Search')}<label class="xxd-sr-only" for="artifact-search">搜索标题</label>
  <input class="xxd-input" data-size="sm" id="artifact-search" name="q" type="search" placeholder="搜索标题" value="${query.search}">
  ${query.filter !== 'all' ? html`<input type="hidden" name="filter" value="${query.filter}">` : ''}
</form>`
  }

  static #sidebar(model: HomeModel): SafeHtml {
    const filterLink = (filter: HomeFilter) => {
      const isCurrent = model.query.filter === filter && model.query.agent === null
      const count = model.listing.countFor(filter)
      const somethingWaits = WAITING_FILTERS.some(waitingFilter => waitingFilter === filter) && count > 0
      return html`<a class="xxd-sidebar__item" ${filter === 'removed' ? html`data-removed-count` : ''} href="${filter === 'all' ? '/' : `/?filter=${filter}`}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(FILTER_ICONS[filter], 18)}<span>${FILTER_LABELS[filter]}</span><span class="xxd-badge" ${somethingWaits ? html`data-tone="warning"` : ''}>${count}</span></a>`
    }
    const agentLink = ({ agent, count }: { agent: string; count: number }) => {
      const isCurrent = model.query.agent === agent
      return html`<a class="xxd-sidebar__item" href="/?agent=${encodeURIComponent(agent)}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(HomePage.#sourceIcon(agent), 18)}<span>${agent}</span><span class="xxd-badge">${count}</span></a>`
    }
    const agentCounts = model.listing.agentCounts()
    return html`<nav class="xxd-sidebar app-sidebar" aria-label="筛选"><div class="xxd-sidebar__body">
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">ARTIFACT</div>${ARTIFACT_FILTERS.map(filterLink)}</div>
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">待处理</div>${WAITING_FILTERS.map(filterLink)}</div>
  ${agentCounts.length > 0 ? html`<div class="xxd-sidebar__group"><div class="xxd-sidebar__label">来源</div>${agentCounts.map(agentLink)}</div>` : ''}
</div></nav>`
  }

  static #sourceIcon(agent: string): IconName {
    return agent === ArtifactLabels.publishedVia(null) ? 'Globe' : 'Bot'
  }

  static #grid(shownArtifacts: OpenedArtifact[], model: HomeModel): SafeHtml {
    return html`<div class="xxd-grid artifact-grid">${shownArtifacts.map(openedArtifact => HomePage.#card(openedArtifact, model))}</div>`
  }

  static #card({ summary }: OpenedArtifact, model: HomeModel): SafeHtml {
    const unresolvedCount = model.listing.unresolvedCount(summary.artifactId)
    return html`<a class="xxd-card" href="/a/${encodeURIComponent(summary.artifactId)}">
  <div class="xxd-card__media artifact-cover" aria-hidden="true">
    <span class="artifact-cover__title"></span><span class="artifact-cover__line"></span><span class="artifact-cover__line"></span>
    <span class="artifact-cover__blocks"><span></span><span></span><span></span></span>
    ${HomePage.#livePreview(model.previewUrls.get(summary.artifactId))}
  </div>
  <div class="xxd-card__body">
    <p class="xxd-card__title">${summary.title}</p>
    <p class="xxd-card__meta artifact-meta">
      <span>${model.authorNames.get(summary.authorId)}</span>
      <span>${ArtifactLabels.publishedVia(summary.publishedVia)}</span>
      <span class="xxd-mono">v${summary.version}</span>
      <span>${ArtifactLabels.updatedAgo(summary.updatedAt, model.now)}</span>
    </p>
    <div class="xxd-cluster artifact-card__badges">
      <span class="xxd-badge">${ArtifactLabels.visibility(summary.sharing.visibility)}</span>
      ${unresolvedCount > 0 ? html`<span class="xxd-badge" data-appearance="dot" data-tone="warning">${unresolvedCount} 条未解决评论</span>` : ''}
    </div>
  </div>
</a>`
  }

  // Scripts may run so charts and data pages look right; without allow-same-origin the preview is as isolated as the viewer.
  static #livePreview(previewUrl: string | undefined): SafeHtml | string {
    if (!previewUrl) return ''
    return html`<iframe class="artifact-cover__preview" src="${previewUrl}" sandbox="allow-scripts" loading="lazy" tabindex="-1" referrerpolicy="no-referrer" title=""></iframe>`
  }

  static #emptyState(model: HomeModel): SafeHtml {
    const isFiltered = model.query.filter !== 'all' || model.query.agent !== null || model.query.search !== ''
    if (isFiltered) {
      return html`<section class="xxd-empty">${PageShell.icon('SearchX', 24)}<h2 class="xxd-empty__title">没有符合条件的 artifact</h2><div class="xxd-empty__actions"><a class="xxd-btn" href="/">查看全部</a></div></section>`
    }
    return html`<section class="xxd-empty">
  ${PageShell.icon('Inbox', 24)}
  <h2 class="xxd-empty__title">还没有 artifact</h2>
  <p class="xxd-empty__text">在「Agent 接入」里连接你的 agent，然后让它把设计文档、报告或看板发布到这里。</p>
  <div class="xxd-empty__actions"><a class="xxd-btn" data-variant="primary" href="/settings/agents">连接 agent</a></div>
</section>`
  }
}
