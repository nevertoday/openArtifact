import { ArtifactPath, type ArtifactSummary } from '@open-artifact/core'
import { dateText } from '../../public/static/time-text.js'
import type { ApiContext } from '../api/api-context.ts'
import { CardTemplates, type CardDrawing, type CardRenderer } from './card-renderer.ts'
import { ProfileShareCard, ShareCard } from './share-card.ts'

const ENTRY_PAGE = 'index.html'
// The picture's address names its version, so what it shows never changes; without the version it may.
const NAMED_DRAWING_CACHE = 'public, max-age=31536000, immutable'
const UNNAMED_DRAWING_CACHE = 'public, max-age=300'

/**
 * The pictures X shows for a shared link: /a/{segment}/card.png and /@{handle}/card.png. Each is drawn the first
 * time it is asked for and kept. A card exists only for what is on a personal page; for anything else the answer
 * is the same few bytes as for an artifact that never existed, so a card never reveals a private title.
 */
export class CardRoutes {
  readonly #context: ApiContext
  readonly #renderer: CardRenderer

  constructor(context: ApiContext, renderer: CardRenderer) {
    this.#context = context
    this.#renderer = renderer
  }

  static notFound(): Response {
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  }

  async article(request: Request, segment: string): Promise<Response> {
    const reference = ArtifactPath.parse(segment)
    const openedArtifact = reference ? await this.#context.gate.openReferenced(reference, null, request) : null
    const shareable = openedArtifact?.shareReadiness.kind === 'ready' || openedArtifact?.shareReadiness.kind === 'expires'
    if (!openedArtifact || !shareable) return CardRoutes.notFound()
    const { summary } = openedArtifact
    const variant = ShareCard.cardVariant(summary.version)
    return this.#card(request, summary.artifactId, variant, () => this.#articleDrawing(summary))
  }

  async profile(request: Request, handle: string): Promise<Response> {
    const profile = await this.#context.personalPages.findByHandle(handle)
    if (!profile) return CardRoutes.notFound()
    const [entries, names] = await Promise.all([this.#context.personalPages.entriesOf(profile.userId, Date.now()), this.#context.people.namesOf([profile.userId])])
    const drawing = ProfileShareCard.drawing(names.get(profile.userId) ?? profile.handle, profile.handle, entries)
    return this.#card(request, ProfileShareCard.ownerId(profile.userId), await ProfileShareCard.variant(drawing), async () => drawing)
  }

  async #articleDrawing(summary: ArtifactSummary): Promise<CardDrawing> {
    const [entryPage, names] = await Promise.all([
      this.#context.repositories.artifacts.readVersionFile(summary.artifactId, summary.version, ENTRY_PAGE),
      this.#context.people.namesOf([summary.authorId]),
    ])
    return {
      kind: 'article',
      template: await CardTemplates.forPage(entryPage?.body ?? null),
      title: summary.title,
      summary: summary.summary,
      author: names.get(summary.authorId) ?? '',
      date: dateText(summary.currentVersionAt),
      version: summary.version,
    }
  }

  // A failed drawing is not kept and not cached, so the next request tries again.
  async #card(request: Request, ownerId: string, variant: string, drawingOf: () => Promise<CardDrawing>): Promise<Response> {
    const cacheControl = new URL(request.url).searchParams.get('v') === variant ? NAMED_DRAWING_CACHE : UNNAMED_DRAWING_CACHE
    const stored = await this.#context.repositories.shareCardImages.read(ownerId, variant)
    if (stored) return CardRoutes.#png(stored, cacheControl)
    let png: Uint8Array
    try {
      png = await this.#renderer.render(await drawingOf())
    } catch (error) {
      console.error(new Error(`could not draw share card ${ownerId}/${variant}`, { cause: error }))
      return new Response('The card could not be drawn; try again shortly.\n', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' } })
    }
    await this.#context.repositories.shareCardImages.write(ownerId, variant, png)
    return CardRoutes.#png(png, cacheControl)
  }

  static #png(png: Uint8Array, cacheControl: string): Response {
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' } })
  }
}
