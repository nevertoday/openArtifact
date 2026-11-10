#!/usr/bin/env node
// Photographs every page on the list against the seeded stack, for reviewers who score from screenshots alone.
//   node scripts/ux-ruler/seed.mjs 8 && node scripts/ux-ruler/shoot.mjs
// Shots land in .verify/ux-ruler/shots/<commit>-<pages>/, named <device>-<page>-<scheme>.png.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { helper, loadSeed, REPO } from './stack.mjs'

const seed = loadSeed()
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
const outDir = join(REPO, '.verify/ux-ruler/shots', `${commit}-${seed.pageCount}`)
mkdirSync(outDir, { recursive: true })

const DEVICES = { desktop: '1440x900', phone: '390x844' }
const OPEN_COMMENTS = [['click', '[data-comment-count-button]'], ['sleep', 800]]

/** The page list: what to open, as whom, and what to do before the picture. `both` also takes it in dark. */
function pageList() {
  const empty = [
    { name: 'home-empty', path: '/', both: true },
    { name: 'settings-agents', path: '/settings/agents' },
    { name: 'personal-empty', path: '/@me' },
    { name: 'login', path: '/login', as: 'anon', both: true },
  ]
  if (seed.pageCount === 0) return empty
  const viewer = seed.hero.path
  return [
    { name: 'home', path: '/', both: true },
    { name: 'home-mine', path: '/?filter=mine' },
    { name: 'home-search', path: `/?q=${encodeURIComponent('定价')}` },
    { name: 'home-removed', path: '/?filter=removed' },
    { name: 'home-workspace-menu', path: '/', steps: [['click', '[data-xxd-menu=workspace-menu]'], ['sleep', 400]] },
    { name: 'home-account-menu', path: '/', steps: [['click', '[data-account-button]'], ['sleep', 400]] },
    { name: 'viewer', path: viewer, both: true, steps: [['sleep', 900]] },
    { name: 'viewer-comments', path: viewer, both: true, steps: [['sleep', 900], ...OPEN_COMMENTS] },
    { name: 'viewer-share', path: viewer, steps: [['sleep', 900], ['click', 'button.xxd-btn[data-open-share]'], ['sleep', 700]] },
    { name: 'viewer-versions', path: viewer, steps: [['sleep', 900], ['click', '[data-version-button]'], ['sleep', 500]] },
    { name: 'viewer-composer', path: viewer, only: 'desktop', steps: [['sleep', 900], ['click', '[data-comment-mode]'], ['sleep', 300], ['mouse', '700,420'], ['sleep', 600]] },
    { name: 'viewer-visitor', path: seed.publicPage.path, as: 'anon', steps: [['sleep', 900]] },
    { name: 'viewer-private-visitor', path: seed.privatePage.path, as: 'anon' },
    { name: 'viewer-removed', path: seed.removed.path },
    { name: 'settings-profile', path: '/settings/profile', both: true },
    { name: 'settings-agents', path: '/settings/agents' },
    { name: 'settings-members', path: '/settings/members' },
    { name: 'settings-workspace', path: '/settings/workspace' },
    { name: 'personal', path: '/@me', both: true },
    { name: 'login', path: '/login', as: 'anon', both: true },
    { name: 'not-found', path: '/no/such/page' },
    { name: 'home-english', path: '/', english: true },
  ]
}

let taken = 0
for (const page of pageList()) {
  for (const [device, viewport] of Object.entries(DEVICES)) {
    if (page.only && page.only !== device) continue
    for (const scheme of page.both ? ['light', 'dark'] : ['light']) {
      const shot = `${device}-${page.name}-${scheme}`
      const steps = [['viewport', viewport], ['scheme', scheme], ['reload'], ['sleep', 700]]
      if (page.english) steps.push(['click', 'form[action="/locale"] button[value=en]'], ['sleep', 900])
      steps.push(...(page.steps ?? []), ['shot', shot])
      const args = ['browse', page.path, '--as', page.as ?? 'session']
      for (const [name, value] of steps) args.push(`--${name}`, ...(value === undefined ? [] : [String(value)]))
      const file = helper(...args).results.find(result => result.step === 'shot').file
      copyFileSync(file, join(outDir, basename(file)))
      taken++
    }
  }
}
console.log(JSON.stringify({ shots: taken, directory: outDir }))
