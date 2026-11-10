#!/usr/bin/env node
// The twelve hard gates of the interface, measured in a real browser against a stack seeded with 100 pages.
//   node scripts/ux-ruler/seed.mjs 100 && node scripts/ux-ruler/gates.mjs [gate numbers...]
// Prints one line per gate and exits 1 when any fails. The result, with the commit it measured, goes to
// .verify/ux-ruler/gates.json.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browse, loadSeed, REPO } from './stack.mjs'
import * as probes from './probes.mjs'

const seed = loadSeed()
if (seed.pageCount !== 100) {
  console.error(`the gates measure the 100-page seed; this stack holds ${seed.pageCount}. Run: node scripts/ux-ruler/seed.mjs 100`)
  process.exit(2)
}

const PHONE = [['viewport', '390x844'], ['reload'], ['sleep', 700]]
const desktop = (width = 1440) => [['viewport', `${width}x900`], ['reload'], ['sleep', 700]]
const DARK = [['scheme', 'dark'], ['reload'], ['sleep', 700]]
const OPEN_COMMENTS = [['click', '[data-comment-count-button]'], ['sleep', 700]]
const OPEN_SHARE = [['click', 'button.xxd-btn[data-open-share]'], ['sleep', 700]]
const viewer = seed.hero.path

/** The pages a signed-in person meets, and the states of the viewer that put new controls on screen. */
const SIGNED_IN_VIEWS = [
  { name: 'home', path: '/' },
  { name: 'recently deleted', path: '/?filter=removed' },
  { name: 'viewer', path: viewer, settle: [['sleep', 900]] },
  { name: 'viewer, comments open', path: viewer, settle: [['sleep', 900], ...OPEN_COMMENTS] },
  { name: 'viewer, share open', path: viewer, settle: [['sleep', 900], ...OPEN_SHARE] },
  { name: 'settings: profile', path: '/settings/profile' },
  { name: 'settings: agents', path: '/settings/agents' },
  { name: 'settings: members', path: '/settings/members' },
  { name: 'settings: workspace', path: '/settings/workspace' },
  { name: 'personal page', path: '/@me' },
]
const VISITOR_VIEWS = [
  { name: 'login', path: '/login', as: 'anon' },
  { name: 'public page, visitor', path: seed.publicPage.path, as: 'anon', settle: [['sleep', 900]] },
  { name: 'private page, visitor', path: seed.privatePage.path, as: 'anon' },
]
const ALL_VIEWS = [...SIGNED_IN_VIEWS, ...VISITOR_VIEWS]

/** Runs one probe on each view and gathers the offenders, each named by its view. */
function across(views, frame, probe) {
  return views.flatMap(view => {
    const [offenders] = browse(view.path, [...frame, ...(view.settle ?? []), ['eval', probe]], { as: view.as })
    return offenders.map(offender => `${view.name}: ${offender}`)
  })
}

function loadMs(path) {
  const samples = [0, 1, 2].map(() => browse(path, [['sleep', 300], ['eval', 'performance.getEntriesByType("navigation")[0].loadEventEnd']])[0])
  return samples.sort((a, b) => a - b)[1]
}

