/** The two looks of an artifact's card: light paper with a serif title, or dark ink for pages that are dark themselves. */
export type CardTemplate = 'paper' | 'ink'

/** What one share card shows. Every field is plain text the server chose; the artifact's own HTML never reaches the drawing. */
export type CardDrawing =
  | { kind: 'article'; template: CardTemplate; title: string; summary: string | null; author: string; date: string; version: number }
  | { kind: 'profile'; name: string; handle: string; titles: string[] }

/** Draws a card as a 1200 × 630 PNG, the size X shows in a large card. Throws when it cannot. */
export interface CardRenderer {
  render(drawing: CardDrawing): Promise<Uint8Array>
}

// A theme colour or page background darker than this is a dark page, which gets the ink card.
const DARK_LUMINANCE = 0.3
const NAMED_COLORS: Record<string, [number, number, number]> = { black: [0, 0, 0], white: [255, 255, 255] }

/**
 * Picks the card that matches the page: ink when its <meta name="theme-color"> or its body background is dark,
 * paper otherwise, and paper whenever neither can be read.
 */
export class CardTemplates {
  static async forPage(entryPage: Uint8Array | null): Promise<CardTemplate> {
    if (entryPage === null) return 'paper'
    const pageColors = { themeColor: null as string | null, bodyStyle: null as string | null, styleSheet: '' }
    await new HTMLRewriter()
      .on('meta[name="theme-color" i]', { element: meta => void (pageColors.themeColor ??= meta.getAttribute('content')) })
      .on('body', { element: body => void (pageColors.bodyStyle = body.getAttribute('style')) })
      .on('style', { text: chunk => void (pageColors.styleSheet += chunk.text) })
      .transform(new Response(entryPage))
      .arrayBuffer()
    const background = pageColors.themeColor ?? CardTemplates.#backgroundIn(pageColors.bodyStyle ?? '') ?? CardTemplates.#bodyBackgroundIn(pageColors.styleSheet)
    const rgb = background === null ? null : CardTemplates.#rgbOf(background)
    return rgb !== null && CardTemplates.#luminance(rgb) < DARK_LUMINANCE ? 'ink' : 'paper'
  }

  static #backgroundIn(declarations: string): string | null {
    return /background(?:-color)?\s*:\s*([^;]+)/i.exec(declarations)?.[1]?.trim() ?? null
  }

  static #bodyBackgroundIn(styleSheet: string): string | null {
    const bodyRule = /(?:^|[\s,}])(?:html|body|:root)\s*(?:,\s*(?:html|body)\s*)*\{([^}]*)\}/i.exec(styleSheet)?.[1]
    return bodyRule === undefined ? null : CardTemplates.#backgroundIn(bodyRule)
  }

  static #rgbOf(color: string): [number, number, number] | null {
    const text = color.trim().toLowerCase()
    const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/.exec(text)?.[1]
    if (hex) {
      const digits = hex.length === 3 ? [...hex].map(digit => digit + digit) : (hex.match(/../g) ?? [])
      return digits.map(pair => parseInt(pair, 16)) as [number, number, number]
    }
    const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(text)
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    return NAMED_COLORS[text] ?? null
  }

  // Relative luminance as WCAG defines it, 0 for black and 1 for white.
  static #luminance(rgb: [number, number, number]): number {
    const [red, green, blue] = rgb.map(channel => {
      const share = channel / 255
      return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
}
