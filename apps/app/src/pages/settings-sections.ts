import type { IconName } from './page-shell.ts'

/** The settings sections in the order every menu lists them: personal first, then the workspace. */
export const SETTINGS_SECTIONS = ['profile', 'agents', 'members', 'workspace'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SETTINGS_SECTION_ICONS: Record<SettingsSection, IconName> = { profile: 'UserRound', agents: 'Bot', members: 'Users', workspace: 'Settings' }

/** The colour schemes a person can pick; the vendored kit stores the choice per browser and follows the OS for 'system'. */
export const THEME_CHOICES = { system: '跟随系统', light: '浅色', dark: '深色' } as const
