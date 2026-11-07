// How every time on Open Artifact reads. The server pages and the browser scripts both import this file, so
// a date or "3 分钟前" can never be worded two ways. Times are shown in the runtime's own time zone; the
// browser re-renders the server's <time data-relative> elements in the reader's zone (common.js).

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const twoDigits = number => String(number).padStart(2, '0')

/** 2026-10-20 */
export function dateText(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

/** 2026-10-20 14:05, for the hover title of a relative time. */
export function fullTimeText(timestamp) {
  const date = new Date(timestamp)
  return `${dateText(timestamp)} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

/** 刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 4 天前, then the date. */
export function relativeTimeText(timestamp, now) {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`
  if (elapsed < 2 * DAY) return '昨天'
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} 天前`
  return dateText(timestamp)
}
