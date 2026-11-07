// How every time on Open Artifact reads. The server pages and the browser scripts both import this file, so a
// time can never be worded two ways; the words come from the page language's `time` messages. Times are shown in
// the runtime's own time zone; the browser re-renders the server's <time data-relative> elements in the reader's zone (common.js).

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const twoDigits = number => String(number).padStart(2, '0')

/** 2026-10-20 */
export function dateText(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

/** A day in the current year, the way a list of writing dates it. */
export function dayText(time, timestamp) {
  return time.day(new Date(timestamp))
}

/** 2026-10-20 14:05, for the hover title of a relative time. */
export function fullTimeText(timestamp) {
  const date = new Date(timestamp)
  return `${dateText(timestamp)} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

/** Just now, minutes, hours, yesterday, days ago, then the date. */
export function relativeTimeText(time, timestamp, now) {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return time.justNow
  if (elapsed < HOUR) return time.minutesAgo(Math.floor(elapsed / MINUTE))
  if (elapsed < DAY) return time.hoursAgo(Math.floor(elapsed / HOUR))
  if (elapsed < 2 * DAY) return time.yesterday
  if (elapsed < 7 * DAY) return time.daysAgo(Math.floor(elapsed / DAY))
  return dateText(timestamp)
}
