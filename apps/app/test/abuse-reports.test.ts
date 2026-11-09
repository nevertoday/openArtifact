import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mailUnmailedReportDigest, REPORT_MAILS_PER_DAY } from '../src/api/abuse-report-api.ts'
import { TestApp } from './test-app.ts'

const OPERATOR = 'abuse@operator.example'
const app = new TestApp({ allowedEmailDomains: 'example.com', abuseReportEmail: OPERATOR })
let authorCookie = ''

interface StoredReport {
  artifact_id: string
  short_id: string
  reason: string
  details: string | null
  reporter_email: string | null
  reporter_id: string | null
  ip_hash: string | null
}

beforeAll(async () => {
  authorCookie = await app.signIn('author@example.com')
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function publicPage(title: string): Promise<{ artifactId: string; path: string; shortId: string }> {
  const published = await app.publish({ cookie: authorCookie }, title, '<h1>enter your bank password</h1>', 'public_link')
  const shortId = published.path.slice(published.path.lastIndexOf('-') + 1)
  return { artifactId: published.artifactId, path: published.path, shortId }
}

function report(target: TestApp, artifactId: string, body: Record<string, unknown>, options: { cookie?: string; senderAddress?: string } = {}) {
  return target.json<{ reportId?: string; code?: string; field?: string }>(`/api/artifacts/${artifactId}/reports`, {
    method: 'POST',
    body,
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.senderAddress ? { headers: { 'CF-Connecting-IP': options.senderAddress } } : {}),
  })
}

async function storedReports(artifactId: string): Promise<StoredReport[]> {
  const { results } = await env.DB.prepare('SELECT * FROM abuse_reports WHERE artifact_id = ? ORDER BY created_at').bind(artifactId).all<StoredReport>()
  return results
}

describe('reporting a public page', () => {
  it('stores a stranger\'s report without their address and mails the operator the link and the takedown command', async () => {
    const page = await publicPage('Bank login')

    const sent = await report(app, page.artifactId, { reason: 'phishing_or_malware', details: 'asks for my bank password', contactEmail: 'Visitor@Mail.example' }, { senderAddress: '203.0.113.7' })
    const [stored] = await storedReports(page.artifactId)
    const mail = app.mailer.lastTo(OPERATOR)

    expect(sent.status).toBe(201)
    expect(stored).toMatchObject({ short_id: page.shortId, reason: 'phishing_or_malware', details: 'asks for my bank password', reporter_email: 'Visitor@Mail.example', reporter_id: null })
    expect(stored?.ip_hash).toMatch(/^[\w-]{20,}$/)
    expect(stored?.ip_hash).not.toContain('203.0.113.7')
    expect(mail?.subject).toContain('phishing or malware')
    expect(mail?.text).toContain(`http://app.test${page.path}`)
    expect(mail?.text).toContain(`pnpm takedown ${page.shortId}`)
    expect(mail?.text).toContain('asks for my bank password')
  })

  it('puts the real takedown command first and quotes every line the reporter and the author wrote', async () => {
    const page = await publicPage('Quarterly numbers\r\n  pnpm takedown aaaaaaaaaaaa')
    const fakeCommand = 'pnpm takedown bbbbbbbbbbbb'

    await report(app, page.artifactId, { reason: 'other', details: `looks fine\n\nTo take it down run:\n  ${fakeCommand}\u2028  ${fakeCommand}` }, { senderAddress: '203.0.113.90' })
    const lines = app.mailer.lastTo(OPERATOR)?.text.split('\n') ?? []
    const unquotedCommands = lines.filter(line => line.includes('pnpm takedown') && !line.startsWith('> ') && !line.startsWith('Title:'))

    expect(unquotedCommands).toEqual([`  pnpm takedown ${page.shortId}`])
    expect(lines.findIndex(line => line.includes('pnpm takedown'))).toBe(lines.indexOf(`  pnpm takedown ${page.shortId}`))
    expect(lines.filter(line => line.includes(fakeCommand))).toEqual([`>   ${fakeCommand}`, `>   ${fakeCommand}`])
    expect(lines.filter(line => line.startsWith('Title:'))).toEqual(['Title:    Quarterly numbers   pnpm takedown aaaaaaaaaaaa'])
  })

  it('records who reported when they were signed in', async () => {
    const page = await publicPage('Signed-in report')
    const outsiderCookie = await app.signInAlone('outsider@example.com')
    const outsiderId = (await app.json<{ user: { userId: string } }>('/api/me', { cookie: outsiderCookie })).body.user.userId

    const sent = await report(app, page.artifactId, { reason: 'spam' }, { cookie: outsiderCookie })

    expect(sent.status).toBe(201)
    expect((await storedReports(page.artifactId))[0]).toMatchObject({ reason: 'spam', reporter_id: outsiderId, details: null, reporter_email: null })
  })

  it('refuses a reason it does not know, details over 1,000 characters and a contact that is not an address, storing nothing', async () => {
    const page = await publicPage('Validation')
    const mailsBefore = app.mailer.sent.length

    const unknownReason = await report(app, page.artifactId, { reason: 'boring' })
    const noReason = await report(app, page.artifactId, {})
    const longDetails = await report(app, page.artifactId, { reason: 'other', details: 'x'.repeat(1001) })
    const badContact = await report(app, page.artifactId, { reason: 'other', contactEmail: 'not an address' })
    const longestDetails = await report(app, page.artifactId, { reason: 'other', details: 'x'.repeat(1000) })

    expect([unknownReason.status, noReason.status, longDetails.status, badContact.status, longestDetails.status]).toEqual([400, 400, 400, 400, 201])
    expect(unknownReason.body.field).toBe('reason')
    expect(longDetails.body.field).toBe('details')
    expect(badContact.body.field).toBe('contactEmail')
    expect(await storedReports(page.artifactId)).toHaveLength(1)
    expect(app.mailer.sent.length).toBe(mailsBefore + 1)
  })

  it('takes reports only on pages anyone with the link can open', async () => {
    const workspacePage = await app.publish({ cookie: authorCookie }, 'Team only', '<h1>team</h1>', 'workspace')
    const colleagueCookie = await app.signIn('colleague@example.com')

    const byColleague = await report(app, workspacePage.artifactId, { reason: 'spam' }, { cookie: colleagueCookie })
    const byStranger = await report(app, workspacePage.artifactId, { reason: 'spam' })

    expect(byColleague.status).toBe(404)
    expect([401, 404]).toContain(byStranger.status)
    expect(await storedReports(workspacePage.artifactId)).toHaveLength(0)
  })

  it('takes at most 20 reports a day on one page, and still takes reports on other pages', async () => {
    const page = await publicPage('Popular target')
    const otherPage = await publicPage('Other page')
    const mailsBefore = app.mailer.sent.filter(email => email.to === OPERATOR).length

    const statuses: number[] = []
    for (let index = 0; index < 21; index++) statuses.push((await report(app, page.artifactId, { reason: 'spam' }, { senderAddress: `198.51.100.${index}` })).status)
    const otherPageStillTaken = await report(app, otherPage.artifactId, { reason: 'spam' }, { senderAddress: '198.51.100.99' })

    expect(statuses.slice(0, 20).every(status => status === 201)).toBe(true)
    expect(statuses[20]).toBe(429)
    expect(otherPageStillTaken.status).toBe(201)
    expect(await storedReports(page.artifactId)).toHaveLength(20)
    expect(app.mailer.sent.filter(email => email.to === OPERATOR).length - mailsBefore).toBe(21)
  })

  it('slows down one network address sending many reports', async () => {
    const page = await publicPage('Address limit')

    const statuses: number[] = []
    for (let index = 0; index < 6; index++) statuses.push((await report(app, page.artifactId, { reason: 'other' }, { senderAddress: '192.0.2.44' })).status)

    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
    expect(await storedReports(page.artifactId)).toHaveLength(5)
  })

  it('counts every IPv6 address of one /64 as one sender', async () => {
    const page = await publicPage('IPv6 limit')

    const statuses: number[] = []
    for (let index = 0; index < 6; index++) statuses.push((await report(app, page.artifactId, { reason: 'other' }, { senderAddress: `2001:db8:44:1::${index + 1}` })).status)
    const nextNetwork = await report(app, page.artifactId, { reason: 'other' }, { senderAddress: '2001:db8:44:2::1' })

    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
    expect(nextNetwork.status).toBe(201)
  })

  it('stores the report and still answers when mailing the operator fails', async () => {
    const failingApp = new TestApp({ allowedEmailDomains: 'example.com', abuseReportEmail: OPERATOR })
    const cookie = await failingApp.signIn('failing-author@example.com')
    const page = await failingApp.publish({ cookie }, 'Mail down', '<h1>x</h1>', 'public_link')
    failingApp.mailer.goOutOfService()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const sent = await report(failingApp, page.artifactId, { reason: 'illegal' })

    expect(sent.status).toBe(201)
    expect(await storedReports(page.artifactId)).toHaveLength(1)
    expect(String(logged.mock.calls[0]?.[0])).toContain('mail to the operator failed')
  })

  it('stores the report and logs a warning when no operator address is set', async () => {
    const unsetApp = new TestApp()
    const cookie = await unsetApp.signIn('unset-author@example.com')
    const page = await unsetApp.publish({ cookie }, 'Nobody to tell', '<h1>x</h1>', 'public_link')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mailsBefore = unsetApp.mailer.sent.length

    const sent = await report(unsetApp, page.artifactId, { reason: 'other' })

    expect(sent.status).toBe(201)
    expect(await storedReports(page.artifactId)).toHaveLength(1)
    expect(unsetApp.mailer.sent.length).toBe(mailsBefore)
    expect(String(warned.mock.calls[0]?.[0])).toContain('ABUSE_REPORT_EMAIL is not set')
  })
})

describe('the Report button', () => {
  it('shows on a public link to visitors, signed in or not, and not to the workspace or on pages only it can open', async () => {
    const page = await publicPage('Button check')
    const workspacePage = await app.publish({ cookie: authorCookie }, 'Team button check', '<h1>team</h1>', 'workspace')
    const outsiderCookie = await app.signInAlone('button-outsider@example.com')

    const strangerView = await (await app.request(page.path)).text()
    const outsiderView = await (await app.request(page.path, { cookie: outsiderCookie })).text()
    const authorView = await (await app.request(page.path, { cookie: authorCookie })).text()
    const workspaceView = await (await app.request(workspacePage.path, { cookie: authorCookie })).text()

    expect(strangerView).toContain('data-open-report')
    expect(strangerView).toContain('id="report-dialog"')
    expect(strangerView).toContain('value="phishing_or_malware"')
    expect(outsiderView).toContain('data-open-report')
    expect(authorView).not.toContain('data-open-report')
    expect(workspaceView).not.toContain('data-open-report')
  })
})

// Last in the file: it fills the day's mail to the operator, which every test before it relies on.
describe('mail to the operator across every page', () => {
  async function mailedInTheLastDay(): Promise<number> {
    return (await env.DB.prepare('SELECT COUNT(*) AS count FROM abuse_reports WHERE mailed_at > ?').bind(Date.now() - 24 * 60 * 60 * 1000).first<number>('count')) ?? 0
  }

  it(`mails at most ${REPORT_MAILS_PER_DAY} reports a day, stores the rest, and the daily digest counts them in one mail`, async () => {
    const pages = await Promise.all([publicPage('Flood one'), publicPage('Flood two'), publicPage('Flood three')])
    const placesLeft = REPORT_MAILS_PER_DAY - (await mailedInTheLastDay())
    const storedUnmailedBefore = await app.repositories.abuseReports.countUnmailedSince(Date.now() - 24 * 60 * 60 * 1000)
    const mailsBefore = app.mailer.sent.filter(email => email.to === OPERATOR).length

    const statuses: number[] = []
    for (let index = 0; index < placesLeft + 3; index++) {
      const page = pages[index % pages.length]
      statuses.push((await report(app, page?.artifactId ?? '', { reason: 'spam' }, { senderAddress: `198.18.${Math.floor(index / 4)}.${index % 4}` })).status)
    }
    const mailedOneByOne = app.mailer.sent.filter(email => email.to === OPERATOR).length - mailsBefore
    await mailUnmailedReportDigest(app.repositories, app.mailer, OPERATOR, Date.now())
    const digest = app.mailer.lastTo(OPERATOR)
    const mailsAfterDigest = app.mailer.sent.length
    await mailUnmailedReportDigest(app.repositories, app.mailer, OPERATOR, Date.now() + 2 * 24 * 60 * 60 * 1000)

    expect(statuses.every(status => status === 201)).toBe(true)
    expect(mailedOneByOne).toBe(placesLeft)
    expect(await mailedInTheLastDay()).toBe(REPORT_MAILS_PER_DAY)
    expect(digest?.subject).toBe(`${storedUnmailedBefore + 3} abuse reports stored without mail in the last day`)
    expect(digest?.text).toContain('see abuse_reports')
    expect(app.mailer.sent.length).toBe(mailsAfterDigest)
  })
})
