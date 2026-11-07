// @ts-check
export default {
  justNow: '刚刚',
  /** @param {number} minutes */
  minutesAgo: minutes => `${minutes} 分钟前`,
  /** @param {number} hours */
  hoursAgo: hours => `${hours} 小时前`,
  yesterday: '昨天',
  /** @param {number} days */
  daysAgo: days => `${days} 天前`,
  /** A day in the current year, the way a list of writing dates it. @param {Date} date */
  day: date => `${date.getMonth() + 1} 月 ${date.getDate()} 日`,
}
