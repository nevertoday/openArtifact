import type { Messages } from './i18n/messages'

type TimeMessages = Messages['time']

export function dateText(timestamp: number): string
export function fullTimeText(timestamp: number): string
export function relativeTimeText(time: TimeMessages, timestamp: number, now: number): string
export function dayText(time: TimeMessages, timestamp: number): string
