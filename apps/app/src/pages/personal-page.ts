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
${model.isOwner ? PersonalPage.#ownerBar(model.m) : ''}
<main class="personal__page" id="main" tabindex="-1">
${PersonalPage.#header(model)}
${pinned ? PersonalPage.#cover(pinned, model) : ''}
${listedBelow.length > 0 ? PersonalPage.#years(listedBelow, model) : ''}
${model.entries.length === 0 ? PersonalPage.#empty(model) : ''}
<footer class="personal__colophon">${model.m.personal.colophon(html`<a href="/">Open Artifact</a>`)}</footer>
</main>
<div class="personal-peek" aria-hidden="true" data-peek></div>
</div>
${PageShell.jsonData('personal-config', { handle: model.profile.handle, isOwner: model.isOwner, pinnedArtifactId: pinned?.artifactId ?? null })}`
    return PageShell.render({
      m: model.m,
      title: `${model.name} · Open Artifact`,
      description: model.profile.bio || model.m.personal.description({ name: model.name, count: model.entries.length }),
      body,
      scripts: ['common.js', 'personal.js'],
      styles: ['personal.css'],
      frameOrigin: model.usercontentOrigin,
      publicCard: { url: model.pageUrl, kind: 'profile' },
    })
  }

  static #ownerBar(m: Messages): SafeHtml {
    return html`<div class="personal-owner-bar"><span>${m.personal.ownerBar.text}</span><a class="xxd-link" href="/">${m.personal.ownerBar.back}</a></div>`
  }

  static #header(model: PersonalPageModel): SafeHtml {
    const { m, profile, name, isOwner } = model
    const shareText = m.personal.shareText(name)
    const shareOnX = `https://x.com/intent/post?url=${encodeURIComponent(model.pageUrl)}&text=${encodeURIComponent(shareText)}`
    return html`<header class="personal-head">
  <span class="personal-head__avatar" aria-hidden="true">${PageShell.initialOf(name)}</span>
  <h1 class="personal-head__name">${name}<small>${m.personal.entryCount(model.entries.length)}</small></h1>
  <div class="personal-head__bio" data-bio-slot>${PersonalPage.#bio(m, profile.bio, isOwner)}</div>
  <a class="xxd-btn personal-head__share" data-size="sm" href="${shareOnX}" target="_blank" rel="noopener noreferrer">${PageShell.icon('Share2', 14)}${m.personal.sharePage}</a>
</header>`
  }

  // The owner edits the line in place; strangers see nothing at all when it is empty.
  static #bio(m: Messages, bio: string, isOwner: boolean): SafeHtml | string {
    if (!isOwner) return bio ? html`<p class="personal-head__bio-text">${bio}</p>` : ''
    const label = bio ? m.personal.bio.edit : m.personal.bio.add
    return html`<button type="button" class="personal-head__bio-edit" data-edit-bio data-empty="${bio === ''}" aria-label="${label}" title="${label}">${bio || m.personal.bio.placeholder}</button>`
  }

  static #cover(entry: ArtifactSummary, model: PersonalPageModel): SafeHtml {
    return html`<section class="personal-cover" aria-label="${model.m.personal.pinnedLabel}" data-entry="${entry.artifactId}">
  <p class="personal-label">${model.m.personal.pinnedLabel}</p>
  <a class="personal-cover__link" href="${PersonalPage.#viewerPath(entry)}">
    <h2 class="personal-cover__title">${entry.title}</h2>
    ${entry.summary ? html`<p class="personal-cover__summary" data-summary>${entry.summary}</p>` : ''}
    <p class="personal-cover__meta"><b>${model.m.personal.read} ${PageShell.icon('ArrowRight', 14)}</b>${PersonalPage.#day(model.m, entry)}<span>${model.m.personal.version(entry.version)}</span></p>
  </a>
  ${model.isOwner ? PersonalPage.#ownerTools(model.m, entry, true) : ''}
</section>`
  }

  // Grouped by the year each was last updated, newest first, the way a writer's archive reads.
  static #years(entries: ArtifactSummary[], model: PersonalPageModel): SafeHtml {
    const entriesByYear = new Map<number, ArtifactSummary[]>()
    for (const entry of entries) {
      const year = new Date(entry.updatedAt).getFullYear()
      entriesByYear.set(year, [...(entriesByYear.get(year) ?? []), entry])
    }
    return html`${[...entriesByYear].map(([year, entriesOfYear]) => html`<section class="personal-year" aria-label="${model.m.personal.year(year)}">
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
    <h3 class="personal-entry__title">${entry.title}${recentlyRevised ? html`<span class="personal-fresh" title="${entry.currentVersionNote ?? ''}">${model.m.personal.justUpdated}</span>` : ''}</h3>
    ${entry.summary ? html`<p class="personal-entry__summary" data-summary>${entry.summary}</p>` : ''}
    <p class="personal-entry__meta">${PersonalPage.#day(model.m, entry)}<span>${model.m.personal.version(entry.version)}</span></p>
  </a>
  ${model.isOwner ? PersonalPage.#ownerTools(model.m, entry, false) : ''}
</li>`
  }

  static #ownerTools(m: Messages, entry: ArtifactSummary, isPinned: boolean): SafeHtml {
    return html`<div class="personal-tools">
  <button type="button" class="xxd-btn personal-tool" data-variant="ghost" data-size="xs" data-pin="${isPinned ? 'off' : 'on'}" data-artifact-id="${entry.artifactId}">${isPinned ? m.personal.unpin : m.personal.pin}</button>
  <button type="button" class="xxd-btn personal-tool" data-variant="ghost" data-size="xs" data-edit-summary data-artifact-id="${entry.artifactId}">${m.personal.editSummary}</button>
</div>`
  }

  static #empty(model: PersonalPageModel): SafeHtml {
    const text = model.isOwner ? model.m.personal.empty.owner : model.m.personal.empty.visitor
    return html`<div class="xxd-empty personal-empty"><p class="xxd-empty__text">${text}</p></div>`
  }

  static #day(m: Messages, entry: ArtifactSummary): SafeHtml {
    return html`<time datetime="${new Date(entry.updatedAt).toISOString()}" data-day>${dayText(m.time, entry.updatedAt)}</time>`
  }

  static #viewerPath(entry: ArtifactSummary): string {
    return `/a/${encodeURIComponent(entry.artifactId)}`
  }
}
