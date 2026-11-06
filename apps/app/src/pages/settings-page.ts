import type { AccessToken, WorkspaceMember } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import type { GuideFile } from '../guide/agent-guide.ts'
import { People } from '../people.ts'
import { html, SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

export const SETTINGS_SECTIONS = ['agents', 'profile', 'members', 'workspace'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const SECTION_LABELS: Record<SettingsSection, string> = { agents: 'Agent 接入', profile: '个人资料', members: '成员', workspace: 'Workspace 设置' }

export interface SettingsModel {
  identity: Identity
  section: SettingsSection
  mcpUrl: string
  accessTokens: AccessToken[]
  guideFiles: GuideFile[]
  members: WorkspaceMember[]
}

const SECTION_ICONS: Record<SettingsSection, IconName> = { agents: 'Bot', profile: 'UserRound', members: 'Users', workspace: 'Settings' }

export class SettingsPage {
  static render(model: SettingsModel): Response {
    const body = html`
${PageShell.topBar(model.identity, html`<span class="xxd-text app-topbar__context" data-variant="secondary">/ 设置</span>`)}
${PageShell.withSidebar(SettingsPage.#sidebar(model), html`<div class="xxd-read">${SettingsPage.#section(model)}</div>`)}
${PageShell.jsonData('settings-config', { accessTokens: model.accessTokens })}`
    return PageShell.render({ title: `${SECTION_LABELS[model.section]} · Open Artifact`, body, scripts: ['common.js', 'settings.js'] })
  }

  static #sidebar(model: SettingsModel): SafeHtml {
    const sectionLink = (section: SettingsSection) =>
      html`<a class="xxd-sidebar__item" href="/settings/${section}" ${model.section === section ? html`aria-current="page"` : ''}>${PageShell.icon(SECTION_ICONS[section], 18)}<span>${SECTION_LABELS[section]}</span></a>`
    return html`<nav class="xxd-sidebar app-sidebar" aria-label="设置分类"><div class="xxd-sidebar__body">
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">个人</div>${sectionLink('profile')}${sectionLink('agents')}</div>
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${model.identity.membership.workspace.name}</div>${sectionLink('members')}${sectionLink('workspace')}</div>
</div></nav>`
  }

  static #section(model: SettingsModel): SafeHtml {
    switch (model.section) {
      case 'agents':
        return SettingsPage.#agentsSection(model)
      case 'profile':
        return SettingsPage.#profileSection(model.identity)
      case 'members':
        return SettingsPage.#membersSection(model.members)
      case 'workspace':
        return SettingsPage.#workspaceSection(model.identity)
    }
  }

  static #pageHeader(title: string, description: string | SafeHtml = ''): SafeHtml {
    return html`<header class="xxd-page-header">
  <div class="xxd-page-header__row"><h1 class="xxd-page-header__title">${title}</h1></div>
  ${description ? html`<p class="xxd-page-header__desc">${description}</p>` : ''}
</header>`
  }

  static #agentsSection(model: SettingsModel): SafeHtml {
    const clients = SettingsPage.#mcpSnippets(model.mcpUrl)
    return html`${SettingsPage.#pageHeader('Agent 接入', `让 Claude Code、Codex、Cursor、Gemini CLI 等 agent 以你的身份发布和修改 artifact。agent 的权限和你在 ${model.identity.membership.workspace.name} 里的权限相同。`)}
<div class="xxd-settings">
<section class="xxd-stack" aria-labelledby="mcp-title">
  <div class="xxd-text-pair">
    <div class="xxd-cluster"><h2 class="xxd-text" data-variant="heading3" id="mcp-title">1 · 连接 MCP server</h2><span class="xxd-badge">推荐</span></div>
    <p class="xxd-text" data-variant="secondary">支持 MCP 的 agent 用这一种就够了。工具说明会自动进入 agent 的上下文。把 <code class="xxd-code-inline">oa_pat_…</code> 换成第 2 步生成的 token。</p>
  </div>
  <div class="xxd-tabs" data-xxd-tabs aria-label="MCP 客户端">
    ${clients.map((client, index) => html`<button type="button" role="tab" id="mcp-client-${index}" aria-controls="mcp-snippet-${index}" aria-selected="${index === 0 ? 'true' : 'false'}">${client.name}</button>`)}
  </div>
  ${clients.map((client, index) => html`<div class="xxd-code-block" id="mcp-snippet-${index}" ${index === 0 ? '' : new SafeHtml('hidden')}>
    <div class="xxd-code__head">${client.name}<button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="xs" aria-label="复制 ${client.name} 配置" data-copy="${client.snippet}">${PageShell.icon('Copy', 14)}</button></div>
    <pre class="xxd-code" tabindex="0"><code>${client.snippet}</code></pre>
  </div>`)}
</section>

<section class="xxd-stack" aria-labelledby="pat-title">
  <h2 class="xxd-text" data-variant="heading3" id="pat-title">2 · 个人 API token</h2>
  <form class="token-form" id="create-token-form" data-xxd-validate>
    <div class="xxd-field token-form__name">
      <label class="xxd-sr-only" for="token-name">token 名称</label>
      <input class="xxd-input" id="token-name" name="name" required maxlength="80" placeholder="名称，例如 Claude Code · 工作机" data-error-required="给 token 起个名字，比如它装在哪台机器上">
    </div>
    <label class="xxd-select"><span class="xxd-sr-only">有效期</span><select id="token-expiry" name="expiresInDays"><option value="90">90 天</option><option value="30">30 天</option><option value="365">1 年</option><option value="never">永不过期</option></select></label>
    <button type="submit" class="xxd-btn" data-variant="primary">新建 token</button>
  </form>
  <div class="xxd-banner" data-tone="warning" id="token-reveal" role="status" hidden>
    ${PageShell.icon('TriangleAlert')}
    <div class="xxd-stack token-created">
      <p class="xxd-banner__title" data-token-reveal-title></p>
      <div class="xxd-clipboard"><code data-token-value></code><button type="button" class="xxd-btn" data-variant="ghost" data-icon-only data-size="sm" aria-label="复制 token" data-copy-target="[data-token-value]" data-copy-done="token 已复制">${PageShell.icon('Copy', 14)}</button></div>
    </div>
  </div>
  <div id="token-table"></div>
</section>

<section class="xxd-group" aria-labelledby="guide-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="guide-title">3 · 指南包（不支持 MCP 时用）</h2>
    <p class="xxd-text" data-variant="secondary">告诉 agent 什么时候发布、页面要遵守什么约定、该更新而不是新建。已经填好本实例的地址。</p>
  </div>
  <div class="xxd-group__body">
    ${model.guideFiles.map(guideFile => html`<div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title">${guideFile.label}</span><span class="xxd-row__desc xxd-mono">${guideFile.savePath}</span></div>
      <div class="xxd-row__control"><button type="button" class="xxd-btn" data-size="sm" data-copy="${guideFile.content}" data-copy-done="已复制 ${guideFile.label}">${PageShell.icon('Copy', 14)}复制内容</button></div>
    </div>`)}
  </div>
</section>
</div>`
  }

  static #profileSection(identity: Identity): SafeHtml {
    return html`${SettingsPage.#pageHeader('个人资料')}
<form class="xxd-stack profile-form" id="profile-form" data-xxd-validate>
  <div class="xxd-field">
    <label class="xxd-label" for="profile-name">显示名称</label>
    <input class="xxd-input" id="profile-name" name="name" required maxlength="60" value="${identity.name}" data-error-required="写一个名字，团队成员会在评论和成员列表里看到它">
  </div>
  <div class="xxd-field">
    <label class="xxd-label" for="profile-email">邮箱</label>
    <input class="xxd-input" id="profile-email" value="${identity.email}" disabled>
  </div>
  <div><button type="submit" class="xxd-btn" data-variant="primary">保存</button></div>
</form>`
  }

  static #membersSection(members: WorkspaceMember[]): SafeHtml {
    return html`${SettingsPage.#pageHeader('成员', `${members.length} 人。新同事第一次登录后会自动加入。`)}
<div class="xxd-table-wrap"><table class="xxd-table">
  <thead><tr><th>名称</th><th>邮箱</th><th>角色</th></tr></thead>
  <tbody>${members.map(member => html`<tr>
    <td><span class="xxd-cluster"><span class="xxd-avatar" data-size="sm" aria-hidden="true">${PageShell.initialOf(People.displayName(member))}</span>${People.displayName(member)}</span></td>
    <td><span class="xxd-text" data-variant="secondary">${member.email}</span></td>
    <td>${member.role === 'admin' ? html`<span class="xxd-badge">管理员</span>` : '成员'}</td>
  </tr>`)}</tbody>
</table></div>`
  }

  static #workspaceSection(identity: Identity): SafeHtml {
    const isAdmin = identity.membership.role === 'admin'
    return html`${SettingsPage.#pageHeader('Workspace 设置')}
<section class="xxd-group" aria-labelledby="public-links-title">
  <h2 class="xxd-group__title" id="public-links-title">公开链接</h2>
  <div class="xxd-group__body">
    <div class="xxd-row">
      <div class="xxd-row__text"><label class="xxd-row__title" for="public-links-enabled">允许成员把 artifact 分享为公开链接</label><span class="xxd-row__desc" id="public-links-help">关闭后，现有的公开链接立即失效；成员仍然可以在 workspace 内查看。</span></div>
      <div class="xxd-row__control"><input type="checkbox" role="switch" class="xxd-switch" id="public-links-enabled" aria-describedby="public-links-help" ${identity.membership.workspace.publicLinksEnabled ? new SafeHtml('checked') : ''} ${isAdmin ? '' : new SafeHtml('disabled')}></div>
    </div>
  </div>
  ${isAdmin ? '' : html`<p class="xxd-group__note">只有管理员可以修改。</p>`}
</section>`
  }

  static #mcpSnippets(mcpUrl: string): { name: string; snippet: string }[] {
    return [
      { name: 'Claude Code', snippet: `claude mcp add --transport http open-artifact ${mcpUrl} \\\n  --header "Authorization: Bearer oa_pat_…"` },
      { name: 'Codex', snippet: `# ~/.codex/config.toml\n[mcp_servers.open-artifact]\nurl = "${mcpUrl}"\nbearer_token_env_var = "OPEN_ARTIFACT_TOKEN"` },
      { name: 'Cursor', snippet: `// .cursor/mcp.json\n{ "mcpServers": { "open-artifact": {\n    "url": "${mcpUrl}",\n    "headers": { "Authorization": "Bearer oa_pat_…" } } } }` },
      { name: 'Gemini CLI', snippet: `// ~/.gemini/settings.json\n{ "mcpServers": { "open-artifact": {\n    "httpUrl": "${mcpUrl}",\n    "headers": { "Authorization": "Bearer oa_pat_…" } } } }` },
    ]
  }
}
