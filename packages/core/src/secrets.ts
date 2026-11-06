const encoder = new TextEncoder()

function base64UrlOf(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function bytesOfBase64Url(text: string): Uint8Array {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

// Compares in time independent of where the inputs differ, so a signature cannot be guessed byte by byte.
function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

/** Personal API tokens: high-entropy random strings, so a plain SHA-256 is enough to store them safely. */
export class AccessTokenSecret {
  static readonly PREFIX = 'oa_pat_'

  static generate(): string {
    return AccessTokenSecret.PREFIX + base64UrlOf(randomBytes(32))
  }

  static looksLikeToken(value: string): boolean {
    return value.startsWith(AccessTokenSecret.PREFIX)
  }

  static async hashOf(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
    return base64UrlOf(new Uint8Array(digest))
  }
}

const PASSWORD_ITERATIONS = 100_000
const PASSWORD_SCHEME = 'pbkdf2-sha256'

/** Passwords people choose for public links are low-entropy, so they are stretched with PBKDF2 and salted. */
export class PublicLinkPassword {
  static async hash(password: string): Promise<string> {
    const salt = randomBytes(16)
    const derived = await PublicLinkPassword.#derive(password, salt, PASSWORD_ITERATIONS)
    return [PASSWORD_SCHEME, PASSWORD_ITERATIONS, base64UrlOf(salt), base64UrlOf(derived)].join('$')
  }

  static async verify(password: string, storedHash: string): Promise<boolean> {
    const [scheme, iterations, salt, expected] = storedHash.split('$')
    const isKnownFormat = scheme === PASSWORD_SCHEME && iterations !== undefined && salt !== undefined && expected !== undefined
    if (!isKnownFormat) throw new Error('Public link password hash has an unknown format')
    const derived = await PublicLinkPassword.#derive(password, bytesOfBase64Url(salt), Number(iterations))
    return constantTimeEqual(derived, bytesOfBase64Url(expected))
  }

  static async #derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, passwordKey, 256)
    return new Uint8Array(bits)
  }
}

/** HMAC signatures shared by the app and usercontent Workers, which hold the same key. */
export class SigningKey {
  readonly #key: Promise<CryptoKey>

  constructor(secret: string) {
    if (secret.length < 32) throw new Error('Signing key must be at least 32 characters')
    this.#key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  }

  async sign(message: string): Promise<string> {
    const signature = await crypto.subtle.sign('HMAC', await this.#key, encoder.encode(message))
    return base64UrlOf(new Uint8Array(signature))
  }

  async verify(message: string, signature: string): Promise<boolean> {
    const expected = await this.sign(message)
    return constantTimeEqual(encoder.encode(expected), encoder.encode(signature))
  }
}

const USERCONTENT_PATH = /^\/s\/(\d+)\.([A-Za-z0-9_-]+)\/([^/]+)\/v(\d+)\/(.*)$/

export interface UsercontentRequest {
  artifactId: string
  version: number
  filePath: string
}

/**
 * The usercontent Worker never reads cookies, so the app proves a viewer's access by signing the path
 * prefix of one artifact version. Relative links inside the page keep the prefix and stay signed.
 */
export class UsercontentSignature {
  readonly #signingKey: SigningKey

  constructor(signingKey: SigningKey) {
    this.#signingKey = signingKey
  }

  async signedPrefix(artifactId: string, version: number, expiresAt: number): Promise<string> {
    const signature = await this.#signingKey.sign(UsercontentSignature.#message(artifactId, version, expiresAt))
    return `/s/${expiresAt}.${signature}/${encodeURIComponent(artifactId)}/v${version}/`
  }

  /** Returns the requested file when the path carries a valid, unexpired signature; otherwise null. */
  async verifiedRequest(pathname: string, now: number): Promise<UsercontentRequest | null> {
    const pathParts = USERCONTENT_PATH.exec(pathname)
    if (!pathParts) return null
    const [, expiresAtText = '', signature = '', encodedArtifactId = '', versionText = '', filePath = ''] = pathParts
    const expiresAt = Number(expiresAtText)
    if (expiresAt <= now) return null
    const artifactId = decodeURIComponent(encodedArtifactId)
    const version = Number(versionText)
    const signatureMatches = await this.#signingKey.verify(UsercontentSignature.#message(artifactId, version, expiresAt), signature)
    return signatureMatches ? { artifactId, version, filePath } : null
  }

  static #message(artifactId: string, version: number, expiresAt: number): string {
    return `usercontent:${artifactId}:${version}:${expiresAt}`
  }
}
