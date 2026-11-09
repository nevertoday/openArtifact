import { beforeAll, describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

const app = new TestApp()
const english = { 'Accept-Language': 'en' }
let adminCookie = ''
let memberCookie = ''
let artifactId = ''
let artifactPath = ''

beforeAll(async () => {
  adminCookie = await app.signIn('ada@example.com')
  memberCookie = await app.signIn('ben@example.com')
  const token = await app.createToken(adminCookie)
  const published = await app.publish({ token, agentClient: 'Claude Code' }, 'Pricing page')
  artifactId = published.artifactId
  artifactPath = published.path
  await app.request('/api/workspace', { method: 'PATCH', cookie: adminCookie, body: { name: 'Acme' } })
})

async function englishPage(path: string, cookie: string): Promise<string> {
  const response = await app.request(path, { cookie, headers: english })
  expect(response.status).toBe(200)
  return response.text()
}

// Allowed: the switch names 中文 in Chinese, agent-facing guide text glosses labels as `Label (标签)`, the audit log
// quotes the workspace's stored name, a personal workspace keeps the name it was given in Chinese at sign-up, and
// ArtifactLabels' wording is migrated by another area.
const ALLOWED = ['我的团队', '[a-z]+ 的工作区']
const chineseLines = (markup: string) =>
  markup
    .replace(/lang="zh-CN">(<i [^>]*><\/i>)?中文/g, '')
    .replace(/ \([^()]*[一-鿿][^()]*\)/g, '')
    .replaceAll(new RegExp(ALLOWED.join('|'), 'g'), '')
    .split('\n')
    .filter(line => /[一-鿿]/.test(line))

describe('server-rendered pages in English', () => {
  it('words the viewer in English', async () => {
    const viewer = await englishPage(artifactPath, memberCookie)

    expect(viewer).toContain('Comment mode (C)')
    expect(viewer).toContain('Write a comment…')
    expect(viewer).toContain('Keyboard shortcuts')
    expect(viewer).toContain('Open in a new tab')
    expect(viewer).toContain('Version 1, choose a version')
    expect(chineseLines(viewer)).toEqual([])
  })

  it('words agent access and the guide pack in English, with the token slots kept', async () => {
    const agents = await englishPage('/settings/agents', adminCookie)

    expect(agents).toContain('<title>Agent access · Open Artifact</title>')
    expect(agents).toContain('1 · Name this agent')
    expect(agents).toContain('This token is shown only once.')
    expect(agents).toContain('AGENTS.md snippet')
    expect(agents).toContain('-H &quot;X-Open-Artifact-Client: my script&quot;')
    expect(agents).toContain('Use open-artifact to publish a test page titled “Connection test” that says hello.')
    expect(agents).toContain('<code class="xxd-code-inline">X-Open-Artifact-Client</code> to the agent&#39;s name')
    expect(chineseLines(agents)).toEqual([])
  })

  it('words the profile page and its theme choices in English', async () => {
    const profile = await englishPage('/settings/profile', adminCookie)

    expect(profile).toContain('<legend class="xxd-label">Appearance</legend>')
    expect(profile).toMatch(/value="system" checked><span>System<\/span>/)
    expect(profile).toContain("You sign in with your email, so it can&#39;t be changed.")
    expect(chineseLines(profile)).toEqual([])
  })

  it('words the members and workspace pages in English, with the audit log in sentences', async () => {
    await app.request(`/api/artifacts/${artifactId}`, { method: 'PATCH', cookie: adminCookie, body: { title: 'Pricing' } })
    const members = await englishPage('/settings/members', adminCookie)
    const workspace = await englishPage('/settings/workspace', adminCookie)

    expect(members).toContain('Invite colleagues')
    expect(members).toMatch(/2 people\./)
    expect(workspace).toContain('Let members share artifacts as public links')
    expect(workspace).toContain('Admin log')
    expect(workspace).toContain('renamed “Pricing page” to “Pricing”')
    expect(chineseLines(members)).toEqual([])
    expect(chineseLines(workspace)).toEqual([])
  })
})
