// The ruler drives the disposable stack of the verify-open-artifact skill; this file is the only place that knows how.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const HELPER = join(REPO, '.claude/skills/verify-open-artifact/scripts/oa-verify.mjs')
const SEED_FILE = join(REPO, '.verify/ux-ruler/seed.json')

export function helper(...args) {
  try {
    return JSON.parse(execFileSync('node', [HELPER, ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch (error) {
    throw new Error(`oa-verify ${args.slice(0, 2).join(' ')} failed: ${error.stdout || error.stderr || error.message}`)
  }
}

export function relaunch() {
  try { helper('stop') } catch { /* no run was active */ }
  const launched = helper('launch')
  if (!launched.ready) throw new Error(`the stack did not come up: ${JSON.stringify(launched)}`)
  return helper('status')
}

/**
 * One headless page visit. `steps` is a list of [name, value] pairs in the helper's vocabulary; the values of the
 * eval steps come back in order.
 */
export function browse(path, steps, { as = 'session' } = {}) {
  const args = ['browse', path, '--as', as]
  for (const [name, value] of steps) args.push(`--${name}`, ...(value === undefined ? [] : [String(value)]))
  const { results } = helper(...args)
  return results.filter(result => result.step === 'eval' || result.step === 'frame-eval').map(result => result.value)
}

export function saveSeed(seed) {
  mkdirSync(dirname(SEED_FILE), { recursive: true })
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2))
}

export function loadSeed() {
  try {
    return JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  } catch {
    throw new Error('no seeded stack: run `node scripts/ux-ruler/seed.mjs 100` first')
  }
}
