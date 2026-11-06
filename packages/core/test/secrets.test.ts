import { describe, expect, it } from 'vitest'
import { AccessTokenSecret, PublicLinkPassword, SigningKey, UsercontentSignature } from '../src/secrets.ts'

const signingKey = new SigningKey('a-local-signing-key-of-at-least-32-chars')
const usercontentSignature = new UsercontentSignature(signingKey)
const now = 1_800_000_000_000

describe('AccessTokenSecret', () => {
  it('generates distinct prefixed tokens with a stable hash', async () => {
    const firstToken = AccessTokenSecret.generate()
    const secondToken = AccessTokenSecret.generate()

    expect(firstToken).toMatch(/^oa_pat_[A-Za-z0-9_-]{43}$/)
    expect(firstToken).not.toBe(secondToken)
    expect(await AccessTokenSecret.hashOf(firstToken)).toBe(await AccessTokenSecret.hashOf(firstToken))
    expect(await AccessTokenSecret.hashOf(firstToken)).not.toBe(await AccessTokenSecret.hashOf(secondToken))
  })
})

describe('PublicLinkPassword', () => {
  it('verifies the right password and rejects others, with a fresh salt each time', async () => {
    const storedHash = await PublicLinkPassword.hash('workshop-2026')

    expect(await PublicLinkPassword.verify('workshop-2026', storedHash)).toBe(true)
    expect(await PublicLinkPassword.verify('workshop-2025', storedHash)).toBe(false)
    expect(await PublicLinkPassword.hash('workshop-2026')).not.toBe(storedHash)
  })

  it('refuses a hash it does not understand', async () => {
    await expect(PublicLinkPassword.verify('x', 'md5$abc')).rejects.toThrow('unknown format')
  })
})

describe('UsercontentSignature', () => {
  it('accepts a signed path, including relative files under it', async () => {
    const signedPrefix = await usercontentSignature.signedPrefix('artifact-1', 3, now + 60_000)

    expect(await usercontentSignature.verifiedRequest(`${signedPrefix}assets/app.css`, now)).toEqual({ artifactId: 'artifact-1', version: 3, filePath: 'assets/app.css' })
  })

  it('rejects an expired, altered or foreign signature', async () => {
    const signedPrefix = await usercontentSignature.signedPrefix('artifact-1', 3, now + 60_000)
    const otherKeySignature = new UsercontentSignature(new SigningKey('another-signing-key-of-at-least-32-chars'))

    expect(await usercontentSignature.verifiedRequest(`${signedPrefix}index.html`, now + 60_000)).toBeNull()
    expect(await usercontentSignature.verifiedRequest(signedPrefix.replace('/v3/', '/v4/') + 'index.html', now)).toBeNull()
    expect(await usercontentSignature.verifiedRequest(signedPrefix.replace('artifact-1', 'artifact-2') + 'index.html', now)).toBeNull()
    expect(await otherKeySignature.verifiedRequest(`${signedPrefix}index.html`, now)).toBeNull()
    expect(await usercontentSignature.verifiedRequest('/artifact-1/v3/index.html', now)).toBeNull()
  })

  it('refuses a key too short to be secret', () => {
    expect(() => new SigningKey('short')).toThrow('at least 32')
  })
})