// One thing, one word: the Chinese interface calls an artifact 页面. The product name, code identifiers and
// addresses are not interface words.
function mixedWords() {
  const directory = join(REPO, 'apps/app/public/static/i18n/zh-CN')
  const notInterfaceWords = /Open Artifact|open-artifact|OPEN_ARTIFACT|`[^`]*`|\/[\w/:.{}-]*artifacts?[\w/:.{}-]*|\bartifacts?[A-Z_.]\w*|\w+[._]artifacts?\b|artifactId|artifact_id|window\.artifact/g
  const offenders = []
  for (const file of readdirSync(directory).filter(name => name.endsWith('.js'))) {
    readFileSync(join(directory, file), 'utf8').split('\n').forEach((line, index) => {
      const quoted = (line.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? []).join(' ').replace(notInterfaceWords, '')
      if (/artifact/i.test(quoted) || /文档/.test(quoted)) offenders.push(`${file}:${index + 1}`)
    })
  }
  return offenders.length > 0 ? [`${offenders.length} lines say artifact or 文档 where the interface says 页面: ${offenders.slice(0, 6).join(', ')}`] : []
}

const GATES = [
  { number: 1, name: 'no page scrolls sideways at 390px', measure: () => across(ALL_VIEWS, PHONE, probes.horizontalScroll) },
  {
    number: 2,
    name: 'every touch control has a 44×44 hit area',
    measure: () => {
      const offenders = across(ALL_VIEWS, PHONE, probes.touchTargets)
      const [pins] = browse(viewer, [...PHONE, ['sleep', 900], ['frame-eval', `[...document.querySelectorAll('[data-open-artifact-ui]')].flatMap(host => [...host.shadowRoot.querySelectorAll('.pin')]).map(pin => { const r = pin.getBoundingClientRect(); const reach = getComputedStyle(pin, '::after'); const w = Math.max(r.width, parseFloat(reach.width) || 0), h = Math.max(r.height, parseFloat(reach.height) || 0); return w >= 44 && h >= 44 ? null : 'comment pin ' + Math.round(w) + '×' + Math.round(h) }).filter(Boolean)`]])
      return [...offenders, ...(pins ?? ['the page frame did not answer']).map(offender => `viewer, in the page: ${offender}`)]
    },
  },
  {
    number: 3,
    name: 'text contrast 4.5:1, large text and icons 3:1',
    measure: () => [
      ...across(ALL_VIEWS, desktop(), probes.contrast).map(offender => `light, ${offender}`),
      ...across(ALL_VIEWS, [...desktop(), ...DARK], probes.contrast).map(offender => `dark, ${offender}`),
      ...across([SIGNED_IN_VIEWS[0], SIGNED_IN_VIEWS[3], SIGNED_IN_VIEWS[9]], PHONE, probes.contrast).map(offender => `phone, ${offender}`),
    ],
  },
  { number: 4, name: 'card bylines are whole at 1280, 1440 and 1920', measure: () => [1280, 1440, 1920].flatMap(width => across([SIGNED_IN_VIEWS[0]], desktop(width), probes.truncatedBylines)) },
  {
    number: 5,
    name: 'every card has a cover at 100 pages, and the list loads as fast as a short one',
    measure: () => {
      const offenders = across([SIGNED_IN_VIEWS[0]], desktop(), probes.covers(seed.pageCount))
      const [full, short] = [loadMs('/'), loadMs(`/?q=${encodeURIComponent('Q3')}`)]
      return full > short * 1.5 + 200 ? [...offenders, `home loads in ${Math.round(full)} ms with 100 pages against ${Math.round(short)} ms for a short list`] : offenders
    },
  },
  { number: 6, name: 'a screen reader hears the status on each card', measure: () => across([SIGNED_IN_VIEWS[0]], desktop(), probes.cardStatusForScreenReaders) },
  { number: 7, name: 'the Chinese interface has one word for one thing', measure: mixedWords },
  {
    number: 8,
    name: 'sign-in and a half-written reply survive a refresh',
    measure: () => {
      const offenders = []
      const [codeStepShown] = browse('/login', [['fill', '#login-email::refresh@example.com'], ['click', '#email-step [type=submit]'], ['sleep', 1500], ['reload'], ['sleep', 600], ['eval', `(() => { const step = document.querySelector('#code-step'); return Boolean(step && !step.hidden && step.textContent.includes('refresh@example.com')) })()`]], { as: 'anon' })
      if (!codeStepShown) offenders.push('login: refreshing on the code step goes back to the email step')
      const openReply = [['sleep', 900], ...OPEN_COMMENTS, ['click', '.comment-thread__reply-toggle'], ['sleep', 300]]
      const [draft] = browse(viewer, [...desktop(), ...openReply, ['eval', `(() => { const box = document.querySelector('[data-reply-form] textarea'); if (!box) return 'no reply box'; box.focus(); box.value = 'half-written reply'; box.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`], ['sleep', 500], ['reload'], ...openReply, ['eval', `document.querySelector('[data-reply-form] textarea')?.value ?? ''`]]).slice(-1)
      if (draft !== 'half-written reply') offenders.push(`viewer: a half-written reply is gone after a refresh (found "${draft}")`)
      return offenders
    },
  },
  {
    number: 9,
    name: 'the phone back button closes the open panel first',
    measure: () => {
      let state
      try {
        ;[state] = browse(viewer, [...PHONE, ['sleep', 900], ...OPEN_COMMENTS, ['eval', 'void history.back()'], ['sleep', 700], ['eval', `({ path: location.pathname, open: !document.querySelector('#viewer-drawer').hidden })`]]).slice(-1)
      } catch (error) {
        if (!String(error.message).includes('navigated or closed')) throw error
        return ['back left the page instead of closing the comments panel']
      }
      if (state.path !== viewer) return [`back left the page for ${state.path}`]
      return state.open ? ['back left the comments panel open'] : []
    },
  },
  { number: 10, name: 'the Tab order has no empty stops', measure: () => across(SIGNED_IN_VIEWS, desktop(), probes.emptyTabStops) },
  { number: 11, name: 'the phone top bar is one row, at most 56px stuck', measure: () => across([SIGNED_IN_VIEWS[0], SIGNED_IN_VIEWS[2], SIGNED_IN_VIEWS[6], SIGNED_IN_VIEWS[9], VISITOR_VIEWS[1]], PHONE, probes.stickyTop) },
  {
    number: 12,
    name: 'every popover and dialog opens inside the window',
    measure: () => {
      const opened = (name, path, frame, steps, selector, as) => browse(path, [...frame, ['sleep', 800], ...steps, ['sleep', 500], ['eval', probes.insideWindow(selector)]], { as }).slice(-1)[0].map(offender => `${name}: ${offender}`)
      const pickAt = y => [['click', '[data-comment-mode]'], ['sleep', 300], ['mouse', `700,${y}`], ['sleep', 600]]
      return [
        ...[420, 520, 600].flatMap(y => [
          ...opened(`composer on a block at ${y}px`, viewer, desktop(), pickAt(y), '[data-composer]'),
          ...opened(`composer for the agent, on a block at ${y}px`, viewer, desktop(), [...pickAt(y), ['click', '[data-composer] [name=forAgent]']], '[data-composer]'),
        ]),
        ...opened('version menu', viewer, desktop(), [['click', '[data-version-button]']], '#version-menu'),
        ...opened('workspace menu', '/', desktop(), [['click', '[data-xxd-menu=workspace-menu]']], '#workspace-menu'),
        ...opened('account menu', '/', desktop(), [['click', '[data-account-button]']], '#account-menu'),
        ...opened('account menu, phone', '/', PHONE, [['click', '[data-account-button]']], '#account-menu'),
        ...opened('workspace menu, phone', '/', PHONE, [['click', '[data-xxd-menu=workspace-menu]']], '#workspace-menu'),
        ...opened('share dialog, phone', viewer, PHONE, OPEN_SHARE, '#share-dialog'),
        ...opened('version menu, phone', viewer, PHONE, [['click', '[data-version-button]']], '#version-menu'),
      ]
    },
  },
]

const wanted = process.argv.slice(2).map(Number)
const results = []
for (const gate of GATES.filter(gate => wanted.length === 0 || wanted.includes(gate.number))) {
  let offenders
  try {
    offenders = gate.measure()
  } catch (error) {
    offenders = [`could not be measured: ${String(error.message).slice(0, 400)}`]
  }
  results.push({ number: gate.number, name: gate.name, passed: offenders.length === 0, offenders })
  console.log(`${offenders.length === 0 ? 'PASS' : 'FAIL'}  ${String(gate.number).padStart(2)}  ${gate.name}${offenders.length === 0 ? '' : `  (${offenders.length})`}`)
  for (const offender of offenders.slice(0, process.env.RULER_ALL ? Infinity : 8)) console.log(`          ${offender}`)
}

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages'], { cwd: REPO, encoding: 'utf8' }).trim() !== ''
const passed = results.filter(result => result.passed).length
if (wanted.length === 0) writeFileSync(join(REPO, '.verify/ux-ruler/gates.json'), JSON.stringify({ commit, dirty, passed, of: results.length, results }, null, 2))
console.log(`\n${passed} of ${results.length} gates pass at ${commit}${dirty ? ' with uncommitted changes' : ''}`)
process.exit(passed === results.length ? 0 : 1)
