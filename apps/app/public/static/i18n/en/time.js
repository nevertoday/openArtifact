// @ts-check
const plural = (/** @type {number} */ count, /** @type {string} */ unit) => `${count} ${unit}${count === 1 ? '' : 's'} ago`

export default /** @satisfies {import('../messages').Messages['time']} */ ({
  justNow: 'just now',
  minutesAgo: minutes => plural(minutes, 'minute'),
  hoursAgo: hours => plural(hours, 'hour'),
  yesterday: 'yesterday',
  daysAgo: days => plural(days, 'day'),
  day: date => date.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
})
