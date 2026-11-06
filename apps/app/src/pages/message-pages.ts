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

  static #centered(content: SafeHtml): SafeHtml {
    return html`${PageShell.brandBar()}<main class="app-center">${content}</main>`
  }
}
