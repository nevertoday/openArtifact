import type { ArtifactSummary } from './artifact-repository.ts'

/** What an artifact's address is made of: words for people and a short id that alone finds the artifact. */
export type AddressedArtifact = Pick<ArtifactSummary, 'shortId' | 'slug'>

/** What the address segment of a link names: an artifact id in links sent before short ids existed, or a short id. */
export type ArtifactReference = { kind: 'artifact_id'; artifactId: string } | { kind: 'short_id'; shortId: string }

/** The pages under an artifact's address, and the picture shown when it is shared. */
export type ArtifactPage = 'viewer' | 'full' | 'unlock' | 'card'

const PAGE_SUFFIXES: Record<ArtifactPage, string> = { viewer: '', full: '/full', unlock: '/unlock', card: '/card.png' }
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const SHORT_ID_LENGTH = 12
const SHORT_ID_PATTERN = new RegExp(`^[${SHORT_ID_ALPHABET}]{${SHORT_ID_LENGTH}}$`)
const SHORT_ID_VALUES = BigInt(SHORT_ID_ALPHABET.length) ** BigInt(SHORT_ID_LENGTH)
// The largest multiple of 36^12 below 2^64: a random 64-bit number under it maps onto every short id equally often.
const UNBIASED_LIMIT = ((1n << 64n) / SHORT_ID_VALUES) * SHORT_ID_VALUES
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SLUG_LENGTH = 60

/** Twelve random characters from 0-9 and a-z; 36^12 is about 4.7 × 10^18 addresses, too many to guess. */
export class ShortId {
  static generate(): string {
    const randomWord = new BigUint64Array(1)
    for (;;) {
      crypto.getRandomValues(randomWord)
      const candidate = randomWord[0] ?? UNBIASED_LIMIT
      if (candidate < UNBIASED_LIMIT) return (candidate % SHORT_ID_VALUES).toString(36).padStart(SHORT_ID_LENGTH, '0')
    }
  }

  static isWellFormed(text: string): boolean {
    return SHORT_ID_PATTERN.test(text)
  }
}

/**
 * The words in an artifact's address, there only so people can tell what a link is about before opening it.
 * Nothing is ever looked up by them and two artifacts may share them. They are lower-case ASCII letters and
 * digits in words joined by single dashes, at most 60 characters, or empty.
 */
export class ArtifactSlug {
  /** Keeps the ASCII words of any text: "UI 细节对比：Open Artifact" becomes "ui-open-artifact". */
  static normalize(text: string): string {
    const words = text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
    let slug = ''
    for (const word of words) {
      const longer = slug === '' ? word : `${slug}-${word}`
      if (longer.length > MAX_SLUG_LENGTH) return slug === '' ? word.slice(0, MAX_SLUG_LENGTH) : slug
      slug = longer
    }
    return slug
  }

  /**
   * The words the publisher chose, or else those of the title. `englishTitle` is the title translated, for a title
   * whose own words would be lost to the address; see titleToTranslate.
   */
  static forNewArtifact(requested: string | null, title: string, englishTitle: string | null = null): string {
    return ArtifactSlug.afterChange('', requested, title, englishTitle)
  }

  /**
   * Links already sent keep their words when only the title changes. An artifact that has no words yet takes
   * them from its new title.
   */
  static afterChange(current: string, requested: string | null, changedTitle: string | null, englishTitle: string | null = null): string {
    const chosen = ArtifactSlug.#requested(requested)
    if (chosen !== null) return chosen
    if (current === '' && changedTitle !== null) return ArtifactSlug.#titleWords(changedTitle, englishTitle)
    return current
  }

  /**
   * The title worth translating before afterChange: one that gives the address its words but has letters, such as
   * Chinese ones, that the address cannot keep. A new artifact is a change from no words, `current` ''.
   */
  static titleToTranslate(current: string, requested: string | null, changedTitle: string | null): string | null {
    if (ArtifactSlug.#requested(requested) !== null || current !== '' || changedTitle === null) return null
    const lettersLost = changedTitle.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[a-z]/gi, '')
    return /\p{L}/u.test(lettersLost) ? changedTitle : null
  }

  // A translation that keeps no ASCII words is no better than the title's own.
  static #titleWords(title: string, englishTitle: string | null): string {
    const translated = englishTitle === null ? '' : ArtifactSlug.normalize(englishTitle)
    return translated === '' ? ArtifactSlug.normalize(title) : translated
  }

  // Words that normalize to nothing, such as a slug written only in Chinese, count as not given.
  static #requested(requested: string | null): string | null {
    const normalized = requested === null ? '' : ArtifactSlug.normalize(requested)
    return normalized === '' ? null : normalized
  }
}

/** The one place that turns an artifact into its address on the app, and an address back into the artifact it names. */
export class ArtifactPath {
  /** `/a/{slug}-{shortId}`, or `/a/{shortId}` for an artifact without words, plus the page under it. */
  static of(artifact: AddressedArtifact, page: ArtifactPage = 'viewer'): string {
    return ArtifactPath.atSegment(ArtifactPath.segmentOf(artifact), page)
  }

  static segmentOf(artifact: AddressedArtifact): string {
    return artifact.slug === '' ? artifact.shortId : `${artifact.slug}-${artifact.shortId}`
  }

  /** The address as it was requested, for answers that must not reveal the artifact's words to someone who may not open it. */
  static atSegment(segment: string, page: ArtifactPage = 'viewer'): string {
    return `/a/${encodeURIComponent(segment)}${PAGE_SUFFIXES[page]}`
  }

  /** null when the segment cannot name any artifact. The words before the short id are ignored. */
  static parse(segment: string): ArtifactReference | null {
    if (UUID_PATTERN.test(segment)) return { kind: 'artifact_id', artifactId: segment.toLowerCase() }
    const shortId = segment.slice(segment.lastIndexOf('-') + 1).toLowerCase()
    return ShortId.isWellFormed(shortId) ? { kind: 'short_id', shortId } : null
  }
}
