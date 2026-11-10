#!/usr/bin/env node
// Seeds a fresh disposable stack at one of three sizes, so every measurement and screenshot starts from the same data.
//   node scripts/ux-ruler/seed.mjs <0|8|100>
import { helper, relaunch, saveSeed } from './stack.mjs'
import { samplePage } from './sample-pages.mjs'

const FOUNDER = { email: 'founder@example.com', name: 'Maya Chen' }
const MEMBER = { email: 'alexander@example.com', name: 'Alexander Montgomery' }
const CLIENTS = ['Claude Code', 'Codex', 'Cursor', 'Claude Code', null]
const VISIBILITIES = ['workspace', 'workspace', 'workspace', 'private', 'workspace', 'public_link', 'workspace', 'specified']

const pageCount = Number(process.argv[2])
if (![0, 8, 100].includes(pageCount)) {
  console.error('usage: seed.mjs <0|8|100>')
  process.exit(2)
}

let run = relaunch()

async function call(method, path, { token = run.token, cookie = null, client = null, body } = {}) {
  const headers = { Origin: run.origins.app }
  if (cookie) headers.Cookie = cookie
  else headers.Authorization = `Bearer ${token}`
  if (client) headers['X-Open-Artifact-Client'] = client
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, run.origins.app), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await response.text()
  if (response.status >= 400) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return text }
}

async function publish(index, token) {
  const { title, html } = samplePage(index)
  const published = await call('POST', '/api/artifacts', { token, client: CLIENTS[index % CLIENTS.length], body: { title, visibility: VISIBILITIES[index % VISIBILITIES.length], files: [{ path: 'index.html', content: html }] } })
  return { artifactId: published.artifactId, path: new URL(published.url).pathname, title, visibility: VISIBILITIES[index % VISIBILITIES.length] }
}

helper('api', 'PATCH', '/api/me', '--as', 'session', '--body', JSON.stringify({ name: FOUNDER.name }))
const founderToken = run.token
const pages = []

if (pageCount > 0) {
  const { invite } = helper('api', 'POST', '/api/workspace/invites/link', '--as', 'session').body
  helper('sign-in', '--email', MEMBER.email)
  run = helper('status')
  await call('GET', new URL(invite.url).pathname, { cookie: run.cookie })
  helper('api', 'PATCH', '/api/me', '--as', 'session', '--body', JSON.stringify({ name: MEMBER.name }))
  helper('token')
  const memberToken = helper('status').token

  // Oldest first, so the hero pages published last sit at the top of the home page.
  for (let index = pageCount - 1; index >= 0; index--) pages[index] = await publish(index, index % 4 === 2 ? memberToken : founderToken)

  helper('sign-in', '--email', FOUNDER.email)
  helper('token')
  run = helper('status')

  const hero = pages[0]
  const revised = samplePage(0).html.replace('要点一', '要点一（已更新）')
  await call('PUT', `/api/artifacts/${hero.artifactId}`, { client: 'Claude Code', body: { baseVersion: 1, note: '按评论放大了标题，补了留存口径', files: [{ path: 'index.html', content: revised }] } })
  const comment = (body, forAgent, anchor) => call('POST', `/api/artifacts/${hero.artifactId}/comments`, { cookie: run.cookie, body: { body, forAgent, anchor: { ...anchor, version: 2 } } })
  await comment('标题再大一点，数据用图表展示', true, { selector: 'main > h1', textQuote: hero.title, x: 0.3, y: 0.12 })
  await comment('留存率的口径需要注明', false, { selector: 'main > h2:nth-of-type(3)', textQuote: '要点二', x: 0.5, y: 0.6 })
  await comment('MRR 这个数字和财务的对不上，麻烦核对一下来源，另外建议把单位写清楚', false, { selector: 'main > .tiles', textQuote: 'MRR', x: 0.8, y: 0.3 })

  const removed = await publish(pageCount, run.token)
  await call('DELETE', `/api/artifacts/${removed.artifactId}`, { cookie: run.cookie })
  saveSeed({ pageCount, founder: FOUNDER, member: MEMBER, hero, removed, publicPage: pages.find(page => page.visibility === 'public_link'), privatePage: pages.find(page => page.visibility === 'private'), pages })
} else {
  saveSeed({ pageCount, founder: FOUNDER, member: MEMBER, pages })
}

console.log(JSON.stringify({ seeded: pageCount, app: run.origins.app }))
