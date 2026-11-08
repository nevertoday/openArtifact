import { ArtifactPath, type ArtifactSummary, type ShareReadiness } from '@open-artifact/core'
import { composeShareText, postWeight } from '../../public/static/share-text.js'
import type { CardDrawing } from './card-renderer.ts'

/** Bumped whenever the card pictures are drawn differently, so X and the store fetch the new drawing. */
export const CARD_TEMPLATE_VERSION = 1

const X_POST_INTENT = 'https://x.com/intent/post'
const PROFILE_CARD_TITLES = 3

/**
 * One artifact as it goes out on X: its link, the picture X shows, the words before the link and the address
 * that opens X's post box with both filled in. The viewer's byline, the personal page, the author's share panel
 * and agents all start from here, so they never disagree about what is posted.
 */
export class ShareCard {
  readonly url: string
  readonly title: string
  readonly imageUrl: string
  /** The author's own words when they wrote some; otherwise made from the title and summary. Fits with the link. */
  readonly text: string
  readonly intentUrl: string
  readonly readiness: ShareReadiness
  readonly #summary: ArtifactSummary

  private constructor(summary: ArtifactSummary, readiness: ShareReadiness, appOrigin: string) {
    this.#summary = summary
    this.url = `${appOrigin}${ArtifactPath.of(summary)}`
    this.title = summary.title
    this.imageUrl = `${appOrigin}${ArtifactPath.of(summary, 'card')}?v=${ShareCard.cardVariant(summary.version)}`
    this.text = summary.shareText ?? composeShareText({ title: summary.title, summary: summary.summary })
    this.intentUrl = ShareCard.intentUrl(this.text, this.url)
    this.readiness = readiness
  }

  static of(summary: ArtifactSummary, readiness: ShareReadiness, appOrigin: string): ShareCard {
    return new ShareCard(summary, readiness, appOrigin)
  }

  /** Names one drawing of a version: a new version or a new template is a new picture at a new address. */
  static cardVariant(version: number): string {
    return `${version}.${CARD_TEMPLATE_VERSION}`
  }

  /** X's post box with `text` written and `url` after it; the parameters are encoded here and nowhere else. */
  static intentUrl(text: string, url: string): string {
    return `${X_POST_INTENT}?${new URLSearchParams({ text, url })}`
  }

  /** What agents and the share panel read; `summary` and `savedText` let the panel compose the other styles. */
  toJson() {
    return {
      readiness: this.readiness,
      url: this.url,
      title: this.title,
      summary: this.#summary.summary,
      savedText: this.#summary.shareText,
      imageUrl: this.imageUrl,
      x: { text: this.text, weightedLength: postWeight(this.text), intentUrl: this.intentUrl },
    }
  }
}

/** The card of a personal page: the person and the titles of their three latest pieces. */
export class ProfileShareCard {
  static drawing(name: string, handle: string, entries: Pick<ArtifactSummary, 'title'>[]): Extract<CardDrawing, { kind: 'profile' }> {
    return { kind: 'profile', name, handle, titles: entries.slice(0, PROFILE_CARD_TITLES).map(entry => entry.title) }
  }

  static ownerId(userId: string): string {
    return `profile-${userId}`
  }

  /** Changes whenever anything drawn changes, so a new listing or a new name is a new picture at a new address. */
  static async variant(drawing: Extract<CardDrawing, { kind: 'profile' }>): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(drawing)))
    const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 16)}.${CARD_TEMPLATE_VERSION}`
  }
}
