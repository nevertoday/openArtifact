import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, type SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

export const HOME_FILTERS = ['all', 'mine', 'shared', 'waiting'] as const
export type HomeFilter = (typeof HOME_FILTERS)[number]

const FILTER_LABELS: Record<HomeFilter, string> = { all: '全部', mine: '我发布的', shared: '共享给我', waiting: '待 agent 处理' }

export interface HomeQuery {
  filter: HomeFilter
  agent: string | null
  search: string
}

/** The artifacts the home page shows for one query, and the counts its side navigation needs. */
export class HomeListing {
  readonly #visibleArtifacts: OpenedArtifact[]
  readonly #identity: Identity
  readonly #waitingForAgent: Map<string, number>
  readonly #grantedArtifactIds: Set<string>

  constructor(visibleArtifacts: OpenedArtifact[], identity: Identity, waitingForAgent: Map<string, number>, grantedArtifactIds: Set<string>) {
    this.#visibleArtifacts = visibleArtifacts
    this.#identity = identity
    this.#waitingForAgent = waitingForAgent
    this.#grantedArtifactIds = grantedArtifactIds
  }

  waitingCount(artifactId: string): number {
    return this.#waitingForAgent.get(artifactId) ?? 0
  }

  countFor(filter: HomeFilter): number {
    return this.#visibleArtifacts.filter(openedArtifact => this.#matchesFilter(openedArtifact, filter)).length
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
    return this.#visibleArtifacts.filter(openedArtifact => {
      const matchesAgent = query.agent === null || ArtifactLabels.publishedVia(openedArtifact.summary.publishedVia) === query.agent
      const matchesSearch = searchText === '' || openedArtifact.summary.title.toLowerCase().includes(searchText)
      return this.#matchesFilter(openedArtifact, query.filter) && matchesAgent && matchesSearch
    })
  }

  #matchesFilter(openedArtifact: OpenedArtifact, filter: HomeFilter): boolean {
    switch (filter) {
      case 'all':
        return true
      case 'mine':
        return openedArtifact.summary.authorId === this.#identity.userId
      case 'shared':
        return this.#grantedArtifactIds.has(openedArtifact.summary.artifactId)
      case 'waiting':
        return this.waitingCount(openedArtifact.summary.artifactId) > 0
    }
  }
}

export interface HomeModel {
  identity: Identity
  listing: HomeListing
  query: HomeQuery
  authorNames: Map<string, string>
  /** Signed preview addresses of the cards that show a live thumbnail. */
  previewUrls: Map<string, string>
  usercontentOrigin: string
  now: number
}

const FILTER_ICONS: Record<HomeFilter, IconName> = { all: 'LayoutGrid', mine: 'UserRound', shared: 'Users', waiting: 'MessageSquareText' }

export class HomePage {
  static render(model: HomeModel): Response {
    const shownArtifacts = model.listing.matching(model.query)
    const topBarMiddle = html`${PageShell.workspaceSwitcher(model.identity)}${HomePage.#searchBox(model.query)}<a class="xxd-btn app-topbar__action" data-variant="ghost" data-size="sm" href="/settings/agents">${PageShell.icon('Bot')}Agent 接入</a>`
    const main = html`<header class="xxd-page-header">
  <div class="xxd-page-header__row">
    <h1 class="xxd-page-header__title">${model.identity.membership.workspace.name}的 artifact</h1>
    <div class="xxd-page-header__actions"><a class="xxd-btn" data-variant="primary" href="/settings/agents">让 agent 发布</a></div>
  </div>
  <p class="xxd-page-header__desc">由团队成员的 agent 发布，默认整个 workspace 可见</p>
</header>
${shownArtifacts.length > 0 ? HomePage.#grid(shownArtifacts, model) : HomePage.#emptyState(model)}`
    const body = html`${PageShell.topBar(model.identity, topBarMiddle)}${PageShell.withSidebar(HomePage.#sidebar(model), main)}`
    return PageShell.render({ title: 'Open Artifact', body, scripts: ['common.js'], frameOrigin: model.usercontentOrigin })
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
      const needsAgent = filter === 'waiting' && count > 0
      return html`<a class="xxd-sidebar__item" href="${filter === 'all' ? '/' : `/?filter=${filter}`}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(FILTER_ICONS[filter], 18)}<span>${FILTER_LABELS[filter]}</span><span class="xxd-badge" ${needsAgent ? html`data-tone="warning"` : ''}>${count}</span></a>`
    }
    const agentLink = ({ agent, count }: { agent: string; count: number }) => {
      const isCurrent = model.query.agent === agent
      return html`<a class="xxd-sidebar__item" href="/?agent=${encodeURIComponent(agent)}" ${isCurrent ? html`aria-current="page"` : ''}>${PageShell.icon(HomePage.#sourceIcon(agent), 18)}<span>${agent}</span><span class="xxd-badge">${count}</span></a>`
    }
    const agentCounts = model.listing.agentCounts()
    return html`<nav class="xxd-sidebar app-sidebar" aria-label="筛选"><div class="xxd-sidebar__body">
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">ARTIFACT</div>${HOME_FILTERS.map(filterLink)}</div>
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
    const waitingCount = model.listing.waitingCount(summary.artifactId)
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
      ${waitingCount > 0 ? html`<span class="xxd-badge" data-appearance="dot" data-tone="warning">${waitingCount} 条评论待 agent 处理</span>` : ''}
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
