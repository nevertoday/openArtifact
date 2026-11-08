import { LOCALES, WorkspaceDeletion, type DeletedWorkspace, type Locale, type Membership, type Workspace } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import { messagesFor, type Messages } from '../i18n/messages.ts'
import { fullTimeText, relativeTimeText } from '../../public/static/time-text.js'
import { ArtifactLabels } from './artifact-labels.ts'
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
  /** The 1200 × 630 picture with the title drawn in it; `alt` says in words what it shows. */
  image: { url: string; alt: string }
}

const CARD_IMAGE_WIDTH = 1200
const CARD_IMAGE_HEIGHT = 630

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
        // Other sites learn only our origin, never an artifact's address and the words in it.
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': PageShell.#contentSecurityPolicy(options.frameOrigin),
        ...(options.publicCard ? {} : { 'X-Robots-Tag': 'noindex' }),
        ...options.headers,
      },
    })
  }

  // A large picture card: X may show only the picture and the site's name, so the title is drawn into the picture.
  static #publicCardMeta(options: PageOptions): SafeHtml {
    if (!options.publicCard) return html`<meta name="robots" content="noindex">`
    const { url, kind, image } = options.publicCard
    return html`<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="${kind}">
<meta property="og:locale" content="${options.m.meta.ogLocale}">
<meta property="og:image" content="${image.url}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${String(CARD_IMAGE_WIDTH)}">
<meta property="og:image:height" content="${String(CARD_IMAGE_HEIGHT)}">
<meta property="og:image:alt" content="${image.alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image.url}">
<meta name="twitter:image:alt" content="${image.alt}">
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

  /** X's mark, which the kit's icon set does not carry; drawn in the text colour beside a label that names it. */
  static xLogo(size: IconSize = 14): SafeHtml {
    return html`<svg class="app-x-logo" width="${String(size)}" height="${String(size)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
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

  /**
   * The workspace menu: every workspace the person is in, the current one checked and the personal one marked, then
   * a way to create one and, for an admin with deleted workspaces still restorable, a way to bring them back.
   */
  static workspaceSwitcher(m: Messages, identity: Identity, deletedWorkspaces: DeletedWorkspace[], now: number): SafeHtml {
    const current = identity.membership.workspace
    const isPersonal = (workspace: Workspace) => workspace.personalOf === identity.userId
    const workspaceItem = ({ workspace }: Membership) => {
      const isCurrent = workspace.workspaceId === current.workspaceId
      return html`<button type="button" class="xxd-menu__item app-workspace-menu__item" role="menuitemradio" aria-checked="${String(isCurrent)}" data-switch-workspace="${workspace.workspaceId}">${PageShell.icon(isPersonal(workspace) ? 'UserRound' : 'Users', 14)}<span class="app-workspace-menu__name">${workspace.name}</span>${isPersonal(workspace) ? html`<span class="xxd-badge" data-size="sm">${m.shell.personal}</span>` : ''}</button>`
    }
    return html`<button type="button" class="xxd-btn app-workspace-switcher" data-variant="ghost" data-size="sm" data-xxd-menu="workspace-menu" aria-label="${m.shell.workspaceMenu(current.name)}">${PageShell.icon(isPersonal(current) ? 'UserRound' : 'Users', 16)}<span class="app-workspace-switcher__name">${current.name}</span>${PageShell.icon('ChevronDown', 14)}</button>
<div class="xxd-menu app-workspace-menu" id="workspace-menu" role="menu" popover>
  <div class="xxd-menu__label">${m.shell.workspaces}</div>
  ${identity.memberships.map(workspaceItem)}
  <div class="xxd-menu__sep" role="separator"></div>
  <button type="button" class="xxd-menu__item" role="menuitem" data-xxd-dialog-open="new-workspace-dialog">${PageShell.icon('Plus', 14)}${m.shell.newWorkspace}</button>
  ${deletedWorkspaces.length > 0 ? html`<button type="button" class="xxd-menu__item" role="menuitem" data-xxd-dialog-open="deleted-workspaces-dialog">${PageShell.icon('RotateCcw', 14)}${m.shell.deletedWorkspaces}</button>` : ''}
</div>
${PageShell.#newWorkspaceDialog(m)}
${deletedWorkspaces.length > 0 ? PageShell.#deletedWorkspacesDialog(m, deletedWorkspaces, now) : ''}`
  }

  static #newWorkspaceDialog(m: Messages): SafeHtml {
    const naming = m.shell.newWorkspaceDialog
    return html`<dialog class="xxd-dialog" data-size="sm" id="new-workspace-dialog" aria-labelledby="new-workspace-title">
  <form id="new-workspace-form" novalidate>
    <div class="xxd-dialog__head"><h2 class="xxd-dialog__title" id="new-workspace-title">${naming.title}</h2></div>
    <div class="xxd-dialog__body"><div class="xxd-field">
      <label class="xxd-label" for="new-workspace-name">${naming.nameLabel}</label>
      <input class="xxd-input" id="new-workspace-name" name="name" required maxlength="40" autocomplete="off" aria-describedby="new-workspace-help" data-error-required="${naming.nameRequired}">
      <p class="xxd-help" id="new-workspace-help">${naming.nameHelp}</p>
    </div></div>
    <div class="xxd-dialog__actions"><button type="button" class="xxd-btn" data-xxd-dialog-close>${m.shell.cancel}</button><button type="submit" class="xxd-btn" data-variant="primary">${naming.create}</button></div>
  </form>
</dialog>`
  }

  static #deletedWorkspacesDialog(m: Messages, deletedWorkspaces: DeletedWorkspace[], now: number): SafeHtml {
    const naming = m.shell.deletedWorkspacesDialog
    const row = ({ workspace, deletedAt }: DeletedWorkspace) => html`<li class="xxd-list__item">
    <span class="xxd-list__main"><span class="xxd-list__title">${workspace.name}</span><span class="xxd-list__meta">${ArtifactLabels.purgeIn(m, WorkspaceDeletion.purgeAt(deletedAt), now)}</span></span>
    <button type="button" class="xxd-btn" data-size="xs" data-restore-workspace="${workspace.workspaceId}">${PageShell.icon('RotateCcw', 14)}${naming.restore}</button>
  </li>`
    return html`<dialog class="xxd-dialog" data-size="sm" id="deleted-workspaces-dialog" aria-labelledby="deleted-workspaces-title" aria-describedby="deleted-workspaces-description">
  <div class="xxd-dialog__head"><h2 class="xxd-dialog__title" id="deleted-workspaces-title">${naming.title}</h2></div>
  <div class="xxd-dialog__body xxd-stack"><p class="xxd-text" data-variant="secondary" id="deleted-workspaces-description">${naming.description}</p><ul class="xxd-list">${deletedWorkspaces.map(row)}</ul></div>
  <div class="xxd-dialog__actions"><button type="button" class="xxd-btn" data-xxd-dialog-close>${m.shell.close}</button></div>
</dialog>`
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
    const choice = (locale: Locale) => {
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
    return html`<button type="button" class="xxd-btn app-account-button" data-variant="ghost" data-size="sm" data-icon-only data-xxd-menu="account-menu" aria-label="${m.shell.accountMenu(identity.name)}" data-account-button data-current-workspace="${identity.membership.workspace.workspaceId}"><span class="xxd-avatar" data-account-initial>${identity.hasChosenName ? PageShell.initialOf(identity.name) : PageShell.icon('UserRound', 16)}</span></button>
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
