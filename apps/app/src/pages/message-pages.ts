import type { Messages } from '../i18n/messages.ts'
import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

/** Which password prompt to show; the unlock form redirects back with it, so the address never shows /unlock. */
export type PasswordPrompt = 'ask' | 'wrong' | 'wait'

const PASSWORD_STATUSES: Record<PasswordPrompt, number> = { ask: 200, wrong: 401, wait: 429 }

/** Small standalone pages: a password prompt for protected public links, and errors a person can act on. */
export class MessagePages {
  /** The prompt for a password-protected public link: first asked, after a wrong password, or after too many guesses. */
  static publicLinkPassword(m: Messages, unlockPath: string, prompt: PasswordPrompt): Response {
    const fieldError = prompt === 'ask' ? null : m.messagePages.password.errors[prompt]
    const body = MessagePages.#centered(m, html`<form class="xxd-surface app-center__card" method="post" action="${unlockPath}" data-xxd-validate>
  ${PageShell.icon('LockKeyhole', 24)}
  <div class="xxd-text-pair">
    <h1 class="xxd-text" data-variant="heading2">${m.messagePages.password.title}</h1>
    <p class="xxd-text" data-variant="secondary">${m.messagePages.password.text}</p>
  </div>
  <div class="xxd-field">
    <label class="xxd-label" for="public-link-password">${m.messagePages.password.label}</label>
    <input id="public-link-password" class="xxd-input" name="password" type="password" required autocomplete="off" autofocus data-error-required="${m.messagePages.password.errorRequired}" ${fieldError ? html`aria-invalid="true" aria-describedby="public-link-password-error"` : ''}>
    ${fieldError ? html`<p class="xxd-error" id="public-link-password-error">${fieldError}</p>` : ''}
  </div>
  <button type="submit" class="xxd-btn" data-variant="primary" data-block>${m.messagePages.password.open}</button>
</form>`)
    return PageShell.render({ m, title: m.messagePages.password.pageTitle, body, status: PASSWORD_STATUSES[prompt] })
  }

  /** A member of the workspace who may not open this artifact; the author's name tells them whom to ask. */
  static noAccess(m: Messages, artifactId: string, authorName: string): Response {
    const body = MessagePages.#centered(m, html`<section class="xxd-empty" data-access-request="${artifactId}" data-author-name="${authorName}">
  ${PageShell.icon('Lock', 24)}
  <h1 class="xxd-empty__title">${m.messagePages.noAccess.title}</h1>
  <p class="xxd-empty__text">${m.messagePages.noAccess.text(authorName)}</p>
  <div class="xxd-empty__actions">
    <button type="button" class="xxd-btn" data-variant="primary" data-request-access>${m.messagePages.noAccess.requestAccess}</button>
    <a class="xxd-btn" href="/">${m.messagePages.backHome}</a>
  </div>
  <p class="xxd-text" data-variant="secondary" role="status" data-access-request-status></p>
</section>`)
    return PageShell.render({ m, title: m.messagePages.noAccess.pageTitle, body, status: 403, scripts: ['common.js', 'access-request.js'] })
  }

  /** `loginNextPath` is where sign-in should land for a visitor; null for a person already signed in. */
  static notFound(m: Messages, loginNextPath: string | null): Response {
    const signedIn = loginNextPath === null
    const action = signedIn ? html`<a class="xxd-btn" data-variant="primary" href="/">${m.messagePages.backHome}</a>` : html`<a class="xxd-btn" data-variant="primary" href="/login?next=${encodeURIComponent(loginNextPath)}">${m.shell.signIn}</a>`
    const body = MessagePages.#centered(m, html`<section class="xxd-empty">
  ${PageShell.icon('FileX', 24)}
  <h1 class="xxd-empty__title">${m.messagePages.notFound.title}</h1>
  <p class="xxd-empty__text">${m.messagePages.notFound.text(signedIn)}</p>
  <div class="xxd-empty__actions">${action}</div>
</section>`)
    return PageShell.render({ m, title: m.messagePages.notFound.pageTitle, body, status: 404 })
  }

  /** An address no page answers, or a method no page takes; 405 says so in its status, the page reads the same. */
  static unknownAddress(m: Messages, status: 404 | 405): Response {
    const body = MessagePages.#centered(m, html`<section class="xxd-empty">
  ${PageShell.icon('SearchX', 24)}
  <h1 class="xxd-empty__title">${m.messagePages.unknownAddress.title}</h1>
  <p class="xxd-empty__text">${m.messagePages.unknownAddress.text}</p>
  <div class="xxd-empty__actions"><a class="xxd-btn" data-variant="primary" href="/">${m.messagePages.backHome}</a></div>
</section>`)
    return PageShell.render({ m, title: m.messagePages.unknownAddress.pageTitle, body, status, headers: status === 405 ? { Allow: 'GET, HEAD' } : {} })
  }

  static removedFromWorkspace(m: Messages): Response {
    const body = MessagePages.#centered(m, html`<section class="xxd-empty">
  ${PageShell.icon('UserMinus', 24)}
  <h1 class="xxd-empty__title">${m.messagePages.removedFromWorkspace.title}</h1>
  <p class="xxd-empty__text">${m.messagePages.removedFromWorkspace.text}</p>
  <div class="xxd-empty__actions"><button type="button" class="xxd-btn" data-variant="primary" data-sign-out>${m.shell.signOut}</button></div>
</section>`)
    return PageShell.render({ m, title: m.messagePages.removedFromWorkspace.pageTitle, body, status: 403, scripts: ['common.js'] })
  }

  static inviteUnusable(m: Messages): Response {
    const body = MessagePages.#centered(m, html`<section class="xxd-empty">
  ${PageShell.icon('MailX', 24)}
  <h1 class="xxd-empty__title">${m.messagePages.inviteUnusable.title}</h1>
  <p class="xxd-empty__text">${m.messagePages.inviteUnusable.text}</p>
  <div class="xxd-empty__actions"><a class="xxd-btn" data-variant="primary" href="/login">${m.messagePages.inviteUnusable.goSignIn}</a></div>
</section>`)
    return PageShell.render({ m, title: m.messagePages.inviteUnusable.pageTitle, body, status: 410 })
  }

  static inviteForOtherAddress(m: Messages, invitedEmail: string): Response {
    const body = MessagePages.#centered(m, html`<section class="xxd-empty">
  ${PageShell.icon('MailX', 24)}
  <h1 class="xxd-empty__title">${m.messagePages.inviteForOtherAddress.title(invitedEmail)}</h1>
  <p class="xxd-empty__text">${m.messagePages.inviteForOtherAddress.text}</p>
  <div class="xxd-empty__actions"><button type="button" class="xxd-btn" data-variant="primary" data-sign-out>${m.shell.signOut}</button></div>
</section>`)
    return PageShell.render({ m, title: m.messagePages.inviteForOtherAddress.pageTitle, body, status: 403, scripts: ['common.js'] })
  }

  static #centered(m: Messages, content: SafeHtml): SafeHtml {
    return html`${PageShell.brandBar(m)}<main class="app-center" id="main" tabindex="-1">${content}</main>`
  }
}
