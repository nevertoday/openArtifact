import type { Profile, ProfileChange } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const MAX_BIO_LENGTH = 200

/** The owner's own personal page: the line about them and the one pinned artifact. */
export class ProfileApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  /** `bio` and `pinnedArtifactId` are each kept when left out; a pinnedArtifactId of null unpins. */
  async update(request: Request): Promise<Response> {
    const identity = await this.#context.requireBrowserSession()
    const requestBody = await JsonBody.of(request)
    await this.#context.personalPages.claim(identity.userId)
    const change: ProfileChange = {}
    if (requestBody.has('bio')) change.bio = requestBody.optionalText('bio', MAX_BIO_LENGTH) ?? ''
    if (requestBody.has('pinnedArtifactId')) change.pinnedArtifactId = await this.#pinnableOf(identity.userId, requestBody.optionalText('pinnedArtifactId', 64))
    const profile = await this.#context.repositories.profiles.update(identity.userId, change)
    return Response.json(this.#profileJson(profile))
  }

  // Only something already on the page can be pinned, so the cover is always something strangers may open.
  async #pinnableOf(userId: string, artifactId: string | null): Promise<string | null> {
    if (artifactId === null) return null
    const entries = await this.#context.personalPages.entriesOf(userId, Date.now())
    const onPage = entries.some(entry => entry.artifactId === artifactId)
    if (!onPage) throw HttpError.fieldInvalid('pinnedArtifactId', 'only an artifact listed on your personal page can be pinned')
    return artifactId
  }

  #profileJson(profile: Profile) {
    return { handle: profile.handle, url: this.#context.personalPages.url(profile.handle), bio: profile.bio, pinnedArtifactId: profile.pinnedArtifactId }
  }
}
