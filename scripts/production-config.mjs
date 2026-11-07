// Writes apps/*/wrangler.production.jsonc from each Worker's own wrangler.jsonc and the deployment's settings,
// so a deployment changes only its addresses and ids, never the bindings the code needs. The files stay out of
// git: they name one team's account. Settings come from the environment:
//   CLOUDFLARE_ACCOUNT_ID  the account the Workers run in
//   D1_DATABASE_ID         the id `wrangler d1 create open-artifact` printed
//   APP_HOST               the app's address, e.g. artifact.example.com; MCP is served at its /mcp
//   APP_ZONE               the Cloudflare zone APP_HOST belongs to, e.g. example.com
//   USERCONTENT_HOST       artifact files, on another site than the app, e.g. artifact-files.example-content.com
//   MAIL_FROM              optional sender for sign-in mail; mail goes through Cloudflare Email Service when set
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repositoryRoot = new URL('..', import.meta.url).pathname

function setting(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set; see the top of scripts/production-config.mjs`)
  return value
}

// Only whole-line comments are used in these files, and a URL inside a string contains // too.
function readBaseConfig(worker) {
  const text = readFileSync(join(repositoryRoot, 'apps', worker, 'wrangler.jsonc'), 'utf8')
  return JSON.parse(text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n'))
}

function writeProductionConfig(worker, config) {
  const path = join(repositoryRoot, 'apps', worker, 'wrangler.production.jsonc')
  writeFileSync(path, `// Written by scripts/production-config.mjs; do not edit or commit.\n${JSON.stringify(config, null, 2)}\n`)
  console.log(`wrote ${path}`)
}

const accountId = setting('CLOUDFLARE_ACCOUNT_ID')
const appHost = setting('APP_HOST')
const appOrigin = `https://${appHost}`
const usercontentHost = setting('USERCONTENT_HOST')
const mailFrom = process.env.MAIL_FROM?.trim()

const app = readBaseConfig('app')
app.d1_databases[0].database_id = setting('D1_DATABASE_ID')
writeProductionConfig('app', {
  ...app,
  account_id: accountId,
  workers_dev: false,
  routes: [{ pattern: appHost, custom_domain: true }],
  vars: { ...app.vars, USERCONTENT_ORIGIN: `https://${usercontentHost}`, MCP_ORIGIN: appOrigin, ...(mailFrom ? { MAILER: 'cloudflare', MAIL_FROM: mailFrom } : {}) },
})

const usercontent = readBaseConfig('usercontent')
writeProductionConfig('usercontent', {
  ...usercontent,
  account_id: accountId,
  workers_dev: false,
  routes: [{ pattern: usercontentHost, custom_domain: true }],
  vars: { ...usercontent.vars, APP_ORIGIN: appOrigin },
})

const mcp = readBaseConfig('mcp')
writeProductionConfig('mcp', {
  ...mcp,
  account_id: accountId,
  workers_dev: false,
  routes: [{ pattern: `${appHost}/mcp`, zone_name: setting('APP_ZONE') }],
  vars: { ...mcp.vars, APP_ORIGIN: appOrigin },
})
