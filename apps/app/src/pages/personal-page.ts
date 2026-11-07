import type { Messages } from '../i18n/messages.ts'
import type { ArtifactSummary, Profile } from '@open-artifact/core'
import { dayText } from '../../public/static/time-text.js'
import { PersonalPages } from '../personal-pages.ts'
import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

export interface PersonalPageModel {
  m: Messages
  profile: Profile
  name: string
  /** What the page lists, most recently updated first; the pinned one among them. */
  entries: ArtifactSummary[]
  /** Signed addresses of the entries' pages, shown small beside an entry the pointer rests on. */
  previewUrls: Map<string, string>
  /** The person looking is the page's owner, who may change the line about them, the pin and the summaries. */
  isOwner: boolean
  pageUrl: string
  usercontentOrigin: string
  now: number
}

/**
 * A person's public page: their name in a slim header, the pinned artifact as the cover, then everything else
 * they listed by year. Strangers read it; the owner sees the same page with a few quiet controls.
 */
export class PersonalPage {
  static render(model: PersonalPageModel): Response {
    const pinned = model.entries.find(entry => entry.artifactId === model.profile.pinnedArtifactId) ?? null
    const listedBelow = model.entries.filter(entry => entry !== pinned)
    const body = html`<div class="personal" data-personal>
${model.isOwner ? PersonalPage.#ownerBar() : ''}
<main class="personal__page" id="main" tabindex="-1">
${PersonalPage.#header(model)}
${pinned ? PersonalPage.#cover(pinned, model) : ''}
${listedBelow.length > 0 ? PersonalPage.#years(listedBelow, model) : ''}
${model.entries.length === 0 ? PersonalPage.#empty(model) : ''}
<footer class="personal__colophon">用 <a href="/">Open Artifact</a> 发布</footer>
</main>
<div class="personal-peek" aria-hidden="true" data-peek></div>
</div>
${PageShell.jsonData('personal-config', { handle: model.profile.handle, isOwner: model.isOwner, pinnedArtifactId: pinned?.artifactId ?? null })}`
    return PageShell.render({
      m: model.m,
      title: `${model.name} · Open Artifact`,
      description: model.profile.bio || `${model.name} 在 Open Artifact 上公开的 ${model.entries.length} 篇文档`,
      body,
      scripts: ['common.js', 'personal.js'],
      styles: ['personal.css'],
      frameOrigin: model.usercontentOrigin,
      publicCard: { url: model.pageUrl, kind: 'profile' },
    })
  }

