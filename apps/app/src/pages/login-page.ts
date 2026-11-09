import type { Messages } from '../i18n/messages.ts'
import type { LoginProvider } from '../auth/open-artifact-auth.ts'
import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

const AGENTS_ON_STAGE = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI']
const SIGN_IN_CODE_DIGITS = 6
/** Paper tints for the wall of pages behind the pitch: what agents publish, drawn without anyone's real content. */
const WALL_PAGE_TONES = ['#f4efe7', '#e9f0fd', '#eaf6ee', '#fdeee6', '#f3eefc', '#ffffff', '#fef6dc', '#e5f3f5', '#f6e9ef', '#eef0f3', '#fff4ea', '#ecf5e6']

// Brand marks as their owners publish them; the icon set has neither.
const PROVIDER_MARKS: Record<string, SafeHtml> = {
  github: html`<svg class="login-provider__mark" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`,
  google: html`<svg class="login-provider__mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
}

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
    // Every provider button is outlined, so the one filled button on the card is the email form's.
    const providerButtons = providers.map(provider =>
      html`<button type="button" class="xxd-btn login-provider" data-block data-provider-id="${provider.providerId}" data-provider-kind="${provider.kind}">${PROVIDER_MARKS[provider.providerId] ?? PageShell.icon('LockKeyhole')}${m.login.signInWith(provider.label ?? m.login.companySso)}</button>`)
    const body = html`<div class="login-page">
  <section class="login-story" data-theme="dark">
    <div class="login-wall" aria-hidden="true">${WALL_PAGE_TONES.map(tone => html`<span class="login-wall__page" style="--tone: ${tone}"><i></i><i></i><b></b><b></b></span>`)}</div>
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
      ${invitation ? LoginPage.#invitationBanner(m, invitation) : html`<p class="xxd-auth__line" data-email-step-intro>${m.login.intro}</p>`}
      ${nextPath !== '/' && !invitation ? html`<p class="xxd-auth__line">${m.login.returnsToPage}</p>` : ''}
      <div class="xxd-banner" data-tone="danger" id="login-error" role="alert" hidden>${PageShell.icon('TriangleAlert')}<p class="xxd-banner__text" data-error-text></p></div>
      <form id="email-step" data-xxd-validate>
        ${providers.length > 0 ? html`${providerButtons}<div class="xxd-auth__or">${m.login.orWithEmail}</div>` : ''}
        <div class="xxd-field">
          <label class="xxd-label" for="login-email">${m.login.emailLabel}</label>
          <input id="login-email" class="xxd-input" name="email" type="email" autocomplete="email" required placeholder="name@example.com" data-error-required="${m.login.errorRequired}" data-error-type="${m.login.errorInvalid}" data-error-not-admitted="${m.login.errorNotAdmitted}">
        </div>
        <button type="submit" class="xxd-btn" data-variant="primary" data-block>${m.login.sendCode}</button>
      </form>
      <form id="code-step" hidden>
        <p class="xxd-auth__line">${m.login.codeSentTo(html`<strong class="login-card__address" data-sent-to></strong>`)} · <button type="button" class="xxd-link" data-change-email>${m.login.changeEmail}</button></p>
        <div class="login-code">
          <div class="login-code__cells" aria-hidden="true">${Array.from({ length: SIGN_IN_CODE_DIGITS }, () => html`<span class="login-code__cell"></span>`)}</div>
          <input id="login-code" class="login-code__input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="${SIGN_IN_CODE_DIGITS}" aria-label="${m.login.codeLabel}" required>
        </div>
        <div class="login-code__resend"><span>${m.login.noMail}</span><button type="button" class="xxd-link" data-resend></button></div>
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
