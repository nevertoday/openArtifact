// How long a post is on X and what a shared link says there. The server, the share panel and the personal page all
// import this file, so the count an author watches is the count the server checks.
//
// X counts by the twitter-text v3 rules: code points in a few Latin, punctuation and symbol ranges weigh 1, every
// other one 2 (Chinese, Japanese, Korean, full-width punctuation, “…”), an emoji sequence weighs 2 however many code
// points make it, and any link weighs 23. A post may weigh 280.

export const MAX_POST_WEIGHT = 280
export const LINK_WEIGHT = 23
export const SHARE_STYLES = /** @type {const} */ (['title_summary', 'title_only'])

const LIGHT_RANGES = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
]
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u
// A bare domain such as example.com is a link to X too when its ending is a real top-level domain. Only the common
// ones are named, and a bare domain counts as whichever weighs more, a link or its letters, so the count never falls short.
const LINK = /https?:\/\/[^\s<>"]+|(?<![\w@.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2}|com|net|org|info|biz|io|dev|app|ai|xyz|edu|gov|tech|site|online|blog|page|cloud)(?:\/[^\s<>"]*)?(?![\w-])/giu
const SENTENCE_ENDS = ['。', '！', '？', '；', '.', '!', '?', ';']
const CLAUSE_ENDS = ['，', ',', '、']
const ELLIPSIS = '…'
const PARAGRAPH_BREAK = '\n\n'
// X puts the link after the text with one space between them.
const LINK_SEPARATOR = ' '

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function codePointWeight(codePoint) {
  return LIGHT_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last) ? 1 : 2
}

function plainWeight(text) {
  let weight = 0
  for (const { segment } of graphemes.segment(text)) {
    if (EMOJI.test(segment)) weight += 2
    else for (const character of segment) weight += codePointWeight(character.codePointAt(0))
  }
  return weight
}

/** What `text` weighs on X, links counted as 23 each. */
export function weightedLength(text) {
  const normalized = text.normalize('NFC')
  let weight = 0
  let gapStart = 0
  for (const link of normalized.matchAll(LINK)) {
    weight += plainWeight(normalized.slice(gapStart, link.index))
    weight += /^https?:/i.test(link[0]) ? LINK_WEIGHT : Math.max(LINK_WEIGHT, plainWeight(link[0]))
    gapStart = link.index + link[0].length
  }
  return weight + plainWeight(normalized.slice(gapStart))
}

/** What a post of `text` followed by the shared link weighs; an empty text leaves the link alone. */
export function postWeight(text) {
  return text === '' ? LINK_WEIGHT : weightedLength(text) + weightedLength(LINK_SEPARATOR) + LINK_WEIGHT
}

/**
 * The words that go before the link in a post sharing an article; with the link the post never weighs over 280.
 * `title_summary` is the title, a blank line and as much of the summary as fits, cut after a sentence if one ends
 * in time, else after a clause, else mid-word with “…”. A title too long even alone is cut and the summary dropped.
 */
export function composeShareText({ title, summary }, style = 'title_summary') {
  const budget = MAX_POST_WEIGHT - postWeight('') - weightedLength(LINK_SEPARATOR)
  const cleanTitle = collapse(title)
  if (weightedLength(cleanTitle) > budget) return cutToWeight(cleanTitle, budget)
  const cleanSummary = collapse(summary ?? '')
  if (style === 'title_only' || cleanSummary === '') return cleanTitle
  const summaryBudget = budget - weightedLength(cleanTitle) - weightedLength(PARAGRAPH_BREAK)
  const fittedSummary = fitSummary(cleanSummary, summaryBudget)
  return fittedSummary === '' ? cleanTitle : `${cleanTitle}${PARAGRAPH_BREAK}${fittedSummary}`
}

/** What a personal page says when shared: whose writing, how much, and the first titles that fit. */
export function composePageShareText(lead, titles, quote) {
  const budget = MAX_POST_WEIGHT - postWeight('') - weightedLength(LINK_SEPARATOR)
  let text = collapse(lead)
  if (weightedLength(text) > budget) return cutToWeight(text, budget)
  for (const [index, title] of titles.entries()) {
    const longer = `${text}${quote(collapse(title), index)}`
    const withRoomForMore = index < titles.length - 1 ? weightedLength(ELLIPSIS) : 0
    if (weightedLength(longer) + withRoomForMore > budget) return index === 0 ? text : `${text}${ELLIPSIS}`
    text = longer
  }
  return text
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// A cut point that would throw away more than half of what fits is passed over for the next kind.
function fitSummary(summary, budget) {
  if (weightedLength(summary) <= budget) return summary
  const head = prefixWithin(summary, budget)
  const sentenceEnd = lastEndOf(head, SENTENCE_ENDS)
  if (sentenceEnd > 0 && weightedLength(head.slice(0, sentenceEnd)) >= budget / 2) return head.slice(0, sentenceEnd).trim()
  const clauseHead = prefixWithin(summary, budget - weightedLength(ELLIPSIS))
  const clauseEnd = lastEndOf(clauseHead, CLAUSE_ENDS)
  if (clauseEnd > 0 && weightedLength(clauseHead.slice(0, clauseEnd)) >= budget / 2) return `${clauseHead.slice(0, clauseEnd - 1).trim()}${ELLIPSIS}`
  return cutToWeight(summary, budget)
}

// A full stop inside a word, as in "v1.2" or "e.g.", ends nothing; one before a space or the end does.
function lastEndOf(text, marks) {
  for (let index = text.length - 1; index >= 0; index--) {
    if (!marks.includes(text[index])) continue
    const isAscii = text[index].charCodeAt(0) < 0x80
    const next = text[index + 1]
    if (!isAscii || next === undefined || /\s/.test(next)) return index + 1
  }
  return 0
}

function cutToWeight(text, budget) {
  const head = prefixWithin(text, budget - weightedLength(ELLIPSIS)).trimEnd()
  return head === '' ? '' : `${head}${ELLIPSIS}`
}

// Whole grapheme clusters only, so an emoji or a letter with its accents is never split.
function prefixWithin(text, budget) {
  let head = ''
  for (const { segment } of graphemes.segment(text)) {
    if (weightedLength(head + segment) > budget) break
    head += segment
  }
  return head
}
