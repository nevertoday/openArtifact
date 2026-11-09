#!/usr/bin/env node
// Drives a disposable Open Artifact stack for verification: launch, doctor, sign-in, api, publish, mcp, browse, stop.
// Every run lives in .verify/runs/<runId>/ and never touches the developer's own `pnpm dev` stack (ports 8787-8789,
// .wrangler/state, the default wrangler dev registry). Evidence goes to .verify/evidence/<runId>/ and survives `stop`.
// Run `node .claude/skills/verify-open-artifact/scripts/oa-verify.mjs help` for the command list.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const VERIFY_DIR = join(REPO, '.verify')
const CURRENT_FILE = join(VERIFY_DIR, 'current')
const DEFAULT_BASE_PORT = 18787
const DEFAULT_EMAIL = 'founder@example.com'
const CHROME = process.env.OA_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WORKERS = ['app', 'usercontent', 'mcp']

const HELP = `oa-verify — drive a disposable Open Artifact stack

Commands (all print JSON on stdout; errors exit 1 with {"error", "hint"}):
  launch [--base 18787] [--email founder@example.com] [--no-seed]
        Start app (:base), mcp (:base+1), usercontent (:base+2) on a fresh D1/R2 state dir, apply migrations,
        then sign in the founder and create a full-scope API token. Refuses if a run is already active.
  doctor                Read-only: processes alive, ports answer /health with the right service, session and token valid.
  status                Print the active run's run.json (ports, origins, email, token prefix, paths).
  sign-in [--email a@example.com]
        Request a sign-in code, read it from the app log, enter it, store the session cookie for that email.
  token [--scope publish|full] [--name verify]
        Create an API token from the stored session (default scope full). Stored as the run's token.
  api <METHOD> <path> [--body '<json>' | --body @file.json] [--as token|session|anon] [--workspace <id>|none]
        Call the app HTTP API. Default --as token. Prints {status, body}.
  publish --file <index.html> [--title T] [--visibility workspace|private|specified|public_link]
        POST /api/artifacts with the run's token. Prints {artifactId, version, shortId, url, path}; url is the canonical /a/{slug}-{shortId}.
  mcp <tools/list | toolName> [--args '<json>']
        initialize + one call against the MCP server with the run's token. Prints the JSON-RPC result.
  browse <path-or-url> [steps...] [--as session|anon]
        Headless Chrome with the run's session cookie. Steps run in order:
          --wait <css>          wait until the selector exists (10s)
          --click <css>         click the element
          --fill '<css>::<text>' set an input/textarea value and fire input events
          --press <Key>         dispatch a key (Escape, Enter, c, ...)
          --sleep <ms>          pause
          --eval '<js>'         evaluate in the top page; result is printed
          --frame-text          print innerText of the #artifact-frame document
          --shot <name>         save a PNG to .verify/evidence/<run>/<name>.png
          --dom <name>          save document.body.innerText to .verify/evidence/<run>/<name>.txt
          --viewport <W>x<H>    resize the page; below 700 px wide it also emulates a touch phone
          --scheme <light|dark> emulate prefers-color-scheme
          --reload              reload the page and wait for it to load
  log <app|usercontent|mcp> [--tail 40]   Print the last lines of a worker log.
  stop                  Kill only the processes this run started, delete its state dir. Evidence is kept.
`

