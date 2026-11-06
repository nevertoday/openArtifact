import type { Identity } from '../auth/request-identity.ts'
import { html, SafeHtml } from './html.ts'

/** Kit icon names the pages use; the union keeps a misspelt name from reaching the browser. */
export type IconName =
  | 'ArrowLeft'
  | 'Bot'
  | 'Clock'
  | 'Copy'
  | 'FileX'
  | 'Globe'
  | 'History'
  | 'Inbox'
  | 'LayoutGrid'
  | 'LayoutTemplate'
  | 'Lock'
  | 'LockKeyhole'
  | 'LogOut'
  | 'MailCheck'
  | 'MessageSquareText'
  | 'SearchX'
  | 'Search'
  | 'Settings'
  | 'Share2'
  | 'TriangleAlert'
  | 'UserRound'
  | 'Users'
  | 'X'

/** Sizes on the kit's icon scale: beside text, inside controls, toolbar, navigation. */
type IconSize = 14 | 16 | 18 | 20 | 24

export interface PageOptions {
  title: string
  body: SafeHtml
  /** Scripts under /static, loaded as modules after the body. */
  scripts?: string[]
  status?: number
  headers?: Record<string, string>
  /** Open Graph description for link previews in chat apps. */
  description?: string
  /** The one origin this page may frame: the usercontent Worker on the viewer page. */
  frameOrigin?: string
}

export class PageShell {
  static render(options: PageOptions): Response {
    const page = html`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
<meta property="og:title" content="${options.title}">
<meta property="og:site_name" content="Open Artifact">
${options.description ? html`<meta name="description" content="${options.description}"><meta property="og:description" content="${options.description}">` : ''}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<script src="/static/vendor/xxd/boot.js" data-key="open-artifact" data-default-theme="system"></script>
<link rel="stylesheet" href="/static/vendor/xxd/xxd.css">
<script src="/static/vendor/xxd/icons.js"></script>
<script src="/static/vendor/xxd/xxd.js"></script>
<link rel="stylesheet" href="/static/app.css">
</head>
<body class="xxd-page">${options.body}${(options.scripts ?? []).map(script => html`<script type="module" src="/static/${script}"></script>`)}</body>
</html>`
    return new Response(page.markup, {
      status: options.status ?? 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': PageShell.#contentSecurityPolicy(options.frameOrigin),
        ...options.headers,
      },
    })
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
  static topBar(identity: Identity | null, middle: SafeHtml | string = ''): SafeHtml {
    const account = identity ? PageShell.#accountMenu(identity) : html`<a class="xxd-btn" data-size="sm" href="/login">登录</a>`
    return html`<header class="xxd-topbar app-topbar">${PageShell.brandLink()}${middle}<span class="app-topbar__end">${account}</span></header>`
  }

  /** The top bar of standalone pages that offer nothing but the way home. */
  static brandBar(): SafeHtml {
    return html`<header class="xxd-topbar app-topbar">${PageShell.brandLink()}</header>`
  }

  /** Home and settings: side navigation beside one content column. */
  static withSidebar(sidebar: SafeHtml, main: SafeHtml): SafeHtml {
    return html`<div class="app-frame">${sidebar}<main class="app-main">${main}</main></div>`
  }

  static workspaceSwitcher(identity: Identity): SafeHtml {
    if (identity.memberships.length < 2) return html`<span class="xxd-text app-workspace-name" data-variant="secondary">${identity.membership.workspace.name}</span>`
    const currentWorkspaceId = identity.membership.workspace.workspaceId
    return html`<label class="xxd-select app-workspace-switcher" data-size="sm"><span class="xxd-sr-only">切换 workspace</span>
<select id="workspace-switcher" data-switch-workspace>
  ${identity.memberships.map(membership => html`<option value="${membership.workspace.workspaceId}" ${membership.workspace.workspaceId === currentWorkspaceId ? new SafeHtml('selected') : ''}>${membership.workspace.name}</option>`)}
</select></label>`
  }

  static initialOf(name: string): string {
    return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
  }

  /** Data for page scripts; `<` is escaped so the JSON can never close the script element. */
  static jsonData(elementId: string, value: unknown): SafeHtml {
    const json = JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
    return html`<script type="application/json" id="${elementId}">${new SafeHtml(json)}</script>`
  }

  static #accountMenu(identity: Identity): SafeHtml {
    const menuLink = (href: string, icon: IconName, label: string) =>
      html`<a class="xxd-menu__item" role="menuitem" href="${href}">${PageShell.icon(icon, 14)}${label}</a>`
    return html`<button type="button" class="xxd-btn app-account-button" data-variant="ghost" data-icon-only data-xxd-menu="account-menu" aria-label="账户菜单：${identity.name}"><span class="xxd-avatar">${PageShell.initialOf(identity.name)}</span></button>
<div class="xxd-menu" id="account-menu" role="menu" popover>
  <div class="xxd-menu__label xxd-text-pair app-account-head"><span class="xxd-text">${identity.name}</span><span class="xxd-text" data-variant="caption">${identity.email}</span></div>
  <div class="xxd-menu__sep" role="separator"></div>
  ${menuLink('/settings/agents', 'Bot', 'Agent 接入')}
  ${menuLink('/settings/profile', 'UserRound', '个人资料')}
  ${menuLink('/settings/members', 'Users', '成员')}
  <div class="xxd-menu__sep" role="separator"></div>
  <button type="button" class="xxd-menu__item" role="menuitem" data-sign-out>${PageShell.icon('LogOut', 14)}退出登录</button>
</div>`
  }
}
