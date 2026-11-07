const MAX_HANDLE_LENGTH = 40
const MAX_CANDIDATES = 50
// /@me always leads the signed-in person to their own page, so no one can own it.
const RESERVED_HANDLES = new Set(['me'])

/**
 * The address part of a personal page, made from the person's name: letters and digits of any script, dots,
 * dashes and underscores, lower case. Two people with the same name get name, name-2, name-3 and so on.
 */
export class ProfileHandle {
  static candidatesFor(name: string): string[] {
    const base = ProfileHandle.#baseOf(name)
    const candidates = [base, ...Array.from({ length: MAX_CANDIDATES - 1 }, (_, index) => `${base}-${index + 2}`)]
    return candidates.filter(candidate => !RESERVED_HANDLES.has(candidate))
  }

  static #baseOf(name: string): string {
    const words = name.normalize('NFKC').toLowerCase().trim().split(/\s+/)
    const kept = words.map(word => word.replace(/[^\p{L}\p{N}._-]/gu, '')).filter(Boolean).join('-')
    const trimmed = kept.replace(/^[._-]+|[._-]+$/g, '').slice(0, MAX_HANDLE_LENGTH)
    return trimmed || 'user'
  }
}