// ---------- small helpers ----------
function fail(error, hint) {
  process.stdout.write(JSON.stringify({ error, hint }, null, 2) + '\n')
  process.exit(1)
}
function out(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

function parseArgs(argv) {
  const positional = []
  const flags = {}
  const steps = []
  const stepFlags = new Set(['wait', 'click', 'fill', 'press', 'sleep', 'eval', 'frame-text', 'shot', 'dom', 'viewport', 'scheme', 'reload'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const name = arg.slice(2)
    const takesNoValue = name === 'frame-text' || name === 'no-seed' || name === 'reload'
    const value = takesNoValue ? true : argv[++i]
    if (value === undefined) fail(`--${name} needs a value`, HELP)
    if (stepFlags.has(name)) steps.push({ name, value })
    else flags[name] = value
  }
  return { positional, flags, steps }
}

function currentRunId() {
  return existsSync(CURRENT_FILE) ? readFileSync(CURRENT_FILE, 'utf8').trim() || null : null
}
function runDir(runId) { return join(VERIFY_DIR, 'runs', runId) }
function evidenceDir(runId) {
  const dir = join(VERIFY_DIR, 'evidence', runId)
  mkdirSync(dir, { recursive: true })
  return dir
}
function loadRun() {
  const runId = currentRunId()
  if (!runId || !existsSync(join(runDir(runId), 'run.json'))) fail('no active verification run', 'start one with: oa-verify launch')
  return JSON.parse(readFileSync(join(runDir(runId), 'run.json'), 'utf8'))
}
function saveRun(run) {
  writeFileSync(join(runDir(run.runId), 'run.json'), JSON.stringify(run, null, 2))
}
function record(run, entry) {
  appendFileSync(join(evidenceDir(run.runId), 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
async function portAnswers(port) {
  try { const r = await fetch(`http://localhost:${port}/health`); return await r.json() } catch { return null }
}

// ---------- launch / stop ----------
function devVarsOk() {
  const appVars = join(REPO, 'apps/app/.dev.vars')
  const ucVars = join(REPO, 'apps/usercontent/.dev.vars')
  if (!existsSync(appVars) || !existsSync(ucVars)) return 'apps/app/.dev.vars or apps/usercontent/.dev.vars is missing'
  const key = file => readFileSync(file, 'utf8').match(/^USERCONTENT_SIGNING_KEY=(.+)$/m)?.[1]
  if (!key(appVars) || key(appVars) !== key(ucVars)) return 'USERCONTENT_SIGNING_KEY differs between the two .dev.vars files'
  return null
}

async function launch(flags) {
  const active = currentRunId()
  if (active && existsSync(runDir(active))) fail(`run ${active} is still active`, 'run `oa-verify doctor` to reuse it, or `oa-verify stop` first')
  const varsProblem = devVarsOk()
  if (varsProblem) fail(varsProblem, 'run `pnpm dev:setup` once from the repo root (it keeps existing secrets)')
  const base = Number(flags.base ?? DEFAULT_BASE_PORT)
  const ports = { app: base, mcp: base + 1, usercontent: base + 2 }
  const inspector = { app: base + 10, mcp: base + 11, usercontent: base + 12 }
  for (const [name, port] of Object.entries({ ...ports, ...Object.fromEntries(Object.entries(inspector).map(([k, v]) => [`${k}-inspector`, v])) })) {
    try {
      execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'pipe' })
      fail(`port ${port} (${name}) is already in use`, `pick another range with --base, e.g. --base ${base + 100}`)
    } catch (error) {
      if (error.status !== 1) throw error // lsof exits 1 when nothing listens
    }
  }
  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  const dir = runDir(runId)
  for (const sub of ['state', 'registry', 'logs']) mkdirSync(join(dir, sub), { recursive: true })
  const origins = Object.fromEntries(Object.entries(ports).map(([k, p]) => [k, `http://localhost:${p}`]))
  const run = { runId, dir, ports, inspector, origins, pids: {}, email: null, cookie: null, token: null, evidence: evidenceDir(runId), startedAt: Date.now() }
  mkdirSync(VERIFY_DIR, { recursive: true })
  writeFileSync(CURRENT_FILE, runId)
  saveRun(run)

  // Migrations first, into this run's own state dir, so the app is usable from the first request.
  try {
    execFileSync('pnpm', ['--dir', 'apps/app', 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'open-artifact', '--local', '--persist-to', join(dir, 'state')], {
      cwd: REPO, stdio: ['ignore', openSync(join(dir, 'logs', 'migrations.log'), 'a'), openSync(join(dir, 'logs', 'migrations.log'), 'a')], env: { ...process.env, CI: '1' },
    })
  } catch {
    fail('D1 migrations failed', `read ${join(dir, 'logs', 'migrations.log')}; then oa-verify stop`)
  }

  const varsFor = {
    app: [`USERCONTENT_ORIGIN:${origins.usercontent}`, `MCP_ORIGIN:${origins.mcp}`, 'MAILER:console', 'ALLOWED_EMAIL_DOMAINS:example.com', 'ABUSE_REPORT_EMAIL:operator@example.com'],
    usercontent: [`APP_ORIGIN:${origins.app}`],
    mcp: [`APP_ORIGIN:${origins.app}`],
  }
  // Same order as scripts/dev.mjs: app first, since the other two bind to it.
  for (const worker of WORKERS) {
    const args = ['--dir', `apps/${worker}`, 'exec', 'wrangler', 'dev', '--port', String(ports[worker]), '--inspector-port', String(inspector[worker]),
      '--persist-to', join(dir, 'state'), '--show-interactive-dev-session=false', ...varsFor[worker].flatMap(v => ['--var', v])]
    const logFd = openSync(join(dir, 'logs', `${worker}.log`), 'a')
    const child = spawn('pnpm', args, {
      cwd: REPO, detached: true, stdio: ['ignore', logFd, logFd],
      // A private registry keeps this run's service bindings away from the developer's own `pnpm dev` Workers.
      env: { ...process.env, WRANGLER_REGISTRY_PATH: join(dir, 'registry'), CI: '1', NO_COLOR: '1' },
    })
    child.unref()
    run.pids[worker] = child.pid
    saveRun(run)
    const deadline = Date.now() + 90_000
    let healthy = null
    while (Date.now() < deadline && !healthy) {
      if (!pidAlive(child.pid)) break
      healthy = await portAnswers(ports[worker])
      if (!healthy) await sleep(500)
    }
    if (!healthy) fail(`${worker} did not answer /health on :${ports[worker]}`, `read ${join(dir, 'logs', `${worker}.log`)}; then oa-verify stop`)
  }
  record(run, { command: 'launch', ports })
  if (!flags['no-seed']) {
    await signIn(run, flags.email ?? DEFAULT_EMAIL)
    await createToken(run, 'full', 'verify')
  }
  out({ ready: true, runId, origins, email: run.email, tokenPrefix: run.token?.slice(0, 12) ?? null, evidence: run.evidence, logs: join(dir, 'logs') })
}

async function stop() {
  const runId = currentRunId()
  if (!runId || !existsSync(runDir(runId))) { out({ stopped: false, reason: 'no active run' }); return }
  const run = JSON.parse(readFileSync(join(runDir(runId), 'run.json'), 'utf8'))
  const killed = []
  for (const [worker, pid] of Object.entries(run.pids ?? {})) {
    // Each worker was spawned detached, so its pid leads a process group holding pnpm, wrangler and workerd.
    try { process.kill(-pid, 'SIGINT'); killed.push(worker) } catch {}
  }
  await sleep(2000)
  for (const pid of Object.values(run.pids ?? {})) { try { process.kill(-pid, 'SIGKILL') } catch {} }
  if (run.chromePid) { try { process.kill(run.chromePid, 'SIGKILL') } catch {} }
  record(run, { command: 'stop', killed })
  rmSync(runDir(runId), { recursive: true, force: true })
  rmSync(CURRENT_FILE, { force: true })
  out({ stopped: true, runId, killed, evidenceKept: join(VERIFY_DIR, 'evidence', runId), evidenceFiles: readdirSync(join(VERIFY_DIR, 'evidence', runId)) })
}

// ---------- doctor ----------
async function doctor() {
  const run = loadRun()
  const checks = {}
  for (const worker of WORKERS) {
    const health = await portAnswers(run.ports[worker])
    let portOwnerInGroup = false
    try {
      const pids = execFileSync('lsof', ['-nP', '-t', `-iTCP:${run.ports[worker]}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').map(Number)
      const groups = pids.map(pid => Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()))
      portOwnerInGroup = groups.includes(run.pids[worker])
    } catch {}
    checks[worker] = { pidAlive: pidAlive(run.pids[worker]), health: health?.status ?? null, service: health?.service ?? null, portOwnedByThisRun: portOwnerInGroup }
  }
  if (run.cookie) {
    // The settings page prints MCP_ORIGIN; seeing this run's MCP port proves the --var override reached the app,
    // rather than the 8788 default that would send agents to the developer's own stack.
    const agentsPage = await fetch(`${run.origins.app}/settings/agents`, { headers: { Cookie: run.cookie } }).then(r => r.text()).catch(() => '')
    checks.appUsesThisRunsMcpOrigin = agentsPage.includes(run.origins.mcp.replace('http://', ''))
  }
  if (run.cookie) {
    const me = await fetch(`${run.origins.app}/api/me`, { headers: { Cookie: run.cookie } })
    checks.session = { status: me.status, email: me.ok ? (await me.json()).email ?? run.email : null }
  }
  if (run.token) {
    const list = await fetch(`${run.origins.app}/api/artifacts`, { headers: { Authorization: `Bearer ${run.token}` } })
    checks.token = { status: list.status }
  }
  const healthy = WORKERS.every(w => checks[w].pidAlive && checks[w].health === 'ok' && checks[w].portOwnedByThisRun && checks[w].service === `open-artifact-${w}`)
    && (!run.cookie || (checks.session.status === 200 && checks.appUsesThisRunsMcpOrigin)) && (!run.token || checks.token.status === 200)
  out({ healthy, runId: run.runId, origins: run.origins, checks })
  if (!healthy) process.exit(1)
}

// ---------- auth ----------
function logText(run, worker) {
  const file = join(run.dir, 'logs', `${worker}.log`)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

async function signIn(run, email) {
  const before = logText(run, 'app').length
  const headers = { 'Content-Type': 'application/json', Origin: run.origins.app }
  const request = await fetch(`${run.origins.app}/api/auth/sign-in/send-code`, { method: 'POST', headers, body: JSON.stringify({ email }) })
  if (!request.ok) fail(`sign-in code request answered ${request.status}: ${await request.text()}`, 'only @example.com addresses are admitted in a verification run')
  let code = null
  const deadline = Date.now() + 15_000
  while (!code && Date.now() < deadline) {
    const fresh = logText(run, 'app').slice(before)
    const block = fresh.split('[mail] To: ').filter(part => part.startsWith(email)).pop()
    code = block?.match(/\b\d{6}\b/)?.[0] ?? null
    if (!code) await sleep(300)
  }
  if (!code) fail('no sign-in code appeared in the app log', `oa-verify log app --tail 60`)
  const verify = await fetch(`${run.origins.app}/api/auth/sign-in/email-otp`, { method: 'POST', headers, body: JSON.stringify({ email, otp: code }), redirect: 'manual' })
  const cookies = verify.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('='))
  if (cookies.length === 0) fail(`entering the sign-in code set no cookie (status ${verify.status})`, 'a code works once; run sign-in again')
  run.cookie = cookies.join('; ')
  run.email = email
  saveRun(run)
  const me = await fetch(`${run.origins.app}/api/me`, { headers: { Cookie: run.cookie } })
  const meBody = await me.json().catch(() => null)
  record(run, { command: 'sign-in', email, meStatus: me.status })
  if (!me.ok) fail(`/api/me answered ${me.status} after sign-in`, JSON.stringify(meBody))
  return meBody
}

// A page names the workspace it shows on every write (X-Open-Artifact-Workspace), as common.js does.
async function pageWorkspaceId(run) {
  const me = await fetch(`${run.origins.app}/api/me`, { headers: { Cookie: run.cookie } })
  return me.ok ? (await me.json()).workspace.workspaceId : null
}

async function createToken(run, scope, name) {
  if (!run.cookie) fail('no session in this run', 'oa-verify sign-in first')
  const response = await fetch(`${run.origins.app}/api/tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: run.origins.app, Cookie: run.cookie, 'X-Open-Artifact-Workspace': (await pageWorkspaceId(run)) ?? '' }, body: JSON.stringify({ name, scope, expiresInDays: 1 }),
  })
  const body = await response.json().catch(() => null)
  if (response.status !== 201) fail(`token creation answered ${response.status}`, JSON.stringify(body))
  run.token = body.token
  saveRun(run)
  record(run, { command: 'token', scope, tokenId: body.tokenId })
  return body
}

// ---------- api / publish / mcp ----------
// The session follows cookies the app sets, as a browser does: creating or switching a workspace sets oa_workspace.
function keepCookies(run, response) {
  const jar = new Map(run.cookie.split('; ').map(pair => [pair.split('=')[0], pair]))
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(';')[0]
    const name = pair.split('=')[0]
    if (pair.endsWith('=')) jar.delete(name)
    else jar.set(name, pair)
  }
  run.cookie = [...jar.values()].join('; ')
  saveRun(run)
}

async function api(run, method, path, flags) {
  const as = flags.as ?? (run.token ? 'token' : 'session')
  const headers = { Origin: run.origins.app }
  if (as === 'token') { if (!run.token) fail('no token in this run', 'oa-verify token'); headers.Authorization = `Bearer ${run.token}` }
  if (as === 'session') { if (!run.cookie) fail('no session in this run', 'oa-verify sign-in'); headers.Cookie = run.cookie }
  // --workspace <id> names another workspace, --workspace none names none; left out, the current one is named.
  const namedWorkspace = as === 'session' ? (flags.workspace === undefined ? await pageWorkspaceId(run) : flags.workspace === 'none' ? null : flags.workspace) : null
  if (namedWorkspace) headers['X-Open-Artifact-Workspace'] = namedWorkspace
  let body
  if (flags.body !== undefined) {
    body = flags.body.startsWith('@') ? readFileSync(resolve(flags.body.slice(1)), 'utf8') : flags.body
    JSON.parse(body) // fail early on bad JSON
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(new URL(path, run.origins.app), { method: method.toUpperCase(), headers, body })
  if (as === 'session') keepCookies(run, response)
  const text = await response.text()
  let parsed = text
  try { parsed = JSON.parse(text) } catch {}
  record(run, { command: 'api', method, path, as, status: response.status })
  return { status: response.status, body: parsed }
}

async function mcp(run, target, flags) {
  if (!run.token) fail('no token in this run', 'oa-verify token')
  const url = `${run.origins.mcp}/mcp`
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${run.token}` }
  const init = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code-verify' }, capabilities: {} } }) })
  if (!init.ok) fail(`MCP initialize answered ${init.status}`, await init.text())
  const session = init.headers.get('Mcp-Session-Id')
  const call = target === 'tools/list'
    ? { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    : { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: target, arguments: flags.args ? JSON.parse(flags.args) : {} } }
  const response = await fetch(url, { method: 'POST', headers: { ...headers, ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(call) })
  const body = await response.json()
  record(run, { command: 'mcp', target, status: response.status, isError: body.result?.isError ?? Boolean(body.error) })
  return body
}

// ---------- browser (raw CDP over Node's WebSocket) ----------
async function browse(run, target, steps, flags) {
  if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}`, 'set OA_CHROME to a Chrome or Chromium binary')
  const profile = join(run.dir, 'chrome')
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', detached: true })
  run.chromePid = chrome.pid
  saveRun(run)
  const results = []
  try {
    let portFile = null
    for (let i = 0; i < 100 && !portFile; i++) { if (existsSync(join(profile, 'DevToolsActivePort'))) portFile = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8'); else await sleep(100) }
    if (!portFile) fail('headless Chrome did not start', CHROME)
    const port = portFile.split('\n')[0]
    let pages = []
    for (let i = 0; i < 50 && pages.length === 0; i++) { pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(p => p.type === 'page'); if (!pages.length) await sleep(100) }
    const ws = new WebSocket(pages[0].webSocketDebuggerUrl)
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
    let nextId = 0
    const pending = new Map()
    const frames = new Map()
    ws.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
      if (message.method === 'Page.frameNavigated') frames.set(message.params.frame.id, message.params.frame)
    }
    const send = (method, params = {}) => new Promise((ok, no) => {
      const id = ++nextId
      pending.set(id, m => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    }
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
    if ((flags.as ?? 'session') === 'session' && run.cookie) {
      for (const pair of run.cookie.split('; ')) {
        const at = pair.indexOf('=')
        await send('Network.setCookie', { name: pair.slice(0, at), value: pair.slice(at + 1), url: run.origins.app })
      }
    }
    const url = /^https?:/.test(target) ? target : new URL(target, run.origins.app).href
    await send('Page.navigate', { url })
    for (let i = 0; i < 100; i++) { if ((await evaluate('document.readyState')) === 'complete') break; await sleep(100) }
    results.push({ step: 'navigate', url, finalUrl: await evaluate('location.href'), title: await evaluate('document.title') })
    const sel = s => JSON.stringify(s)
    for (const step of steps) {
      if (step.name === 'wait') {
        let found = false
        for (let i = 0; i < 100 && !found; i++) { found = await evaluate(`!!document.querySelector(${sel(step.value)})`); if (!found) await sleep(100) }
        if (!found) throw new Error(`--wait ${step.value}: not found within 10s`)
        results.push({ step: 'wait', selector: step.value })
      } else if (step.name === 'click') {
        const ok = await evaluate(`(() => { const el = document.querySelector(${sel(step.value)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true })()`)
        if (!ok) throw new Error(`--click ${step.value}: no such element`)
        results.push({ step: 'click', selector: step.value })
      } else if (step.name === 'fill') {
        const [selector, text] = step.value.split('::')
        const ok = await evaluate(`(() => { const el = document.querySelector(${sel(selector)}); if (!el) return false; el.focus(); el.value = ${sel(text ?? '')}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true })()`)
        if (!ok) throw new Error(`--fill ${selector}: no such element`)
        results.push({ step: 'fill', selector })
      } else if (step.name === 'press') {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: step.value, text: step.value.length === 1 ? step.value : undefined })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: step.value })
        results.push({ step: 'press', key: step.value })
      } else if (step.name === 'viewport') {
        const [width, height] = step.value.split('x').map(Number)
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 })
        await send('Emulation.setTouchEmulationEnabled', { enabled: width < 700, maxTouchPoints: 5 })
        results.push({ step: 'viewport', width, height })
      } else if (step.name === 'scheme') {
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: step.value }] })
        results.push({ step: 'scheme', value: step.value })
      } else if (step.name === 'reload') {
        await send('Page.reload')
        await sleep(300)
        for (let i = 0; i < 100; i++) { if ((await evaluate('document.readyState')) === 'complete') break; await sleep(100) }
        results.push({ step: 'reload' })
      } else if (step.name === 'sleep') {
        await sleep(Number(step.value)); results.push({ step: 'sleep', ms: Number(step.value) })
      } else if (step.name === 'eval') {
        results.push({ step: 'eval', value: await evaluate(step.value) })
      } else if (step.name === 'frame-text') {
        // The artifact iframe is sandboxed without allow-same-origin, so Chrome runs it out of process as its own
        // DevTools target. Find that target and read its document directly.
        let text = ''
        let frameUrl = null
        for (let i = 0; i < 50 && !text; i++) {
          const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
          const frameTarget = targets.find(t => t.type === 'iframe' && t.url.startsWith(run.origins.usercontent))
          if (frameTarget) {
            frameUrl = frameTarget.url
            const frameWs = new WebSocket(frameTarget.webSocketDebuggerUrl)
            await new Promise((ok, no) => { frameWs.onopen = ok; frameWs.onerror = no })
            text = await new Promise(ok => {
              frameWs.onmessage = event => { const m = JSON.parse(event.data); if (m.id === 1) ok(m.result?.result?.value ?? '') }
              frameWs.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.body ? document.body.innerText : ""', returnByValue: true } }))
            })
            frameWs.close()
          }
          if (!text) await sleep(200)
        }
        if (!frameUrl) throw new Error(`--frame-text: no iframe target from ${run.origins.usercontent} appeared`)
        results.push({ step: 'frame-text', frameUrl, text })
      } else if (step.name === 'shot') {
        await sleep(300)
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        const file = join(evidenceDir(run.runId), `${step.value}.png`)
        writeFileSync(file, Buffer.from(shot.data, 'base64'))
        results.push({ step: 'shot', file })
      } else if (step.name === 'dom') {
        const file = join(evidenceDir(run.runId), `${step.value}.txt`)
        writeFileSync(file, await evaluate('document.body.innerText'))
        results.push({ step: 'dom', file })
      }
    }
    ws.close()
    record(run, { command: 'browse', target, steps: steps.map(s => s.name) })
    return { ok: true, results }
  } catch (error) {
    record(run, { command: 'browse', target, error: String(error.message ?? error) })
    fail(String(error.message ?? error), JSON.stringify(results))
  } finally {
    try { process.kill(-chrome.pid, 'SIGKILL') } catch { try { chrome.kill('SIGKILL') } catch {} }
    run.chromePid = null
    saveRun(run)
  }
}

