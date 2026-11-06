import type { LoginProvider } from '../auth/open-artifact-auth.ts'
import { html } from './html.ts'
import { PageShell } from './page-shell.ts'

const AGENTS_ON_STAGE = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI']

export class LoginPage {
  /** `nextPath` is where to land after sign-in; only same-site paths are accepted. */
  static render(providers: LoginProvider[], nextPath: string, appHost: string): Response {
    const providerButtons = providers.map((provider, index) =>
      html`<button type="button" class="xxd-btn" data-block ${index === 0 ? html`data-variant="primary"` : ''} data-provider-id="${provider.providerId}" data-provider-kind="${provider.kind}">用 ${provider.label} 登录</button>`)
    const body = html`<div class="login-page">
  <section class="login-story" data-theme="dark">
    ${PageShell.brandLink()}
    <div class="login-story__pitch">
      <h1 class="xxd-text" data-variant="display">任何 agent 发布，<br>整个团队都能用。</h1>
      <p class="xxd-text" data-variant="secondary">Claude Code、Codex、Cursor 发布的页面都在这里。查看、评论，再让 agent 去改。</p>
      <div class="xxd-cluster">${AGENTS_ON_STAGE.map(agent => html`<span class="xxd-badge">${PageShell.icon('Bot', 14)}${agent}</span>`)}</div>
    </div>
    <footer class="xxd-text" data-variant="caption">部署在团队自己的 Cloudflare 账号 · <span class="xxd-mono">${appHost}</span></footer>
  </section>
  <main class="login-panel">
    <div class="xxd-auth login-card" data-next-path="${nextPath}">
      <h2 class="xxd-auth__name">登录</h2>
      <p class="xxd-auth__line">用团队允许的方式登录。</p>
      <form id="magic-link-form" data-xxd-validate>
        ${providers.length > 0 ? html`${providerButtons}<div class="xxd-auth__or">或者用邮箱</div>` : ''}
        <div class="xxd-field">
          <label class="xxd-label" for="login-email">工作邮箱</label>
          <input id="login-email" class="xxd-input" name="email" type="email" autocomplete="email" required placeholder="name@example.com" aria-describedby="login-email-help" data-error-type="请输入有效的邮箱，比如 name@example.com">
          <p class="xxd-help" id="login-email-help">我们会发一封邮件，点里面的链接就能登录，不需要密码。</p>
        </div>
        <button type="submit" class="xxd-btn" data-variant="primary" data-block>发送登录链接</button>
      </form>
      <div class="xxd-banner" data-tone="success" id="magic-link-sent" role="status" hidden>${PageShell.icon('MailCheck')}<p class="xxd-banner__text">登录链接已发送到 <strong data-sent-to></strong>，5 分钟内有效。没收到的话，检查垃圾邮件，或者再发一次。</p></div>
      <div class="xxd-banner" data-tone="danger" id="login-error" role="alert" hidden>${PageShell.icon('TriangleAlert')}<p class="xxd-banner__text" data-error-text></p></div>
    </div>
  </main>
</div>`
    return PageShell.render({ title: '登录 · Open Artifact', body, scripts: ['login.js'] })
  }
}
