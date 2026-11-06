/** Markup that is already escaped; only `html` creates it. */
export class SafeHtml {
  readonly markup: string

  constructor(markup: string) {
    this.markup = markup
  }

  toString(): string {
    return this.markup
  }
}

const ESCAPED_CHARACTERS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapedMarkupOf(value: unknown): string {
  if (value instanceof SafeHtml) return value.markup
  if (Array.isArray(value)) return value.map(escapedMarkupOf).join('')
  if (value === null || value === undefined || value === false) return ''
  return String(value).replace(/[&<>"']/g, character => ESCAPED_CHARACTERS[character] ?? character)
}

/** Titles and other values come from agents and other users, so every interpolation is escaped. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  const markup = strings.reduce((joined, literal, index) => joined + literal + (index < values.length ? escapedMarkupOf(values[index]) : ''), '')
  return new SafeHtml(markup)
}
