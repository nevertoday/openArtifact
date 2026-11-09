import type { Messages } from '../i18n/messages.ts'
import { ArtifactPath, ArtifactRemoval, type AccessToken, type AuditEvent, type WorkspaceMember, type WorkspaceUsage } from '@open-artifact/core'
import type { OpenedArtifact } from '../access/artifact-gate.ts'
import type { Identity } from '../auth/request-identity.ts'
import type { GuideFile, GuidePackFormat } from '../guide/agent-guide.ts'
import { AgentConnectSection } from './agent-connect-section.ts'
import { INVITE_LIFETIME_DAYS } from '../api/invite-api.ts'
import { WORKSPACE_LIMITS } from '../api/publish-limits.ts'
import { People } from '../people.ts'
import { ArtifactLabels } from './artifact-labels.ts'
import { html, SafeHtml } from './html.ts'
import { PageShell } from './page-shell.ts'
import { SETTINGS_SECTION_ICONS, THEME_CHOICES, type SettingsSection, type ThemeChoice } from './settings-sections.ts'


/** What only an admin sees: every artifact of the workspace as metadata, and the latest audit events. */
export interface WorkspaceAdministration {
  artifacts: OpenedArtifact[]
  auditEvents: AuditEvent[]
  /** Authors, removers, actors and members, by user id. */
  names: Map<string, string>
}

export interface SettingsModel {
  m: Messages
  identity: Identity
  section: SettingsSection
  mcpUrl: string
  appOrigin: string
  accessTokens: AccessToken[]
  guideFiles: GuideFile<GuidePackFormat>[]
  members: WorkspaceMember[]
  administration: WorkspaceAdministration | null
  /** Shown on the workspace section only; null elsewhere. */
  usage: SettingsUsage | null
  now: number
}


/** What the workspace holds, files and shared data apart, since each has its own limit. */
export type SettingsUsage = WorkspaceUsage & { sharedDataBytes: number }

