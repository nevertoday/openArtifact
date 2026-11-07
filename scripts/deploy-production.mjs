// Deploys from the configs scripts/production-config.mjs wrote: the database migrations first, so new code
// never meets old tables, then the app, which the other two Workers reach through service bindings.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const repositoryRoot = new URL('..', import.meta.url).pathname
const CONFIG = 'wrangler.production.jsonc'

function wrangler(worker, args) {
  console.log(`\n▸ ${worker}: wrangler ${args.join(' ')}`)
  execFileSync('npx', ['wrangler', ...args, '--config', CONFIG], { cwd: join(repositoryRoot, 'apps', worker), stdio: 'inherit' })
}

wrangler('app', ['d1', 'migrations', 'apply', 'open-artifact', '--remote'])
for (const worker of ['app', 'usercontent', 'mcp']) wrangler(worker, ['deploy'])
