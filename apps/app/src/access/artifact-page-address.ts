import type { UsercontentSignature } from '@open-artifact/core'

const SIGNED_URL_LIFETIME_MS = 6 * 60 * 60 * 1000
const ENTRY_PAGE = 'index.html'

/**
 * Where the browser loads a version of an artifact: its entry page on the usercontent origin, under a path
 * signed for a few hours. The signature is the viewer's proof of access, so only code that has checked
 * access asks for one.
 */
export class ArtifactPageAddress {
  readonly usercontentOrigin: string
  readonly #usercontentSignature: UsercontentSignature

  constructor(usercontentOrigin: string, usercontentSignature: UsercontentSignature) {
    this.usercontentOrigin = usercontentOrigin
    this.#usercontentSignature = usercontentSignature
  }

  async entryPageUrl(artifactId: string, version: number, now: number): Promise<string> {
    const signedPrefix = await this.#usercontentSignature.signedPrefix(artifactId, version, now + SIGNED_URL_LIFETIME_MS)
    return `${this.usercontentOrigin}${signedPrefix}${ENTRY_PAGE}`
  }
}
