import { describe, expect, it } from 'vitest'
import { TestApp } from './test-app.ts'

// Deployed, one person may write 300 times a minute (SHARED_DATA_PERSON_RATE_LIMITER in wrangler.jsonc). This app
// allows 3, so the test reaches the limit in a handful of requests and stays fast on a slow runner.
const app = new TestApp({ allowedEmailDomains: 'example.com', tightPersonWriteLimit: true })
const LIMIT = 3

async function newAuthor(name: string): Promise<string> {
  return app.signInAlone(`${name}@example.com`)
}

async function openPage(cookie: string, title: string): Promise<string> {
  const { artifactId } = await app.publish({ cookie }, title)
  await app.request(`/api/artifacts/${artifactId}/sharing`, { method: 'PUT', cookie, body: { visibility: 'public_link', anonymousWriteEnabled: true } })
  return artifactId
}

function put(artifactId: string, documentId: string, options: { cookie?: string; senderAddress?: string }): Promise<Response> {
  return app.request(`/api/artifacts/${artifactId}/data/votes/${documentId}`, {
    method: 'PUT',
    body: { data: { ok: true } },
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.senderAddress ? { headers: { 'CF-Connecting-IP': options.senderAddress } } : {}),
  })
}

describe('shared data from people signed in', () => {
  it('limits each person’s changes a minute wherever they write from, deletes included, and counts each person apart', async () => {
    const [busy, other] = [await newAuthor('busy-person'), await newAuthor('other-person')]
    const artifactId = await openPage(busy, 'Busy tracker')

    const statuses: number[] = []
    for (let index = 0; index <= LIMIT; index++) statuses.push((await put(artifactId, `v${index}`, { cookie: busy, senderAddress: `198.51.100.${index}` })).status)
    const deleteBySamePerson = await app.request(`/api/artifacts/${artifactId}/data/votes/v0`, { method: 'DELETE', cookie: busy })
    const otherPerson = await put(artifactId, 'other', { cookie: other })
    const visitor = await put(artifactId, 'visitor', { senderAddress: '198.51.100.77' })

    expect(statuses.slice(0, LIMIT).every(status => status === 200)).toBe(true)
    expect(statuses[LIMIT]).toBe(429)
    expect(deleteBySamePerson.status).toBe(429)
    expect(otherPerson.status).toBe(200)
    expect(visitor.status).toBe(200)
  })
})
