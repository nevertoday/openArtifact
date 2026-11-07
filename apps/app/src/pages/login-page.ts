import type { Messages } from '../i18n/messages.ts'
import type { LoginProvider } from '../auth/open-artifact-auth.ts'
import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

const AGENTS_ON_STAGE = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI']

/** The invite a person followed to the login page. */
export interface LoginInvitation {
  inviterName: string
  workspaceName: string
  /** The address an email invite was sent to; null for a link anyone may use. */
  email: string | null
}

export class LoginPage {
  /** `nextPath` is where to land after sign-in; only same-site paths are accepted. */
  static render(m: Messages, providers: LoginProvider[], nextPath: string, invitation: LoginInvitation | null = null): Response {
    const providerButtons = providers.map((provider, index) =>
      html`<button type="button" class="xxd-btn" data-block ${index === 0 ? html`data-variant="primary"` : ''} data-provider-id="${provider.providerId}" data-provider-kind="${provider.kind}">${m.login.signInWith(provider.label ?? m.login.companySso)}</button>`)
    const body = html`<div class="login-page">
  <section class="login-story" data-theme="dark">
    ${PageShell.brandLink()}
    <div class="login-story__pitch">
      <h1 class="xxd-text" data-variant="display">${m.login.story.headlineFirst}<br>${m.login.story.headlineSecond}</h1>
      <p class="xxd-text" data-variant="secondary">${m.login.story.pitch}</p>
      <div class="xxd-cluster">${AGENTS_ON_STAGE.map(agent => html`<span class="xxd-badge">${PageShell.icon('Bot', 14)}${agent}</span>`)}</div>
    </div>
    <footer class="xxd-text" data-variant="caption">${m.login.story.storage}</footer>
  </section>
  <main class="login-panel" id="main" tabindex="-1">
    <div class="login-panel__locale">${PageShell.localeSwitch(m)}</div>
    <div class="xxd-auth login-card" data-next-path="${nextPath}">
      <h2 class="xxd-auth__name">${m.login.heading}</h2>
      ${invitation ? LoginPage.#invitationBanner(m, invitation) : html`<p class="xxd-auth__line">${m.login.intro}</p>`}
      ${nextPath !== '/' && !invitation ? html`<p class="xxd-auth__line">${m.login.returnsToPage}</p>` : ''}
      <div class="xxd-banner" data-tone="success" id="magic-link-sent" role="status" hidden>${PageShell.icon('MailCheck')}<p class="xxd-banner__text">${m.login.linkSent(html`<strong class="login-card__address" data-sent-to></strong>`)}</p></div>
      <div class="xxd-banner" data-tone="danger" id="login-error" role="alert" hidden>${PageShell.icon('TriangleAlert')}<p class="xxd-banner__text" data-error-text></p></div>
      <form id="magic-link-form" data-xxd-validate>
        ${providers.length > 0 ? html`${providerButtons}<div class="xxd-auth__or">${m.login.orWithEmail}</div>` : ''}
        <div class="xxd-field">
          <label class="xxd-label" for="login-email">${m.login.emailLabel}</label>
          <input id="login-email" class="xxd-input" name="email" type="email" autocomplete="email" required placeholder="name@example.com" data-error-required="${m.login.errorRequired}" data-error-type="${m.login.errorInvalid}" data-error-not-admitted="${m.login.errorNotAdmitted}">
        </div>
        <button type="submit" class="xxd-btn" data-variant="primary" data-block>${m.login.sendLink}</button>
      </form>
    </div>
  </main>
</div>`
    return PageShell.render({ m, title: m.login.pageTitle, body, scripts: ['login.js'] })
  }

  static #invitationBanner(m: Messages, invitation: LoginInvitation): SafeHtml {
    const howToJoin = invitation.email === null ? m.login.invitation.joinAfterSignIn : html`${m.login.invitation.joinAs(html`<strong>${invitation.email}</strong>`)}`
    return html`<div class="xxd-banner" data-size="sm" role="status">${PageShell.icon('UserPlus')}<div>
  <p class="xxd-banner__title">${m.login.invitation.title({ inviter: invitation.inviterName, workspace: invitation.workspaceName })}</p>
  <p class="xxd-banner__text">${howToJoin}</p>
</div></div>`
  }
}
