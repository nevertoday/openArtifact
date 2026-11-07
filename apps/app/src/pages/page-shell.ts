import { LOCALES } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import { messagesFor, type Messages } from '../i18n/messages.ts'
import { fullTimeText, relativeTimeText } from '../../public/static/time-text.js'
import { html, SafeHtml } from './html.ts'
import { SETTINGS_SECTION_ICONS, SETTINGS_SECTIONS } from './settings-sections.ts'

/** Kit icon names the pages use; the union keeps a misspelt name from reaching the browser. */
export type IconName =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Bell'
  | 'Bot'
  | 'Check'
  | 'ChevronDown'
  | 'Clock'
  | 'Columns2'
  | 'Copy'
  | 'Database'
  | 'ExternalLink'
  | 'FileX'
  | 'Ellipsis'
  | 'Globe'
  | 'History'
  | 'House'
  | 'Inbox'
  | 'LayoutGrid'
  | 'LayoutTemplate'
  | 'Link'
  | 'Lock'
  | 'LockKeyhole'
  | 'LogOut'
  | 'MailCheck'
  | 'MailX'
  | 'MessageSquare'
  | 'MessageSquareText'
  | 'Pen'
  | 'Plus'
  | 'RotateCcw'
  | 'SearchX'
  | 'Search'
  | 'Settings'
  | 'Share2'
  | 'ShieldCheck'
  | 'Trash2'
  | 'TriangleAlert'
  | 'UserMinus'
  | 'UserPlus'
  | 'UserRound'
  | 'Users'
  | 'X'

/** Sizes on the kit's icon scale: beside text, inside controls, toolbar, navigation. */
type IconSize = 14 | 16 | 18 | 20 | 24

export interface PageOptions {
  /** The page language's messages; the page is marked up in that language. */
  m: Messages
  title: string
  body: SafeHtml
  /** Scripts under /static, loaded as modules after the body. */
  scripts?: string[]
  /** Stylesheets under /static that only this page needs, after the app's own. */
  styles?: string[]
  status?: number
  headers?: Record<string, string>
  /** Open Graph description for link previews in chat apps. */
  description?: string
  /** The one origin this page may frame: the usercontent Worker on the viewer page. */
  frameOrigin?: string
  /**
   * A page meant for strangers to find: a personal page, or an artifact listed on one. Search engines are told
   * to leave every other page alone, a public link sent to one person included.
   */
  publicCard?: PublicCard
}

/** How a page meant for strangers looks when its link is shared, on X and in chat apps alike. */
export interface PublicCard {
  url: string
  kind: 'article' | 'profile'
}