export class SettingsPage {
  static render(model: SettingsModel): Response {
    const body = html`
${PageShell.topBar(model.m, model.identity, html`<span class="xxd-text app-topbar__context" data-variant="secondary">${model.m.settings.topBarContext}</span>`)}
${PageShell.withSidebar(SettingsPage.#sidebar(model), html`<div class="xxd-read settings-flow">${SettingsPage.#section(model)}</div>`)}
${PageShell.jsonData('settings-config', { userId: model.identity.userId, accessTokens: model.accessTokens })}`
    return PageShell.render({ m: model.m, title: `${model.m.settings.sections[model.section]} · Open Artifact`, body, scripts: ['common.js', 'settings.js'] })
  }

  static #sidebar(model: SettingsModel): SafeHtml {
    const sectionLink = (section: SettingsSection) =>
      html`<a class="xxd-sidebar__item" href="/settings/${section}" ${model.section === section ? html`aria-current="page"` : ''}>${PageShell.icon(SETTINGS_SECTION_ICONS[section], 18)}<span>${model.m.settings.sections[section]}</span></a>`
    return html`<nav class="xxd-sidebar app-sidebar" aria-label="${model.m.settings.sidebar.label}"><div class="xxd-sidebar__body">
  <a class="xxd-sidebar__item settings-back" href="/">${PageShell.icon('ArrowLeft', 18)}<span>${model.m.settings.sidebar.back}</span></a>
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${model.m.settings.sidebar.personal}</div>${sectionLink('profile')}${sectionLink('agents')}</div>
  <div class="xxd-sidebar__group"><div class="xxd-sidebar__label">${model.identity.membership.workspace.name}</div>${sectionLink('members')}${sectionLink('workspace')}</div>
</div></nav>`
  }

  static #section(model: SettingsModel): SafeHtml {
    switch (model.section) {
      case 'agents':
        return SettingsPage.#agentsSection(model)
      case 'profile':
        return SettingsPage.#profileSection(model.m, model.identity)
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
    return html`${SettingsPage.#pageHeader(model.m.settings.sections.agents, model.m.settings.agents.description)}
${AgentConnectSection.render(model)}`
  }

  static #profileSection(m: Messages, identity: Identity): SafeHtml {
    const { profile } = m.settings
    return html`${SettingsPage.#pageHeader(m.settings.sections.profile)}
<div class="profile-identity">
  ${PageShell.avatar(identity.name, { size: 'lg', accountInitial: true, content: identity.hasChosenName ? undefined : PageShell.icon('UserRound', 20) })}
  <div class="xxd-text-pair"><span class="xxd-text profile-identity__name" data-account-name>${identity.name}</span><span class="xxd-text profile-email" data-variant="secondary" aria-label="${profile.emailLabel}">${identity.email} · ${profile.emailHelp}</span></div>
</div>
<form class="xxd-stack profile-form" id="profile-form" data-xxd-validate>
  <div class="xxd-field">
    <label class="xxd-label" for="profile-name">${profile.nameLabel}</label>
    <div class="profile-form__row">
      <input class="xxd-input" id="profile-name" name="name" required maxlength="60" value="${identity.hasChosenName ? identity.name : ''}" placeholder="${identity.name}" autocomplete="name" aria-describedby="profile-name-help" data-error-required="${profile.nameRequired}">
      <button type="submit" class="xxd-btn" data-variant="primary" disabled>${m.settings.save}</button>
    </div>
    <p class="xxd-help" id="profile-name-help">${profile.nameHelp}</p>
  </div>
</form>
${SettingsPage.#appearanceSection(m)}`
  }

  // The choice lives in this browser, so the server cannot know it: 'system' is checked until settings.js reads the real one.
  static #appearanceSection(m: Messages): SafeHtml {
    const { profile } = m.settings
    const choice = (theme: ThemeChoice) =>
      html`<label class="theme-tile" for="theme-${theme}"><input type="radio" class="xxd-radio" name="theme" id="theme-${theme}" value="${theme}" ${theme === 'system' ? new SafeHtml('checked') : ''}><span class="theme-tile__preview" data-preview="${theme}" aria-hidden="true"><i></i><i></i><b></b></span><span>${profile.themes[theme]}</span></label>`
    return html`<fieldset class="theme-tiles" aria-describedby="appearance-help">
  <legend class="xxd-label">${profile.appearance}</legend>
  <div class="theme-tiles__row">${THEME_CHOICES.map(choice)}</div>
  <p class="xxd-help" id="appearance-help">${profile.appearanceHelp}</p>
</fieldset>`
  }

  static #membersSection(model: SettingsModel): SafeHtml {
    const { members, identity } = model
    const { m } = model
    const isAdmin = identity.membership.role === 'admin'
    const adminCount = members.filter(member => member.role === 'admin').length
    const memberRow = (member: WorkspaceMember) => {
      const name = People.displayName(member)
      const isSelf = member.userId === identity.userId
      return html`<tr data-member-row="${member.userId}">
    <td><span class="xxd-cluster">${PageShell.avatar(name, { size: 'sm' })}<span>${name}${isSelf ? html`<span class="xxd-text" data-variant="secondary">${m.settings.members.you}</span>` : ''}</span></span></td>
    <td><span class="xxd-text" data-variant="secondary">${member.email}</span></td>
    ${isAdmin ? SettingsPage.#memberControls(m, member, name, identity.userId, adminCount) : html`<td>${ArtifactLabels.role(m, member.role)}</td>`}
  </tr>`
    }
    return html`${SettingsPage.#pageHeader(m.settings.sections.members, m.settings.members.summary({ count: members.length, isAdmin }))}
${isAdmin ? SettingsPage.#inviteSection(m) : ''}
<section class="xxd-stack member-list" aria-labelledby="member-list-title">
  ${isAdmin ? html`<h2 class="xxd-text" data-variant="heading3" id="member-list-title">${m.settings.members.allMembers}</h2>` : html`<h2 class="xxd-sr-only" id="member-list-title">${m.settings.members.allMembers}</h2>`}
  <div class="xxd-table-wrap"><table class="xxd-table">
    <thead><tr><th>${m.settings.members.columns.name}</th><th>${m.settings.members.columns.email}</th><th>${m.settings.members.columns.role}</th>${isAdmin ? html`<th class="xxd-table__actions"><span class="xxd-sr-only">${m.settings.actions}</span></th>` : ''}</tr></thead>
    <tbody>${SettingsPage.#adminsFirst(members).map(memberRow)}</tbody>
  </table></div>
</section>`
  }

  static #adminsFirst(members: WorkspaceMember[]): WorkspaceMember[] {
    const roleOrder = (member: WorkspaceMember) => (member.role === 'admin' ? 0 : 1)
    return [...members].sort((left, right) => roleOrder(left) - roleOrder(right) || People.displayName(left).localeCompare(People.displayName(right), 'zh-CN'))
  }

  // The pending list is drawn by settings.js from /api/workspace/invites, the same JSON every later change returns.
  static #inviteSection(m: Messages): SafeHtml {
    const { invite } = m.settings
    return html`<section class="xxd-stack invite-section" aria-labelledby="invite-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="invite-title">${invite.title}</h2>
    <p class="xxd-text" data-variant="secondary">${invite.description(INVITE_LIFETIME_DAYS)}</p>
  </div>
  <form class="invite-form" id="invite-email-form" novalidate>
    <div class="xxd-field invite-form__emails">
      <label class="xxd-label" for="invite-emails">${invite.emailsLabel}</label>
      <textarea class="xxd-textarea" id="invite-emails" name="emails" rows="1" data-autosize placeholder="name@example.com" aria-describedby="invite-emails-help"></textarea>
      <p class="xxd-help" id="invite-emails-help">${invite.emailsHelp}</p>
    </div>
    <div class="xxd-cluster invite-form__actions">
      <button type="submit" class="xxd-btn" data-variant="primary">${invite.send}</button>
      <span class="xxd-cluster invite-form__link">
        <button type="button" class="xxd-btn" id="create-invite-link">${PageShell.icon('Link', 14)}${invite.createLink}</button>
        <label class="xxd-select" data-size="sm"><span class="xxd-sr-only">${invite.linkExpiry}</span><select id="invite-link-expiry">
          <option value="7">${invite.linkExpiries[7]}</option><option value="30">${invite.linkExpiries[30]}</option><option value="never">${invite.linkExpiries.never}</option>
        </select></label>
      </span>
    </div>
  </form>
  <div class="xxd-stack" id="pending-invites" aria-live="polite"></div>
</section>`
  }

