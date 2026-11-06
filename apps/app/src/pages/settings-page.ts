import { ArtifactRemoval, type AccessToken, type AuditEvent, type WorkspaceMember } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import type { GuideFile } from '../guide/agent-guide.ts'
import { People } from '../people.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

export const SETTINGS_SECTIONS = ['agents', 'profile', 'members', 'workspace'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const SECTION_LABELS: Record<SettingsSection, string> = { agents: 'Agent 接入', profile: '个人资料', members: '成员', workspace: 'Workspace 设置' }

/** What only an admin sees: every artifact of the workspace as metadata, and the latest audit events. */
export interface WorkspaceAdministration {
  artifacts: OpenedArtifact[]
  auditEvents: AuditEvent[]
  /** Authors, removers, actors and members, by user id. */
  names: Map<string, string>
}

export interface SettingsModel {
  identity: Identity
  section: SettingsSection
  mcpUrl: string
  accessTokens: AccessToken[]
  guideFiles: GuideFile[]
  members: WorkspaceMember[]
  administration: WorkspaceAdministration | null
  now: number
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
        return SettingsPage.#membersSection(model)
      case 'workspace':
        return SettingsPage.#workspaceSection(model)
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
    return html`${SettingsPage.#pageHeader('Agent 接入', `让 Claude Code、Codex、Cursor、Gemini CLI 等 agent 以你的身份在 ${model.identity.membership.workspace.name} 里发布和修改 artifact。agent 能做什么，由 token 的权限决定。`)}
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
    <fieldset class="xxd-choices token-form__scope">
      <legend class="xxd-label">权限</legend>
      <label class="xxd-choice" for="token-scope-publish"><input type="radio" class="xxd-radio" name="scope" id="token-scope-publish" value="publish" checked><span>仅发布<small>发布、更新和读取 artifact，处理评论和共享数据；不能修改谁能看到它。</small></span></label>
      <label class="xxd-choice" for="token-scope-full"><input type="radio" class="xxd-radio" name="scope" id="token-scope-full" value="full"><span>完全权限<small>和你在网页上能做的一样，也能修改分享设置，比如设为公开链接。</small></span></label>
    </fieldset>
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

  static #membersSection(model: SettingsModel): SafeHtml {
    const { members, identity } = model
    const isAdmin = identity.membership.role === 'admin'
    const adminCount = members.filter(member => member.role === 'admin').length
    const memberRow = (member: WorkspaceMember) => {
      const name = People.displayName(member)
      return html`<tr data-member-row="${member.userId}">
    <td><span class="xxd-cluster"><span class="xxd-avatar" data-size="sm" aria-hidden="true">${PageShell.initialOf(name)}</span>${name}</span></td>
    <td><span class="xxd-text" data-variant="secondary">${member.email}</span></td>
    ${isAdmin ? SettingsPage.#memberControls(member, name, identity.userId, adminCount) : html`<td>${member.role === 'admin' ? html`<span class="xxd-badge">管理员</span>` : '成员'}</td>`}
  </tr>`
    }
    return html`${SettingsPage.#pageHeader('成员', `${members.length} 人。新同事第一次登录后会自动加入。`)}
<div class="xxd-table-wrap"><table class="xxd-table">
  <thead><tr><th>名称</th><th>邮箱</th><th>角色</th>${isAdmin ? html`<th class="xxd-table__actions"><span class="xxd-sr-only">操作</span></th>` : ''}</tr></thead>
  <tbody>${members.map(memberRow)}</tbody>
</table></div>`
  }

  // An admin acting on someone else always leaves themselves as admin, so only their own row can hit the limits.
  static #memberControls(member: WorkspaceMember, name: string, adminId: string, adminCount: number): SafeHtml {
    const isSelf = member.userId === adminId
    const isLastAdmin = member.role === 'admin' && adminCount === 1
    const roleLocked = isSelf && isLastAdmin
    const roleOption = (role: WorkspaceMember['role']) => html`<option value="${role}" ${member.role === role ? new SafeHtml('selected') : ''}>${ArtifactLabels.role(role)}</option>`
    return html`<td>
      <label class="xxd-select" data-size="sm"><span class="xxd-sr-only">${name} 的角色</span><select data-member-role="${member.userId}" data-name="${name}" ${roleLocked ? new SafeHtml('disabled') : ''}>${roleOption('admin')}${roleOption('member')}</select></label>
      ${roleLocked ? html`<p class="xxd-text member-reason" data-variant="caption">workspace 至少要有一位管理员</p>` : ''}
    </td>
    <td class="xxd-table__actions">
      <button type="button" class="xxd-btn" data-variant="danger-outline" data-size="xs" data-remove-member="${member.userId}" data-name="${name}" ${isSelf ? new SafeHtml('disabled') : ''}>移除</button>
      ${isSelf ? html`<p class="xxd-text member-reason" data-variant="caption">不能移除自己</p>` : ''}
    </td>`
  }

  static #workspaceSection(model: SettingsModel): SafeHtml {
    const { identity } = model
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
</section>
${model.administration ? SettingsPage.#contentSection(model.administration, identity, model.now) : ''}
${model.administration ? SettingsPage.#auditSection(model.administration, model.now) : ''}`
  }

  // Metadata only: a private artifact shows its title but no link, since an admin may not open it.
  static #contentSection(administration: WorkspaceAdministration, identity: Identity, now: number): SafeHtml {
    const row = (openedArtifact: OpenedArtifact) => {
      const { summary, permissions } = openedArtifact
      const titleCell = permissions.canView ? html`<a class="xxd-link" href="/a/${encodeURIComponent(summary.artifactId)}">${summary.title}</a>` : summary.title
      return html`<tr>
    <td>${titleCell}</td>
    <td><span class="xxd-text" data-variant="secondary">${administration.names.get(summary.authorId)}</span></td>
    <td>${SettingsPage.#contentState(summary, administration.names, now)}</td>
    <td><span class="xxd-text" data-variant="secondary">${ArtifactLabels.updatedAgo(summary.updatedAt, now)}</span></td>
    <td class="xxd-table__actions">${SettingsPage.#contentAction(openedArtifact, identity)}</td>
  </tr>`
    }
    return html`<section class="xxd-stack" aria-labelledby="content-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="content-title">内容管理</h2>
    <p class="xxd-text" data-variant="secondary">workspace 里的全部 artifact。下架后所有人都看不到，作者也不能自己恢复；30 天内管理员可以恢复。私有 artifact 只显示标题，管理员也不能打开。</p>
  </div>
  <div class="xxd-table-wrap"><table class="xxd-table">
    <thead><tr><th>标题</th><th>作者</th><th>状态</th><th>更新</th><th class="xxd-table__actions"><span class="xxd-sr-only">操作</span></th></tr></thead>
    <tbody>${administration.artifacts.map(row)}</tbody>
  </table></div>
</section>`
  }

  static #contentState(summary: OpenedArtifact['summary'], names: Map<string, string>, now: number): SafeHtml {
    const removal = summary.removal
    if (removal === null) return html`<span class="xxd-badge">${ArtifactLabels.visibility(summary.sharing.visibility)}</span>`
    const removalWord = ArtifactLabels.removal(removal.removedAsAdmin)
    return html`<span class="xxd-badge" data-tone="danger">已${removalWord}</span> <span class="xxd-text" data-variant="caption">${names.get(removal.removedBy)} ${removalWord} · ${ArtifactLabels.purgeIn(removal.purgeAt, now)}</span>`
  }

  static #contentAction({ summary, permissions }: OpenedArtifact, identity: Identity): SafeHtml | string {
    if (permissions.canRestore) {
      return html`<button type="button" class="xxd-btn" data-size="xs" data-restore-artifact="${summary.artifactId}" data-title="${summary.title}">恢复</button>`
    }
    if (!permissions.canRemove) return ''
    const takesDown = ArtifactRemoval.isTakedown(identity.userId, summary.authorId)
    return html`<button type="button" class="xxd-btn" data-variant="danger-outline" data-size="xs" data-remove-artifact="${summary.artifactId}" data-title="${summary.title}" ${takesDown ? new SafeHtml('data-takes-down') : ''}>${ArtifactLabels.removal(takesDown)}</button>`
  }

  static #auditSection(administration: WorkspaceAdministration, now: number): SafeHtml {
    const { auditEvents, names } = administration
    const eventItem = (auditEvent: AuditEvent) => html`<li class="xxd-list__item"><span class="xxd-list__main">
    <span class="xxd-list__title">${SettingsPage.#auditSentence(auditEvent, names)}</span>
    <span class="xxd-list__meta">${ArtifactLabels.updatedAgo(auditEvent.createdAt, now)}</span>
  </span></li>`
    return html`<section class="xxd-stack" aria-labelledby="audit-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="audit-title">管理记录</h2>
    <p class="xxd-text" data-variant="secondary">最近 ${auditEvents.length} 条删除、下架、恢复、重命名和成员变动。</p>
  </div>
  ${auditEvents.length > 0 ? html`<ul class="xxd-list">${auditEvents.map(eventItem)}</ul>` : html`<p class="xxd-text" data-variant="secondary">还没有管理记录。</p>`}
</section>`
  }

  static #auditSentence(auditEvent: AuditEvent, names: Map<string, string>): string {
    const actor = names.get(auditEvent.actorId)
    switch (auditEvent.action) {
      case 'artifact.removed':
        return `${actor} ${ArtifactLabels.removal(auditEvent.detail.removedAsAdmin)}了「${auditEvent.detail.title}」`
      case 'artifact.restored':
        return `${actor} 恢复了「${auditEvent.detail.title}」`
      case 'artifact.renamed':
        return `${actor} 把「${auditEvent.detail.from}」重命名为「${auditEvent.detail.to}」`
      case 'member.removed':
        return `${actor} 把 ${names.get(auditEvent.targetId)} 移出了 workspace`
      case 'member.role_changed':
        return `${actor} 把 ${names.get(auditEvent.targetId)} 设为${ArtifactLabels.role(auditEvent.detail.to)}`
    }
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
