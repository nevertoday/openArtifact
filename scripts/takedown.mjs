// Takes an abusive artifact down for everyone, as the operator: `pnpm takedown <link or short id> [--dry-run]`.
// Its author cannot restore it, nor can any workspace admin; it is purged 30 days later like any removed artifact.
// Runs `wrangler d1 execute` against the production database named in apps/app/wrangler.production.jsonc, which
// `pnpm deploy:config` writes; wrangler must be signed in to the deployment's Cloudflare account.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { shortIdOf, takedownSql } from './takedown-sql.mjs'

const repositoryRoot = new URL('..', import.meta.url).pathname
const appDirectory = join(repositoryRoot, 'apps', 'app')
const CONFIG = 'wrangler.production.jsonc'
const DATABASE = 'open-artifact'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const references = args.filter(arg => arg !== '--dry-run')
if (references.length !== 1) {
  console.error('Usage: pnpm takedown <artifact link or short id> [--dry-run]')
  process.exit(2)
}
const shortId = shortIdOf(references[0])
if (shortId === null) {
  console.error(`"${references[0]}" names no artifact: pass its link, such as https://artifact.example.com/a/notes-k7f3q9x2m4ab, or its 12-character short id`)
  process.exit(2)
}

const sql = takedownSql(shortId, Date.now())
console.log(sql)
if (dryRun) process.exit(0)
if (!existsSync(join(appDirectory, CONFIG))) {
  console.error(`apps/app/${CONFIG} is missing; run \`pnpm deploy:config\` with the deployment's settings first (see docs/deploy.md)`)
  process.exit(1)
}
// wrangler prints how many rows changed: 0 means no artifact has this short id.
execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--config', CONFIG, '--command', sql], { cwd: appDirectory, stdio: 'inherit' })
