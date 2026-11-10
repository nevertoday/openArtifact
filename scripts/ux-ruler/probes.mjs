// Measurements that run inside the page. Each is a function body kept as source text, so it can be sent to the
// browser; each returns a list of offenders, empty when the page passes.

const PRELUDE = `
const shown = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !el.closest('[inert]')
const nameOf = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24) + '"')
const pause = ms => new Promise(done => setTimeout(done, ms))
`

const probe = body => `(async () => {${PRELUDE}${body}})()`

export const horizontalScroll = probe(`
  const offenders = []
  if (document.documentElement.scrollWidth > innerWidth) offenders.push('page is ' + document.documentElement.scrollWidth + 'px wide in a ' + innerWidth + 'px window')
  for (const table of document.querySelectorAll('table')) if (shown(table) && table.getBoundingClientRect().width > innerWidth) offenders.push('a table is ' + Math.round(table.getBoundingClientRect().width) + 'px wide in a ' + innerWidth + 'px window')
  return offenders
`)

// A control passes when a 44×44 box around its centre lands on the control itself, so a small glyph with a padded
// hit area passes and two small controls packed side by side do not. Links inside a sentence are exempt, as in WCAG 2.5.8.
export const touchTargets = probe(`
  const TARGET = 44
  const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=radio], [role=switch]')]
  const offenders = []
  const modal = document.querySelector('dialog:modal')
  for (const control of controls) {
    if (modal && !modal.contains(control)) continue
    if (!shown(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') continue
    const style = getComputedStyle(control)
    if (style.pointerEvents === 'none') continue
    const inSentence = control.tagName === 'A' && style.display.startsWith('inline') && [...control.parentElement.childNodes].some(node => node.nodeType === 3 && node.textContent.trim().length > 1)
    if (inSentence) continue
    control.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = control.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) continue
    if (rect.width >= TARGET && rect.height >= TARGET) continue
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
    const reach = TARGET / 2 - 1
    const owner = control.closest('label') ?? (control.id ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]') : null) ?? control
    const lands = [[-reach, -reach], [reach, -reach], [-reach, reach], [reach, reach]].every(([dx, dy]) => {
      const x = Math.min(innerWidth - 1, Math.max(0, cx + dx)), y = Math.min(innerHeight - 1, Math.max(0, cy + dy))
      const hit = document.elementFromPoint(x, y)
      return hit !== null && (control.contains(hit) || owner.contains(hit) || hit.contains(control) && hit.closest('a, button, label') === hit)
    })
    if (!lands) offenders.push(nameOf(control) + ' ' + Math.round(rect.width) + '×' + Math.round(rect.height))
  }
  scrollTo(0, 0)
  return offenders
`)

// WCAG contrast of every piece of text against the nearest solid background beneath it; text over a picture or a
// gradient is skipped, since no single ratio describes it. Large text and icons need 3:1, the rest 4.5:1.
export const contrast = probe(`
  const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  const rgba = color => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1); const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255] }
  const over = (top, under) => top[3] >= 1 ? top : [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
  const luminance = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  const backdropOf = el => {
    const layers = []
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.backgroundImage !== 'none') return null
      const color = rgba(style.backgroundColor)
      if (color[3] > 0) layers.push(color)
      if (color[3] >= 1) break
    }
    return layers.reduceRight((under, layer) => over(layer, under), [255, 255, 255, 1])
  }
  const opacityOf = el => { let opacity = 1; for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity); return opacity }
  const offenders = new Map()
  const check = (el, need, what) => {
    if (!shown(el) || el.closest(':disabled, [aria-disabled=true], .xxd-sr-only')) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return
    const backdrop = backdropOf(el)
    if (backdrop === null) return
    const ink = rgba(getComputedStyle(el).color)
    ink[3] *= opacityOf(el)
    const measured = ratio(over(ink, backdrop), backdrop)
    if (measured + 0.05 < need) offenders.set(nameOf(el), what + ' ' + nameOf(el) + ' ' + measured.toFixed(2) + ':1, needs ' + need)
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement
    if (!el || seen.has(el) || walker.currentNode.textContent.trim() === '' || el.closest('script, style, noscript, template')) continue
    seen.add(el)
    const style = getComputedStyle(el)
    const size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 700
    check(el, size >= 24 || (bold && size >= 18.66) ? 3 : 4.5, 'text')
  }
  for (const icon of document.querySelectorAll('a svg, button svg, [role=button] svg')) check(icon, 3, 'icon')
  return [...offenders.values()]
`)

