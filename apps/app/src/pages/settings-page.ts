import { ArtifactRemoval, type AccessToken, type AuditEvent, type WorkspaceMember } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import type { GuideFile } from '../guide/agent-guide.ts'
import { AgentConnectSection } from './agent-connect-section.ts'
import { INVITE_LIFETIME_DAYS } from '../api/invite-api.ts'
import { People } from '../people.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, SafeHtml } from './html.ts'
import { type IconName, PageShell } from './page-shell.ts'

export const SETTINGS_SECTIONS = ['agents', 'profile', 'members', 'workspace'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

const SECTION_LABELS: Record<SettingsSection, string> = { agents: 'Agent 接入', profile: '个人资料', members: '成员', workspace: 'workspace 设置' }

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
  appOrigin: string
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
${PageShell.jsonData('settings-config', { userId: model.identity.userId, accessTokens: model.accessTokens })}`
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
    return html`${SettingsPage.#pageHeader('Agent 接入', 'Claude Code、Codex、Cursor、Gemini CLI 等 agent 以你的身份发布和修改 artifact。agent 能做什么，由 token 的权限决定。')}
${AgentConnectSection.render(model)}`
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
    const joiningHint = isAdmin ? '' : '要请同事加入，请管理员邀请。'
    return html`${SettingsPage.#pageHeader('成员', `${members.length} 人。${joiningHint}`)}
${isAdmin ? SettingsPage.#inviteSection() : ''}
<div class="xxd-table-wrap"><table class="xxd-table">
  <thead><tr><th>名称</th><th>邮箱</th><th>角色</th>${isAdmin ? html`<th class="xxd-table__actions"><span class="xxd-sr-only">操作</span></th>` : ''}</tr></thead>
  <tbody>${members.map(memberRow)}</tbody>
</table></div>`
  }

  // The pending list is drawn by settings.js from /api/workspace/invites, the same JSON every later change returns.
  static #inviteSection(): SafeHtml {
    return html`<section class="xxd-stack invite-section" aria-labelledby="invite-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="invite-title">邀请同事</h2>
    <p class="xxd-text" data-variant="secondary">收到邀请的人登录后就会加入，不受邮箱域名限制。邀请 ${INVITE_LIFETIME_DAYS} 天后失效。</p>
  </div>
  <form class="invite-form" id="invite-email-form" novalidate>
    <div class="xxd-field invite-form__emails">
      <label class="xxd-label" for="invite-emails">用邮箱邀请</label>
      <textarea class="xxd-textarea" id="invite-emails" name="emails" rows="2" data-autosize placeholder="name@example.com" aria-describedby="invite-emails-help"></textarea>
      <p class="xxd-help" id="invite-emails-help">可以一次填多个，用逗号或换行分开。每人会收到一封带链接的邮件。</p>
    </div>
    <div class="xxd-cluster invite-form__actions">
      <button type="submit" class="xxd-btn" data-variant="primary">发送邀请</button>
      <button type="button" class="xxd-btn" id="create-invite-link">${PageShell.icon('Link', 14)}生成邀请链接</button>
    </div>
  </form>
  <div class="xxd-stack" id="pending-invites" aria-live="polite"></div>
</section>`
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
    const { identity, administration } = model
    return html`${SettingsPage.#pageHeader(SECTION_LABELS.workspace)}
${administration ? SettingsPage.#workspaceNameForm(identity) : ''}
<section class="xxd-group" aria-labelledby="public-links-title">
  <h2 class="xxd-group__title" id="public-links-title">公开链接</h2>
  <div class="xxd-group__body">
    <div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title" id="public-links-label">允许成员把 artifact 分享为公开链接</span><span class="xxd-row__desc" id="public-links-help">关闭后，现有的公开链接立即失效；成员仍然可以在 workspace 内查看。</span></div>
      <div class="xxd-row__control">${administration ? SettingsPage.#publicLinksSwitch(identity, administration) : SettingsPage.#publicLinksState(identity)}</div>
    </div>
  </div>
</section>
${administration ? SettingsPage.#contentSection(administration, identity, model.now) : ''}
${administration ? SettingsPage.#auditSection(administration, model.now) : ''}`
  }

  static #workspaceNameForm(identity: Identity): SafeHtml {
    return html`<form class="xxd-stack workspace-name-form" id="workspace-name-form" data-xxd-validate>
  <div class="xxd-field">
    <label class="xxd-label" for="workspace-name">名称</label>
    <input class="xxd-input" id="workspace-name" name="name" required maxlength="40" value="${identity.membership.workspace.name}" aria-describedby="workspace-name-help" data-error-required="写一个名称，比如团队或项目的名字">
    <p class="xxd-help" id="workspace-name-help">成员在侧栏和切换 workspace 时看到它。最多 40 个字。</p>
  </div>
  <div><button type="submit" class="xxd-btn" data-variant="primary">保存</button></div>
</form>`
  }

  // Turning public links off ends every live one at once, so the switch carries how many that is for the confirmation.
  static #publicLinksSwitch(identity: Identity, administration: WorkspaceAdministration): SafeHtml {
    const livePublicLinks = administration.artifacts.filter(({ summary }) => summary.sharing.visibility === 'public_link' && summary.removal === null)
    return html`<input type="checkbox" role="switch" class="xxd-switch" id="public-links-enabled" aria-labelledby="public-links-label" aria-describedby="public-links-help" data-public-link-count="${livePublicLinks.length}" ${identity.membership.workspace.publicLinksEnabled ? new SafeHtml('checked') : ''}>`
  }

  // A disabled switch reads as "off", so a member sees the setting as words.
  static #publicLinksState(identity: Identity): SafeHtml {
    const state = identity.membership.workspace.publicLinksEnabled ? '已允许' : '已关闭'
    return html`<span class="xxd-text" data-variant="secondary">${state} · 只有管理员可以修改</span>`
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
    <p class="xxd-text" data-variant="secondary">最近 ${auditEvents.length} 条删除、下架、恢复、重命名、邀请和成员变动。</p>
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
      case 'member.invited':
        return auditEvent.detail.email === null ? `${actor} 生成了一个邀请链接` : `${actor} 邀请了 ${auditEvent.detail.email}`
      case 'invite.revoked':
        return auditEvent.detail.email === null ? `${actor} 撤销了一个邀请链接` : `${actor} 撤销了给 ${auditEvent.detail.email} 的邀请`
      case 'member.joined':
        return auditEvent.detail.via === 'link' ? `${actor} 通过邀请链接加入了 workspace` : `${actor} 接受邀请加入了 workspace`
      case 'workspace.renamed':
        return `${actor} 把 workspace 从「${auditEvent.detail.from}」改名为「${auditEvent.detail.to}」`
    }
  }
}
