export type ShareStyle = 'title_summary' | 'title_only'

export const MAX_POST_WEIGHT: 280
export const LINK_WEIGHT: 23
export const SHARE_STYLES: readonly ShareStyle[]

export function weightedLength(text: string): number
export function postWeight(text: string): number
export function composeShareText(article: { title: string; summary: string | null }, style?: ShareStyle): string
export function composePageShareText(lead: string, titles: string[], quote: (title: string, index: number) => string): string
