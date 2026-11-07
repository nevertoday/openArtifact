import type { Locale } from '@open-artifact/core'
import en from '../../public/static/i18n/en.js'
import zhCN from '../../public/static/i18n/zh-CN.js'

export type Messages = typeof zhCN

const DICTIONARIES: Record<Locale, Messages> = { 'zh-CN': zhCN, en }

export function messagesFor(locale: Locale): Messages {
  return DICTIONARIES[locale]
}
