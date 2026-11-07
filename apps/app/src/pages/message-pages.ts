import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

/** Which password prompt to show; the unlock form redirects back with it, so the address never shows /unlock. */
export type PasswordPrompt = 'ask' | 'wrong' | 'wait'

const PASSWORD_ERRORS: Record<PasswordPrompt, string | null> = {
  ask: null,
  wrong: '密码不对，再试一次。',
  wait: '试错次数太多。为了保护这个链接，1 分钟后可以再试。',
}

const PASSWORD_STATUSES: Record<PasswordPrompt, number> = { ask: 200, wrong: 401, wait: 429 }

/** Small standalone pages: a password prompt for protected public links, and errors a person can act on. */
export class MessagePages {
  /** The prompt for a password-protected public link: first asked, after a wrong password, or after too many guesses. */
  static publicLinkPassword(artifactId: string, prompt: PasswordPrompt): Response {
    const fieldError = PASSWORD_ERRORS[prompt]
    const body = MessagePages.#centered(html`<form class="xxd-surface app-center__card" method="post" action="/a/${encodeURIComponent(artifactId)}/unlock" data-xxd-validate>
  ${PageShell.icon('LockKeyhole', 24)}
  <div class="xxd-text-pair">
    <h1 class="xxd-text" data-variant="heading2">这个链接需要密码</h1>
    <p class="xxd-text" data-variant="secondary">这个页面设置了访问密码。向分享给你的人要密码。</p>
  </div>
  <div class="xxd-field">
    <label class="xxd-label" for="public-link-password">访问密码</label>
    <input id="public-link-password" class="xxd-input" name="password" type="password" required autocomplete="off" autofocus data-error-required="输入访问密码" ${fieldError ? html`aria-invalid="true" aria-describedby="public-link-password-error"` : ''}>
    ${fieldError ? html`<p class="xxd-error" id="public-link-password-error">${fieldError}</p>` : ''}
  </div>
  <button type="submit" class="xxd-btn" data-variant="primary" data-block>打开</button>
</form>`)
    return PageShell.render({ title: '需要密码 · Open Artifact', body, status: PASSWORD_STATUSES[prompt] })
  }

  /** A member of the workspace who may not open this artifact; the author's name tells them whom to ask. */
  static noAccess(artifactId: string, authorName: string): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty" data-access-request="${artifactId}" data-author-name="${authorName}">
  ${PageShell.icon('Lock', 24)}
  <h1 class="xxd-empty__title">你没有这个 artifact 的访问权限</h1>
  <p class="xxd-empty__text">它是 ${authorName} 发布的，还没有分享给你。</p>
  <div class="xxd-empty__actions">
    <button type="button" class="xxd-btn" data-variant="primary" data-request-access>请作者分享给你</button>
    <a class="xxd-btn" href="/">回到首页</a>
  </div>
  <p class="xxd-text" data-variant="secondary" role="status" data-access-request-status></p>
</section>`)
    return PageShell.render({ title: '没有访问权限 · Open Artifact', body, status: 403, scripts: ['common.js', 'access-request.js'] })
  }

  /** `loginNextPath` is where sign-in should land for a visitor; null for a person already signed in. */
  static notFound(loginNextPath: string | null): Response {
    const signedIn = loginNextPath === null
    const action = signedIn ? html`<a class="xxd-btn" data-variant="primary" href="/">回到首页</a>` : html`<a class="xxd-btn" data-variant="primary" href="/login?next=${encodeURIComponent(loginNextPath)}">登录</a>`
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('FileX', 24)}
  <h1 class="xxd-empty__title">找不到这个 artifact</h1>
  <p class="xxd-empty__text">它可能已被删除，或者没有分享给你。${signedIn ? '' : '如果它是分享给你的，先登录再打开。'}</p>
  <div class="xxd-empty__actions">${action}</div>
</section>`)
    return PageShell.render({ title: '找不到 · Open Artifact', body, status: 404 })
  }

  /** An address no page answers, or a method no page takes; 405 says so in its status, the page reads the same. */
  static unknownAddress(status: 404 | 405): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('SearchX', 24)}
  <h1 class="xxd-empty__title">这个地址不存在</h1>
  <p class="xxd-empty__text">检查一下链接是否完整，或者从首页找你要的 artifact。</p>
  <div class="xxd-empty__actions"><a class="xxd-btn" data-variant="primary" href="/">回到首页</a></div>
</section>`)
    return PageShell.render({ title: '地址不存在 · Open Artifact', body, status, headers: status === 405 ? { Allow: 'GET, HEAD' } : {} })
  }

  static removedFromWorkspace(): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('UserMinus', 24)}
  <h1 class="xxd-empty__title">你已被移出这个 workspace，请联系管理员</h1>
  <p class="xxd-empty__text">管理员把你移出后，你发布的 artifact 仍留在 workspace 里。如果你用错了账号，退出后换一个登录。</p>
  <div class="xxd-empty__actions"><button type="button" class="xxd-btn" data-variant="primary" data-sign-out>退出登录</button></div>
</section>`)
    return PageShell.render({ title: '已被移出 · Open Artifact', body, status: 403, scripts: ['common.js'] })
  }

  static inviteUnusable(): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('MailX', 24)}
  <h1 class="xxd-empty__title">这个邀请已经失效</h1>
  <p class="xxd-empty__text">邀请 7 天后失效，管理员也可能撤销了它。请管理员重新邀请你。</p>
  <div class="xxd-empty__actions"><a class="xxd-btn" data-variant="primary" href="/login">去登录</a></div>
</section>`)
    return PageShell.render({ title: '邀请已失效 · Open Artifact', body, status: 410 })
  }

  static inviteForOtherAddress(invitedEmail: string): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('MailX', 24)}
  <h1 class="xxd-empty__title">这个邀请是发给 ${invitedEmail} 的</h1>
  <p class="xxd-empty__text">退出后用这个邮箱登录，就能加入。</p>
  <div class="xxd-empty__actions"><button type="button" class="xxd-btn" data-variant="primary" data-sign-out>退出登录</button></div>
</section>`)
    return PageShell.render({ title: '邀请发给了别人 · Open Artifact', body, status: 403, scripts: ['common.js'] })
  }

  static #centered(content: SafeHtml): SafeHtml {
    return html`${PageShell.brandBar()}<main class="app-center" id="main" tabindex="-1">${content}</main>`
  }
}