export class PageShell {
  static render(options: PageOptions): Response {
    const page = html`<!doctype html>
<html lang="${options.m.meta.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
<meta property="og:title" content="${options.title}">
<meta property="og:site_name" content="Open Artifact">
${options.description ? html`<meta name="description" content="${options.description}"><meta property="og:description" content="${options.description}">` : ''}
${PageShell.#publicCardMeta(options)}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<script src="/static/vendor/xxd/boot.js" data-key="open-artifact" data-default-theme="system"></script>
<link rel="stylesheet" href="/static/vendor/xxd/xxd.css">
<script src="/static/vendor/xxd/icons.js"></script>
<script src="/static/vendor/xxd/xxd.js"></script>
<link rel="stylesheet" href="/static/app.css">
${PageShell.#messagePreloads(options)}
${(options.styles ?? []).map(style => html`<link rel="stylesheet" href="/static/${style}">`)}
</head>
<body class="xxd-page"><a class="xxd-sr-only-focusable" href="#main">${options.m.shell.skipToContent}</a>${options.body}${(options.scripts ?? []).map(script => html`<script type="module" src="/static/${script}"></script>`)}</body>
</html>`
    return new Response(page.markup, {
      status: options.status ?? 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': PageShell.#contentSecurityPolicy(options.frameOrigin),
        ...(options.publicCard ? {} : { 'X-Robots-Tag': 'noindex' }),
        ...options.headers,
      },
    })
  }

  // A small summary card: the title and description carry it, so no picture has to be made for each page.
  static #publicCardMeta(options: PageOptions): SafeHtml {
    if (!options.publicCard) return html`<meta name="robots" content="noindex">`
    const { url, kind } = options.publicCard
    return html`<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="${kind}">
<meta property="og:locale" content="${options.m.meta.ogLocale}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${options.title}">
${options.description ? html`<meta name="twitter:description" content="${options.description}">` : ''}`
  }

  // Page scripts load the page language's messages (common.js loadMessages); preloading them saves a round trip.
  static #messagePreloads(options: PageOptions): SafeHtml | string {
    if (!options.scripts?.length) return ''
    const { lang } = options.m.meta
    const files = [`${lang}.js`, ...Object.keys(options.m).map(namespace => `${lang}/${namespace}.js`)]
    return html`${files.map(file => html`<link rel="modulepreload" href="/static/i18n/${file}">`)}`
  }

  // Only our own scripts run on app pages, so text from agents or people can never execute here even if escaping slipped.
  static #contentSecurityPolicy(frameOrigin: string | undefined): string {
    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      `frame-src ${frameOrigin ?? "'none'"}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  }

  static icon(name: IconName, size: IconSize = 16): SafeHtml {
    return html`<i data-xxd-icon="${name}" data-size="${size}" aria-hidden="true"></i>`
  }

  static brandLink(): SafeHtml {
    return html`<a class="app-brand" href="/">${PageShell.icon('LayoutTemplate', 20)}<span>Open Artifact</span></a>`
  }

  /** The page's top bar; `middle` sits between the brand and the account menu. */
  static topBar(m: Messages, identity: Identity | null, middle: SafeHtml | string = ''): SafeHtml {
    const account = identity ? PageShell.accountControls(m, identity) : html`${PageShell.localeSwitch(m)}<a class="xxd-btn" data-size="sm" href="/login">${m.shell.signIn}</a>`
    return html`<header class="xxd-topbar app-topbar">${PageShell.brandLink()}${middle}<span class="app-topbar__end">${account}</span></header>`
  }

  /** The notification bell and the account menu, for a top bar of the page's own. */
  static accountControls(m: Messages, identity: Identity): SafeHtml {
    return html`${PageShell.#notificationBell(m)}${PageShell.#accountMenu(m, identity)}`
  }

  /** The top bar of standalone pages that offer nothing but the way home. */
  static brandBar(m: Messages): SafeHtml {
    return html`<header class="xxd-topbar app-topbar">${PageShell.brandLink()}<span class="app-topbar__end">${PageShell.localeSwitch(m)}</span></header>`
  }

  /** Home and settings: side navigation beside one content column. Every page's main region is #main, where the skip link leads. */
  static withSidebar(sidebar: SafeHtml, main: SafeHtml): SafeHtml {
    return html`<div class="app-frame">${sidebar}<main class="app-main" id="main" tabindex="-1">${main}</main></div>`
  }

  static workspaceSwitcher(m: Messages, identity: Identity): SafeHtml {
    if (identity.memberships.length < 2) return html`<span class="xxd-text app-workspace-name" data-variant="secondary">${identity.membership.workspace.name}</span>`
    const currentWorkspaceId = identity.membership.workspace.workspaceId
    return html`<label class="xxd-select app-workspace-switcher" data-size="sm"><span class="xxd-sr-only">${m.shell.switchWorkspace}</span>
<select id="workspace-switcher" data-switch-workspace>
  ${identity.memberships.map(membership => html`<option value="${membership.workspace.workspaceId}" ${membership.workspace.workspaceId === currentWorkspaceId ? new SafeHtml('selected') : ''}>${membership.workspace.name}</option>`)}
</select></label>`
  }

  /** How long ago, with the full time on hover; common.js re-renders it in the reader's time zone. */
  static relativeTime(m: Messages, timestamp: number, now: number): SafeHtml {
    return html`<time datetime="${new Date(timestamp).toISOString()}" title="${fullTimeText(timestamp)}" data-relative>${relativeTimeText(m.time, timestamp, now)}</time>`
  }

  /**
   * Picks the interface language without any script: the form posts to /locale, which remembers the choice and
   * comes back to this page. Each language is named in itself, so a reader who cannot read the page still finds theirs.
   */
  static localeSwitch(m: Messages, role: 'menu' | 'bar' = 'bar'): SafeHtml {
    const choice = (locale: (typeof LOCALES)[number]) => {
      const current = locale === m.meta.lang
      return role === 'menu'
        ? html`<button type="submit" class="xxd-menu__item" role="menuitemradio" aria-checked="${String(current)}" name="locale" value="${locale}" lang="${locale}">${PageShell.icon(current ? 'Check' : 'Globe', 14)}${messagesFor(locale).meta.name}</button>`
        : html`<button type="submit" class="xxd-btn" data-variant="ghost" data-size="xs" name="locale" value="${locale}" lang="${locale}" aria-pressed="${String(current)}">${messagesFor(locale).meta.name}</button>`
    }
    return html`<form method="post" action="/locale" class="${role === 'bar' ? 'xxd-btn-group app-locale-switch' : 'app-locale-switch'}" aria-label="${m.shell.language}">${LOCALES.map(choice)}</form>`
  }

  static initialOf(name: string): string {
    return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
  }

  /** Data for page scripts; `<` is escaped so the JSON can never close the script element. */
  static jsonData(elementId: string, value: unknown): SafeHtml {
    const json = JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
    return html`<script type="application/json" id="${elementId}">${new SafeHtml(json)}</script>`
  }

  // common.js fills the count and the list; the list refreshes each time the panel opens. Small, like every other control in a top bar.
  static #notificationBell(m: Messages): SafeHtml {
    return html`<button type="button" class="xxd-btn app-bell" data-variant="ghost" data-size="sm" data-icon-only data-xxd-popover="notification-panel" aria-label="${m.shell.notifications}" data-notification-bell>${PageShell.icon('Bell', 18)}<span class="xxd-badge app-bell__count" data-variant="solid" data-tone="action" aria-hidden="true" data-unread-count hidden></span></button>
<div class="xxd-popover app-notifications" id="notification-panel" popover data-placement="bottom-end" aria-label="${m.shell.notifications}">
  <div class="app-notifications__head"><p class="xxd-popover__title">${m.shell.notifications}</p><button type="button" class="xxd-btn" data-variant="ghost" data-size="xs" data-mark-all-read hidden>${m.shell.markAllRead}</button></div>
  <div class="app-notifications__body" data-notification-list></div>
</div>`
  }

  static #accountMenu(m: Messages, identity: Identity): SafeHtml {
    const menuLink = (section: (typeof SETTINGS_SECTIONS)[number]) =>
      html`<a class="xxd-menu__item" role="menuitem" href="/settings/${section}">${PageShell.icon(SETTINGS_SECTION_ICONS[section], 14)}${m.settings.sections[section]}</a>`
    return html`<button type="button" class="xxd-btn app-account-button" data-variant="ghost" data-size="sm" data-icon-only data-xxd-menu="account-menu" aria-label="${m.shell.accountMenu(identity.name)}" data-account-button><span class="xxd-avatar" data-account-initial>${identity.hasChosenName ? PageShell.initialOf(identity.name) : PageShell.icon('UserRound', 16)}</span></button>
<div class="xxd-menu" id="account-menu" role="menu" popover>
  <div class="xxd-menu__label xxd-text-pair app-account-head"><span class="xxd-text" data-account-name>${identity.name}</span><span class="xxd-text" data-variant="caption">${identity.email}</span></div>
  <div class="xxd-menu__sep" role="separator"></div>
  <a class="xxd-menu__item" role="menuitem" href="/@me">${PageShell.icon('UserRound', 14)}${m.shell.myPage}</a>
  ${SETTINGS_SECTIONS.map(menuLink)}
  <div class="xxd-menu__sep" role="separator"></div>
  <div class="xxd-menu__label">${m.shell.language}</div>
  ${PageShell.localeSwitch(m, 'menu')}
  <div class="xxd-menu__sep" role="separator"></div>
  <button type="button" class="xxd-menu__item" role="menuitem" data-sign-out>${PageShell.icon('LogOut', 14)}${m.shell.signOut}</button>
</div>`
  }
}
