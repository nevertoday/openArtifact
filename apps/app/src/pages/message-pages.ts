import { html, type SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'

/** Small standalone pages: a password prompt for protected public links, and errors a person can act on. */
export class MessagePages {
  static publicLinkPassword(artifactId: string, wrongPassword: boolean): Response {
    const body = MessagePages.#centered(html`<form class="xxd-surface app-center__card" method="post" action="/a/${encodeURIComponent(artifactId)}/unlock" data-xxd-validate>
  ${PageShell.icon('LockKeyhole', 24)}
  <div class="xxd-text-pair">
    <h1 class="xxd-text" data-variant="heading2">这个链接需要密码</h1>
    <p class="xxd-text" data-variant="secondary">分享这个 artifact 的人设置了访问密码。</p>
  </div>
  <div class="xxd-field">
    <label class="xxd-label" for="public-link-password">访问密码</label>
    <input id="public-link-password" class="xxd-input" name="password" type="password" required autocomplete="off" autofocus ${wrongPassword ? html`aria-invalid="true" aria-describedby="public-link-password-error"` : ''}>
    ${wrongPassword ? html`<p class="xxd-error" id="public-link-password-error">密码不对，再试一次。</p>` : ''}
  </div>
  <button type="submit" class="xxd-btn" data-variant="primary" data-block>打开</button>
</form>`)
    return PageShell.render({ title: '需要密码 · Open Artifact', body, status: wrongPassword ? 401 : 200 })
  }

  static tooManyPasswordAttempts(): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('Clock', 24)}
  <h1 class="xxd-empty__title">尝试次数太多</h1>
  <p class="xxd-empty__text">为了保护这个链接，请一分钟后再试。</p>
</section>`)
    return PageShell.render({ title: '请稍后再试 · Open Artifact', body, status: 429 })
  }

  static notFound(signedIn: boolean): Response {
    const body = MessagePages.#centered(html`<section class="xxd-empty">
  ${PageShell.icon('FileX', 24)}
  <h1 class="xxd-empty__title">找不到这个 artifact</h1>
  <p class="xxd-empty__text">它可能已被删除，或者没有分享给你。${signedIn ? '' : '如果它是分享给你的，先登录再打开。'}</p>
  <div class="xxd-empty__actions"><a class="xxd-btn" data-variant="primary" href="${signedIn ? '/' : '/login'}">${signedIn ? '回到首页' : '登录'}</a></div>
</section>`)
    return PageShell.render({ title: '找不到 · Open Artifact', body, status: 404 })
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
    return html`${PageShell.brandBar()}<main class="app-center">${content}</main>`
  }
}
