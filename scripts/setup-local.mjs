// Prepares local development: secrets in .dev.vars (kept if they already exist) and the local D1 schema.
// The app and usercontent Workers must hold the same signing key, or every artifact frame answers 403.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repositoryRoot = new URL('..', import.meta.url).pathname
const appVarsPath = join(repositoryRoot, 'apps/app/.dev.vars')
const usercontentVarsPath = join(repositoryRoot, 'apps/usercontent/.dev.vars')

function secret() {
  return randomBytes(32).toString('base64url')
}

function signingKeyIn(varsPath) {
  return readFileSync(varsPath, 'utf8').match(/^USERCONTENT_SIGNING_KEY=(.+)$/m)?.[1] ?? null
}

if (existsSync(appVarsPath)) {
  console.log('apps/app/.dev.vars exists; keeping its secrets')
} else {
  writeFileSync(appVarsPath, `BETTER_AUTH_SECRET=${secret()}\nUSERCONTENT_SIGNING_KEY=${secret()}\nMAILER=console\nALLOWED_EMAIL_DOMAINS=example.com\n`)
  console.log('wrote apps/app/.dev.vars')
}

const signingKey = signingKeyIn(appVarsPath)
if (!signingKey) throw new Error('apps/app/.dev.vars has no USERCONTENT_SIGNING_KEY')
writeFileSync(usercontentVarsPath, `USERCONTENT_SIGNING_KEY=${signingKey}\n`)
console.log('wrote apps/usercontent/.dev.vars with the same signing key')

execFileSync('pnpm', ['--dir', 'apps/app', 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'open-artifact', '--local', '--persist-to', '../../.wrangler/state'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})