// ---------- main ----------
const [command, ...rest] = process.argv.slice(2)
const { positional, flags, steps } = parseArgs(rest)
switch (command) {
  case 'launch': await launch(flags); break
  case 'stop': await stop(); break
  case 'doctor': await doctor(); break
  case 'status': out(loadRun()); break
  case 'sign-in': { const run = loadRun(); out({ signedIn: true, me: await signIn(run, flags.email ?? DEFAULT_EMAIL) }); break }
  case 'token': { const run = loadRun(); const t = await createToken(run, flags.scope ?? 'full', flags.name ?? 'verify'); out({ tokenId: t.tokenId, scope: t.scope, tokenPrefix: t.token.slice(0, 12) }); break }
  case 'api': {
    const run = loadRun()
    if (positional.length < 2) fail('api needs <METHOD> <path>', 'oa-verify api GET /api/me --as session')
    out(await api(run, positional[0], positional[1], flags)); break
  }
  case 'publish': {
    const run = loadRun()
    if (!flags.file) fail('publish needs --file <index.html>', 'oa-verify publish --file page.html --title "Verify page"')
    const content = readFileSync(resolve(flags.file), 'utf8')
    const result = await api(run, 'POST', '/api/artifacts', { body: JSON.stringify({ title: flags.title ?? 'Verify page', visibility: flags.visibility ?? 'workspace', files: [{ path: 'index.html', content }] }) })
    if (result.status !== 201 && result.status !== 200) fail(`publish answered ${result.status}`, JSON.stringify(result.body))
    out({ artifactId: result.body.artifactId, version: result.body.version, shortId: result.body.shortId, url: result.body.url, path: new URL(result.body.url).pathname, body: result.body }); break
  }
  case 'mcp': { const run = loadRun(); if (!positional[0]) fail('mcp needs tools/list or a tool name', 'oa-verify mcp tools/list'); out(await mcp(run, positional[0], flags)); break }
  case 'browse': { const run = loadRun(); if (!positional[0]) fail('browse needs a path', 'oa-verify browse / --shot home'); out(await browse(run, positional[0], steps, flags)); break }
  case 'log': { const run = loadRun(); const lines = logText(run, positional[0] ?? 'app').split('\n'); out({ worker: positional[0] ?? 'app', lines: lines.slice(-Number(flags.tail ?? 40)) }); break }
  case undefined: case 'help': case '--help': process.stdout.write(HELP); break
  default: fail(`unknown command ${command}`, HELP)
}
