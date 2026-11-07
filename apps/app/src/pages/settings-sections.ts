import type { IconName } from './page-shell.ts'

/** The settings sections in the order every menu lists them: personal first, then the workspace. */
export const SETTINGS_SECTIONS = ['profile', 'agents', 'members', 'workspace'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = { profile: '个人资料', agents: 'Agent 接入', members: '成员', workspace: 'workspace 设置' }

export const SETTINGS_SECTION_ICONS: Record<SettingsSection, IconName> = { profile: 'UserRound', agents: 'Bot', members: 'Users', workspace: 'Settings' }