  // An admin acting on someone else always leaves themselves as admin, so only their own row can hit the limits.
  static #memberControls(m: Messages, member: WorkspaceMember, name: string, adminId: string, adminCount: number): SafeHtml {
    const isSelf = member.userId === adminId
    const isLastAdmin = member.role === 'admin' && adminCount === 1
    const roleLocked = isSelf && isLastAdmin
    const roleOption = (role: WorkspaceMember['role']) => html`<option value="${role}" ${member.role === role ? new SafeHtml('selected') : ''}>${ArtifactLabels.role(m, role)}</option>`
    // What cannot change is shown as plain text with its reason on hover, not as a disabled control with a caption.
    const roleCell = roleLocked
      ? html`<span class="member-role" tabindex="0" data-tooltip="${m.settings.members.lastAdmin}">${ArtifactLabels.role(m, member.role)}</span>`
      : html`<label class="xxd-select" data-size="sm"><span class="xxd-sr-only">${m.settings.members.roleOf(name)}</span><select data-member-role="${member.userId}" data-name="${name}">${roleOption('admin')}${roleOption('member')}</select></label>`
    const removeCell = isSelf
      ? html`<span class="xxd-sr-only">${m.settings.members.cannotRemoveSelf}</span>`
      : html`<button type="button" class="xxd-btn" data-variant="danger-outline" data-size="xs" data-remove-member="${member.userId}" data-name="${name}">${m.settings.members.remove}</button>`
    return html`<td>${roleCell}</td>
    <td class="xxd-table__actions">${removeCell}</td>`
  }

  static #workspaceSection(model: SettingsModel): SafeHtml {
    const { identity, administration, m } = model
    const { publicLinks } = m.settings.workspace
    return html`${SettingsPage.#pageHeader(m.settings.sections.workspace)}
${administration ? SettingsPage.#workspaceNameForm(m, identity) : ''}
<section class="xxd-group" aria-labelledby="public-links-title">
  <h2 class="xxd-group__title" id="public-links-title">${publicLinks.title}</h2>
  <div class="xxd-group__body">
    <div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title" id="public-links-label">${publicLinks.label}</span><span class="xxd-row__desc" id="public-links-help">${publicLinks.help}</span></div>
      <div class="xxd-row__control">${administration ? SettingsPage.#publicLinksSwitch(identity, administration) : SettingsPage.#publicLinksState(m, identity)}</div>
    </div>
  </div>
</section>
${model.usage ? SettingsPage.#usageSection(m, model.usage) : ''}
${administration ? SettingsPage.#contentSection(model.m, administration, identity, model.now) : ''}
${administration ? SettingsPage.#auditSection(model.m, administration, model.now) : ''}
${SettingsPage.#lifecycleSection(m, identity)}`
  }

  static #usageSection(m: Messages, usage: SettingsUsage): SafeHtml {
    const { usage: words } = m.settings.workspace
    const maxGb = WORKSPACE_LIMITS.fileBytes / 1024 ** 3
    const maxSharedDataMb = WORKSPACE_LIMITS.sharedDataBytes / 1024 ** 2
    const meter = (id: string, label: string, value: string, used: number, max: number) => {
      const share = Math.min(used / max, 1)
      const tone = share >= 0.9 ? 'danger' : share >= 0.75 ? 'warning' : null
      return html`<div class="xxd-meter" ${tone ? html`data-tone="${tone}"` : ''} style="--value: ${share.toFixed(4)}" data-usage="${id}">
        <div class="xxd-meter__head"><span>${label}</span><span>${value}</span></div>
        <div class="xxd-meter__track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${used}" aria-valuetext="${value}"><div class="xxd-meter__fill"></div></div>
      </div>`
    }
    return html`<section class="xxd-group" aria-labelledby="usage-title">
  <h2 class="xxd-group__title" id="usage-title">${words.title}</h2>
  <div class="xxd-group__body">
    <div class="xxd-row"><div class="xxd-row__text xxd-stack workspace-usage">
      ${meter('artifacts', words.artifacts, words.artifactCount({ used: usage.activeArtifacts, max: WORKSPACE_LIMITS.activeArtifacts }), usage.activeArtifacts, WORKSPACE_LIMITS.activeArtifacts)}
      ${meter('files', words.files, words.filesSize({ usedMb: SettingsPage.#shownMegabytes(usage.fileBytes), maxGb }), usage.fileBytes, WORKSPACE_LIMITS.fileBytes)}
      ${meter('shared-data', words.sharedData, words.sharedDataSize({ usedMb: SettingsPage.#shownMegabytes(usage.sharedDataBytes), maxMb: maxSharedDataMb }), usage.sharedDataBytes, WORKSPACE_LIMITS.sharedDataBytes)}
      <span class="xxd-row__desc">${words.help({ maxArtifacts: WORKSPACE_LIMITS.activeArtifacts, maxGb, maxSharedDataMb })}</span>
    </div></div>
  </div>
</section>`
  }

  // A few pages weigh a few kilobytes, which would round to 0 MB and read as nothing stored.
  static #shownMegabytes(bytes: number): number {
    return bytes === 0 ? 0 : Math.max(bytes / 1024 ** 2, 0.1)
  }

  // Last on the page, since it ends the person's or everyone's access; a personal workspace only says why it has none.
  static #lifecycleSection(m: Messages, identity: Identity): SafeHtml {
    const { lifecycle } = m.settings.workspace
    const workspace = identity.membership.workspace
    if (workspace.personalOf === identity.userId) {
      return html`<section class="xxd-group" aria-labelledby="lifecycle-title"><h2 class="xxd-group__title" id="lifecycle-title">${lifecycle.title}</h2><div class="xxd-group__body"><div class="xxd-row"><div class="xxd-row__text"><span class="xxd-row__desc">${lifecycle.personalNote}</span></div></div></div></section>`
    }
    const deleteRow = html`<div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title">${lifecycle.deleteLabel}</span><span class="xxd-row__desc">${lifecycle.deleteHelp}</span></div>
      <div class="xxd-row__control"><button type="button" class="xxd-btn" data-variant="danger" data-size="sm" data-delete-workspace data-name="${workspace.name}">${PageShell.icon('Trash2', 14)}${lifecycle.delete}</button></div>
    </div>`
    return html`<section class="xxd-group" aria-labelledby="lifecycle-title">
  <h2 class="xxd-group__title" id="lifecycle-title">${lifecycle.title}</h2>
  <div class="xxd-group__body">
    <div class="xxd-row">
      <div class="xxd-row__text"><span class="xxd-row__title">${lifecycle.leaveLabel}</span><span class="xxd-row__desc">${lifecycle.leaveHelp}</span></div>
      <div class="xxd-row__control"><button type="button" class="xxd-btn" data-variant="danger-outline" data-size="sm" data-leave-workspace data-name="${workspace.name}">${PageShell.icon('LogOut', 14)}${lifecycle.leave}</button></div>
    </div>
    ${identity.membership.role === 'admin' ? deleteRow : ''}
  </div>
</section>`
  }

  static #workspaceNameForm(m: Messages, identity: Identity): SafeHtml {
    const { workspace } = m.settings
    return html`<form class="xxd-stack workspace-name-form" id="workspace-name-form" data-xxd-validate>
  <div class="xxd-field">
    <label class="xxd-label" for="workspace-name">${workspace.nameLabel}</label>
    <div class="profile-form__row">
      <input class="xxd-input" id="workspace-name" name="name" required maxlength="40" value="${identity.membership.workspace.name}" aria-describedby="workspace-name-help" data-error-required="${workspace.nameRequired}">
      <button type="submit" class="xxd-btn" data-variant="primary" disabled>${m.settings.save}</button>
    </div>
    <p class="xxd-help" id="workspace-name-help">${workspace.nameHelp}</p>
  </div>
</form>`
  }

  // Turning public links off ends every live one at once, so the switch carries how many that is for the confirmation.
  static #publicLinksSwitch(identity: Identity, administration: WorkspaceAdministration): SafeHtml {
    const livePublicLinks = administration.artifacts.filter(({ summary }) => summary.sharing.visibility === 'public_link' && summary.removal === null)
    return html`<input type="checkbox" role="switch" class="xxd-switch" id="public-links-enabled" aria-labelledby="public-links-label" aria-describedby="public-links-help" data-public-link-count="${livePublicLinks.length}" ${identity.membership.workspace.publicLinksEnabled ? new SafeHtml('checked') : ''}>`
  }

  // A disabled switch reads as "off", so a member sees the setting as words.
  static #publicLinksState(m: Messages, identity: Identity): SafeHtml {
    return html`<span class="xxd-text" data-variant="secondary">${m.settings.workspace.publicLinks.state(identity.membership.workspace.publicLinksEnabled)}</span>`
  }

  // Metadata only: a private artifact shows its title but no link, since an admin may not open it.
  static #contentSection(m: Messages, administration: WorkspaceAdministration, identity: Identity, now: number): SafeHtml {
    const { content } = m.settings.workspace
    const row = (openedArtifact: OpenedArtifact) => {
      const { summary, permissions } = openedArtifact
      const titleCell = permissions.canView ? html`<a class="xxd-link" href="${ArtifactPath.of(summary)}">${summary.title}</a>` : summary.title
      return html`<tr>
    <td>${titleCell}</td>
    <td><span class="xxd-text" data-variant="secondary">${administration.names.get(summary.authorId)}</span></td>
    <td>${SettingsPage.#contentState(m, summary, administration.names, now)}</td>
    <td><span class="xxd-text" data-variant="secondary">${PageShell.relativeTime(m, summary.updatedAt, now)}</span></td>
    <td class="xxd-table__actions">${SettingsPage.#contentAction(m, openedArtifact, identity)}</td>
  </tr>`
    }
    return html`<section class="xxd-stack" aria-labelledby="content-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="content-title">${content.title}</h2>
    <p class="xxd-text" data-variant="secondary">${content.description}</p>
  </div>
  <div class="xxd-table-wrap"><table class="xxd-table content-table">
    <thead><tr><th>${content.columns.title}</th><th>${content.columns.author}</th><th>${content.columns.state}</th><th>${content.columns.updated}</th><th class="xxd-table__actions"><span class="xxd-sr-only">${m.settings.actions}</span></th></tr></thead>
    <tbody>${administration.artifacts.map(row)}</tbody>
  </table></div>
</section>`
  }

  static #contentState(m: Messages, summary: OpenedArtifact['summary'], names: Map<string, string>, now: number): SafeHtml {
    const removal = summary.removal
    if (removal === null) return html`<span class="xxd-badge">${ArtifactLabels.sharingBadge(m, summary.sharing, now)}</span>`
    const { content } = m.settings.workspace
    const takenDown = removal.removedAsAdmin
    return html`<span class="xxd-badge" data-tone="danger">${content.removedBadge(takenDown)}</span> <span class="xxd-text" data-variant="caption">${content.removedBy({ name: names.get(removal.removedBy) ?? '', takenDown, purge: ArtifactLabels.purgeIn(m, removal.purgeAt, now) })}</span>`
  }

  static #contentAction(m: Messages, { summary, permissions }: OpenedArtifact, identity: Identity): SafeHtml | string {
    if (permissions.canRestore) {
      return html`<button type="button" class="xxd-btn" data-size="xs" data-restore-artifact="${summary.artifactId}" data-title="${summary.title}">${m.settings.workspace.content.restore}</button>`
    }
    if (!permissions.canRemove) return ''
    const takesDown = ArtifactRemoval.isTakedown(identity.userId, summary.authorId)
    return html`<button type="button" class="xxd-btn" data-variant="danger-outline" data-size="xs" data-remove-artifact="${summary.artifactId}" data-title="${summary.title}" ${takesDown ? new SafeHtml('data-takes-down') : ''}>${ArtifactLabels.removal(m, takesDown)}</button>`
  }

  static #auditSection(m: Messages, administration: WorkspaceAdministration, now: number): SafeHtml {
    const { auditEvents, names } = administration
    const { audit } = m.settings.workspace
    const eventItem = (auditEvent: AuditEvent) => html`<li class="xxd-list__item"><span class="xxd-list__main">
    <span class="xxd-list__title">${SettingsPage.#auditSentence(m, auditEvent, names)}</span>
    <span class="xxd-list__meta">${PageShell.relativeTime(m, auditEvent.createdAt, now)}</span>
  </span></li>`
    return html`<section class="xxd-stack" aria-labelledby="audit-title">
  <div class="xxd-text-pair">
    <h2 class="xxd-text" data-variant="heading3" id="audit-title">${audit.title}</h2>
    <p class="xxd-text" data-variant="secondary">${audit.description(auditEvents.length)}</p>
  </div>
  ${auditEvents.length > 0 ? html`<ul class="xxd-list">${auditEvents.map(eventItem)}</ul>` : html`<p class="xxd-text" data-variant="secondary">${audit.empty}</p>`}
</section>`
  }

  static #auditSentence(m: Messages, auditEvent: AuditEvent, names: Map<string, string>): string {
    const { events } = m.settings.workspace.audit
    const actor = names.get(auditEvent.actorId) ?? ''
    switch (auditEvent.action) {
      case 'artifact.removed':
        return events[auditEvent.action]({ actor, takenDown: auditEvent.detail.removedAsAdmin, title: auditEvent.detail.title })
      case 'artifact.restored':
      case 'artifact.purged':
        return events[auditEvent.action]({ actor, title: auditEvent.detail.title })
      case 'artifact.renamed':
        return events[auditEvent.action]({ actor, from: auditEvent.detail.from, to: auditEvent.detail.to })
      case 'member.removed':
        return events[auditEvent.action]({ actor, target: names.get(auditEvent.targetId) ?? '' })
      case 'member.role_changed':
        return events[auditEvent.action]({ actor, target: names.get(auditEvent.targetId) ?? '', role: ArtifactLabels.role(m, auditEvent.detail.to) })
      case 'member.invited':
        return events[auditEvent.action]({ actor, email: auditEvent.detail.email })
      case 'invite.revoked':
        return events[auditEvent.action]({ actor, email: auditEvent.detail.email })
      case 'member.joined':
        return events[auditEvent.action]({ actor, viaLink: auditEvent.detail.via === 'link' })
      case 'workspace.renamed':
        return events[auditEvent.action]({ actor, from: auditEvent.detail.from, to: auditEvent.detail.to })
      case 'member.left':
      case 'workspace.deleted':
      case 'workspace.restored':
        return events[auditEvent.action]({ actor })
    }
  }
}