export const truncatedBylines = probe(`
  const offenders = []
  for (const line of document.querySelectorAll('.artifact-meta')) {
    const clipped = [line, ...line.children].some(el => el.scrollWidth > el.clientWidth + 1)
    if (clipped) offenders.push(line.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60))
  }
  return offenders.length > 0 ? [offenders.length + ' of ' + document.querySelectorAll('.artifact-meta').length + ' bylines clipped at ' + innerWidth + 'px, first: ' + offenders[0]] : []
`)

// Walks the whole list the way a person does, following a "load more" control when there is one, and asks every
// card for its cover once the card is on screen.
export const covers = expectedCards => probe(`
  const offenders = []
  for (let round = 0; round < 60; round++) {
    const before = document.querySelectorAll('.artifact-card').length
    scrollTo(0, document.documentElement.scrollHeight)
    document.querySelector('[data-load-more]')?.click()
    await pause(350)
    if (document.querySelectorAll('.artifact-card').length === before && round > 0) break
  }
  const cards = [...document.querySelectorAll('.artifact-card')]
  if (cards.length !== ${expectedCards}) offenders.push('the list reaches ' + cards.length + ' of ${expectedCards} cards')
  let bare = 0
  for (const card of cards) {
    card.scrollIntoView({ block: 'center' })
    let cover = null
    for (let wait = 0; wait < 12 && !cover; wait++) { cover = card.querySelector('.artifact-cover__preview'); if (!cover) await pause(100) }
    if (!cover) bare++
  }
  if (bare > 0) offenders.push(bare + ' of ' + cards.length + ' cards have no cover')
  return offenders
`)

export const cardStatusForScreenReaders = probe(`
  const spoken = card => { const copy = card.cloneNode(true); copy.querySelectorAll('[aria-hidden=true]').forEach(el => el.remove()); return (copy.getAttribute('aria-label') ?? '') + ' ' + copy.textContent }
  const offenders = []
  for (const card of document.querySelectorAll('.artifact-card')) {
    for (const chip of card.querySelectorAll('.artifact-chip')) {
      const label = (chip.querySelector('.xxd-sr-only')?.textContent || chip.textContent).trim()
      if (label && !spoken(card).includes(label)) offenders.push(label)
    }
  }
  return offenders.length > 0 ? [offenders.length + ' card labels are not read out, first: ' + offenders[0]] : []
`)

export const emptyTabStops = probe(`
  const interactive = 'a[href], button, input, select, textarea, summary, iframe, [contenteditable], [role=button], [role=tab], [role=menuitem], [role=dialog], [role=slider], [role=separator]'
  return [...document.querySelectorAll('[tabindex]')].filter(el => el.tabIndex >= 0 && shown(el) && !el.matches(interactive) && !(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)).map(nameOf)
`)

// What stays stuck to the top of a phone screen after scrolling, and how tall the bar is before scrolling.
export const stickyTop = probe(`
  const LIMIT = 56
  const offenders = []
  const bar = document.querySelector('.app-topbar, .viewer-bar')
  if (bar && bar.getBoundingClientRect().height > LIMIT) offenders.push('top bar is ' + Math.round(bar.getBoundingClientRect().height) + 'px tall')
  const scroller = document.scrollingElement
  if (scroller.scrollHeight > innerHeight + 200) {
    scrollTo(0, 400)
    await pause(200)
    let stuck = 0
    for (const el of document.querySelectorAll('body *')) {
      const position = getComputedStyle(el).position
      if (position !== 'sticky' && position !== 'fixed') continue
      const rect = el.getBoundingClientRect()
      if (shown(el) && rect.top <= 1 && rect.bottom > 0 && rect.bottom < innerHeight / 2 && rect.width > innerWidth / 2) stuck = Math.max(stuck, rect.bottom)
    }
    scrollTo(0, 0)
    if (stuck > LIMIT) offenders.push(Math.round(stuck) + 'px stay stuck to the top after scrolling')
  }
  return offenders
`)

export const insideWindow = selector => probe(`
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el || !shown(el)) return [${JSON.stringify(selector)} + ' did not open']
  const rect = el.getBoundingClientRect()
  const out = []
  if (rect.bottom > innerHeight + 0.5) out.push('bottom ' + Math.round(rect.bottom) + ' in a ' + innerHeight + 'px tall window')
  if (rect.right > innerWidth + 0.5) out.push('right ' + Math.round(rect.right) + ' in a ' + innerWidth + 'px wide window')
  if (rect.top < -0.5) out.push('top ' + Math.round(rect.top))
  if (rect.left < -0.5) out.push('left ' + Math.round(rect.left))
  return out.map(text => ${JSON.stringify(selector)} + ' ' + text)
`)