  static #ownerBar(): SafeHtml {
    return html`<div class="personal-owner-bar"><span>这是你的主页，别人看到的就是这样。在文档的「分享」里打开「列在我的主页」，它就会出现在这里。</span><a class="xxd-link" href="/">回到工作台</a></div>`
  }

  static #header(model: PersonalPageModel): SafeHtml {
    const { profile, name, isOwner } = model
    const shareText = `${name} 的文章`
    const shareOnX = `https://x.com/intent/post?url=${encodeURIComponent(model.pageUrl)}&text=${encodeURIComponent(shareText)}`
    return html`<header class="personal-head">
  <span class="personal-head__avatar" aria-hidden="true">${PageShell.initialOf(name)}</span>
  <h1 class="personal-head__name">${name}<small>${model.entries.length} 篇</small></h1>
  <div class="personal-head__bio" data-bio-slot>${PersonalPage.#bio(profile.bio, isOwner)}</div>
  <a class="xxd-btn personal-head__share" data-size="sm" href="${shareOnX}" target="_blank" rel="noopener noreferrer">${PageShell.icon('Share2', 14)}分享主页</a>
</header>`
  }

  // The owner edits the line in place; strangers see nothing at all when it is empty.
  static #bio(bio: string, isOwner: boolean): SafeHtml | string {
    if (!isOwner) return bio ? html`<p class="personal-head__bio-text">${bio}</p>` : ''
    const label = bio ? '点一下修改介绍' : '写一句话介绍自己'
    return html`<button type="button" class="personal-head__bio-edit" data-edit-bio data-empty="${bio === ''}" aria-label="${label}" title="${label}">${bio || '写一句话介绍自己…'}</button>`
  }

  static #cover(entry: ArtifactSummary, model: PersonalPageModel): SafeHtml {
    return html`<section class="personal-cover" aria-label="置顶" data-entry="${entry.artifactId}">
  <p class="personal-label">置顶</p>
  <a class="personal-cover__link" href="${PersonalPage.#viewerPath(entry)}">
    <h2 class="personal-cover__title">${entry.title}</h2>
    ${entry.summary ? html`<p class="personal-cover__summary" data-summary>${entry.summary}</p>` : ''}
    <p class="personal-cover__meta"><b>阅读 ${PageShell.icon('ArrowRight', 14)}</b>${PersonalPage.#day(model.m, entry)}<span>第 ${entry.version} 版</span></p>
  </a>
  ${model.isOwner ? PersonalPage.#ownerTools(entry, true) : ''}
</section>`
  }

  // Grouped by the year each was last updated, newest first, the way a writer's archive reads.
  static #years(entries: ArtifactSummary[], model: PersonalPageModel): SafeHtml {
    const entriesByYear = new Map<number, ArtifactSummary[]>()
    for (const entry of entries) {
      const year = new Date(entry.updatedAt).getFullYear()
      entriesByYear.set(year, [...(entriesByYear.get(year) ?? []), entry])
    }
    return html`${[...entriesByYear].map(([year, entriesOfYear]) => html`<section class="personal-year" aria-label="${year} 年">
  <p class="personal-year__mark">${year}</p>
  <ol class="personal-entries">${entriesOfYear.map(entry => PersonalPage.#entry(entry, model))}</ol>
</section>`)}`
  }

  static #entry(entry: ArtifactSummary, model: PersonalPageModel): SafeHtml {
    const previewUrl = model.previewUrls.get(entry.artifactId)
    const recentlyRevised = PersonalPages.recentlyRevised(entry, model.now)
    return html`<li class="personal-entry" data-entry="${entry.artifactId}" data-preview-url="${previewUrl ?? ''}">
  <a class="personal-entry__link" href="${PersonalPage.#viewerPath(entry)}">
    <span class="personal-entry__arrow" aria-hidden="true">${PageShell.icon('ArrowRight', 16)}</span>
    <h3 class="personal-entry__title">${entry.title}${recentlyRevised ? html`<span class="personal-fresh" title="${entry.currentVersionNote ?? ''}">刚更新</span>` : ''}</h3>
    ${entry.summary ? html`<p class="personal-entry__summary" data-summary>${entry.summary}</p>` : ''}
    <p class="personal-entry__meta">${PersonalPage.#day(model.m, entry)}<span>第 ${entry.version} 版</span></p>
  </a>
  ${model.isOwner ? PersonalPage.#ownerTools(entry, false) : ''}
</li>`
  }

  static #ownerTools(entry: ArtifactSummary, isPinned: boolean): SafeHtml {
    return html`<div class="personal-tools">
  <button type="button" class="xxd-btn personal-tool" data-variant="ghost" data-size="xs" data-pin="${isPinned ? 'off' : 'on'}" data-artifact-id="${entry.artifactId}">${isPinned ? '取消置顶' : '置顶'}</button>
  <button type="button" class="xxd-btn personal-tool" data-variant="ghost" data-size="xs" data-edit-summary data-artifact-id="${entry.artifactId}">改摘要</button>
</div>`
  }

  static #empty(model: PersonalPageModel): SafeHtml {
    const text = model.isOwner ? '还没有列出的文档。打开一篇文档，在「分享」里打开公开链接，再打开「列在我的主页」。' : '这里还没有公开的文档。'
    return html`<div class="xxd-empty personal-empty"><p class="xxd-empty__text">${text}</p></div>`
  }

  static #day(m: Messages, entry: ArtifactSummary): SafeHtml {
    return html`<time datetime="${new Date(entry.updatedAt).toISOString()}" data-day>${dayText(m.time, entry.updatedAt)}</time>`
  }

  static #viewerPath(entry: ArtifactSummary): string {
    return `/a/${encodeURIComponent(entry.artifactId)}`
  }
}
