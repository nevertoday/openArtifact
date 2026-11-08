import { Resvg, initWasm } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import satori, { init as initSatori, type Font } from 'satori/standalone'
import yogaWasm from 'satori/yoga.wasm'
import type { CardDrawing, CardRenderer, CardTemplate } from './card-renderer.ts'

const WIDTH = 1200
const HEIGHT = 630
const PADDING = { top: 64, right: 88, bottom: 56, left: 104 }
const TEXT_WIDTH = WIDTH - PADDING.left - PADDING.right
const TITLE_SIZES = [88, 76, 66, 58, 50]
const TITLE_LINE_HEIGHT = 1.18
const MAX_TITLE_LINES = 3
const WIDE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}]/u
const FULL_WIDTH_RANGES = [
  [0x3000, 0x303f],
  [0xff00, 0xffef],
]
const BRAND = 'OPEN ARTIFACT'
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com/css2'
// Satori ends a clamped line with this character, so every font is asked to hold it.
const ELLIPSIS = '…'
const TWEMOJI_SVG = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg'
const ZERO_WIDTH_JOINER = '\u200d'
const VARIATION_SELECTOR = /\ufe0f/g

interface Palette {
  background: string
  bar: string
  ink: string
  soft: string
  faint: string
  titleFamily: 'Noto Serif SC' | 'Noto Sans SC'
}

const PALETTES: Record<CardTemplate, Palette> = {
  paper: { background: '#f6f3ec', bar: '#2f5bd3', ink: '#1c1a16', soft: '#57524a', faint: '#8a8478', titleFamily: 'Noto Serif SC' },
  ink: { background: '#15171b', bar: '#7c97ff', ink: '#f3f1ec', soft: '#b6bac3', faint: '#7d828d', titleFamily: 'Noto Sans SC' },
}

type Node = { type: string; props: { style: Record<string, unknown>; children?: Node | string | (Node | string)[] } }

// Satori takes a list as several children, which a block of text may not have, so a lone child goes in alone.
function box(style: Record<string, unknown>, ...children: (Node | string)[]): Node {
  const [onlyChild] = children
  return { type: 'div', props: { style: { display: 'flex', ...style }, children: children.length === 1 && onlyChild !== undefined ? onlyChild : children } }
}

// Workers refuse to compile WebAssembly from bytes at run time, so both engines start from modules bundled with the Worker.
let enginesReady: Promise<void> | null = null
function readyEngines(): Promise<void> {
  enginesReady ??= Promise.all([initSatori(yogaWasm), initWasm(resvgWasm)]).then(
    () => undefined,
    error => {
      enginesReady = null
      throw error
    },
  )
  return enginesReady
}

/**
 * Draws cards with Satori (layout to SVG) and resvg (SVG to PNG). Fonts come from Google Fonts cut down to the
 * characters on the card, a few kilobytes instead of the 10 MB a full Chinese font weighs. The bottom-left corner
 * stays empty because X lays the site's name over it.
 */
export class SatoriCardRenderer implements CardRenderer {
  async render(drawing: CardDrawing): Promise<Uint8Array> {
    await readyEngines()
    const { element, fonts } = drawing.kind === 'article' ? await SatoriCardRenderer.#article(drawing) : await SatoriCardRenderer.#profile(drawing)
    const svg = await satori(element as unknown as Parameters<typeof satori>[0], { width: WIDTH, height: HEIGHT, fonts, loadAdditionalAsset: SatoriCardRenderer.#emoji })
    return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng()
  }

  static async #article(drawing: Extract<CardDrawing, { kind: 'article' }>) {
    const palette = PALETTES[drawing.template]
    const titleSize = SatoriCardRenderer.#titleSize(drawing.title)
    const titleLines = SatoriCardRenderer.#lineCount(drawing.title, titleSize)
    const footer = `${drawing.author} · ${drawing.date}`
    const version = `v${drawing.version}`
    const fonts = await SatoriCardRenderer.#fonts(palette.titleFamily, drawing.title, `${BRAND}${drawing.summary ?? ''}${footer}${version}`)
    const element = SatoriCardRenderer.#frame(palette, [
      SatoriCardRenderer.#brand(palette, BRAND),
      box({ marginTop: 36, fontFamily: 'Title', fontWeight: 700, fontSize: titleSize, lineHeight: TITLE_LINE_HEIGHT, letterSpacing: -0.5, color: palette.ink, display: 'block', lineClamp: MAX_TITLE_LINES }, drawing.title),
      ...(drawing.summary
        ? [box({ marginTop: 26, fontFamily: 'Body', fontSize: 28, lineHeight: 1.5, color: palette.soft, display: 'block', lineClamp: titleLines >= MAX_TITLE_LINES ? 1 : 2 }, drawing.summary)]
        : []),
      box({ flexGrow: 1 }),
      box(
        { justifyContent: 'flex-end', alignItems: 'center', gap: 18, fontFamily: 'Body', fontSize: 24, color: palette.faint },
        footer,
        box({ padding: '2px 12px', border: `2px solid ${palette.faint}`, borderRadius: 6, fontSize: 22, color: palette.soft }, version),
      ),
    ])
    return { element, fonts }
  }

  static async #profile(drawing: Extract<CardDrawing, { kind: 'profile' }>) {
    const palette = PALETTES.paper
    const label = `${BRAND} · @${drawing.handle}`
    const fonts = await SatoriCardRenderer.#fonts(palette.titleFamily, drawing.name, `${label}${drawing.titles.join('')}—`)
    const element = SatoriCardRenderer.#frame(palette, [
      SatoriCardRenderer.#brand(palette, label),
      box({ marginTop: 34, fontFamily: 'Title', fontWeight: 700, fontSize: SatoriCardRenderer.#titleSize(drawing.name), lineHeight: TITLE_LINE_HEIGHT, color: palette.ink, display: 'block', lineClamp: 1 }, drawing.name),
      box(
        { flexDirection: 'column', gap: 14, marginTop: 34 },
        ...drawing.titles.map(title =>
          box(
            { fontFamily: 'Body', fontSize: 32, lineHeight: 1.35, color: palette.soft },
            box({ flexShrink: 0, width: 44, color: palette.bar }, '—'),
            box({ display: 'block', lineClamp: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }, title),
          ),
        ),
      ),
    ])
    return { element, fonts }
  }

  static #frame(palette: Palette, children: Node[]): Node {
    return box(
      { width: '100%', height: '100%', position: 'relative', flexDirection: 'column', background: palette.background, padding: `${PADDING.top}px ${PADDING.right}px ${PADDING.bottom}px ${PADDING.left}px` },
      box({ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, background: palette.bar }),
      ...children,
    )
  }

  static #brand(palette: Palette, text: string): Node {
    return box({ fontFamily: 'Body', fontSize: 22, letterSpacing: 5, color: palette.faint }, text)
  }

  /** The largest size at which the title fits in three lines; past the smallest, the third line ends in “…”. */
  static #titleSize(title: string): number {
    return TITLE_SIZES.find(size => SatoriCardRenderer.#lineCount(title, size) <= MAX_TITLE_LINES) ?? TITLE_SIZES[TITLE_SIZES.length - 1]!
  }

  // Close enough to choose a size: Han and other wide characters take a full em, Latin letters about half of one,
  // and wrapping at word ends wastes a little of each line.
  static #lineCount(text: string, size: number): number {
    let ems = 0
    for (const character of text) {
      if (SatoriCardRenderer.#isWide(character)) ems += 1
      else if (/[A-Z]/.test(character)) ems += 0.68
      else if (character === ' ') ems += 0.28
      else ems += 0.56
    }
    return Math.ceil((ems * size * 1.06) / TEXT_WIDTH)
  }

  static #isWide(character: string): boolean {
    const codePoint = character.codePointAt(0) ?? 0
    return WIDE_SCRIPT.test(character) || FULL_WIDTH_RANGES.some(([first, last]) => codePoint >= first! && codePoint <= last!)
  }

  // Noto has no emoji, so each one is drawn from Twemoji's pictures; anything else missing is left out.
  static async #emoji(languageCode: string, segment: string): Promise<string | Font[]> {
    if (languageCode !== 'emoji') return []
    const withoutSelectors = segment.includes(ZERO_WIDTH_JOINER) ? segment : segment.replace(VARIATION_SELECTOR, '')
    const codePoints = [...withoutSelectors].map(character => character.codePointAt(0)?.toString(16)).join('-')
    const response = await fetch(`${TWEMOJI_SVG}/${codePoints}.svg`)
    if (!response.ok) return []
    return `data:image/svg+xml;base64,${btoa(await response.text())}`
  }

  // Both fonts are asked for at once; each holds only the characters it draws.
  static async #fonts(titleFamily: Palette['titleFamily'], titleText: string, bodyText: string): Promise<Font[]> {
    const [titleFont, bodyFont] = await Promise.all([SatoriCardRenderer.#googleFont(titleFamily, 700, titleText), SatoriCardRenderer.#googleFont('Noto Sans SC', 400, bodyText)])
    return [
      { name: 'Title', data: titleFont, weight: 700, style: 'normal' },
      { name: 'Body', data: bodyFont, weight: 400, style: 'normal' },
    ]
  }

  // Asked without a browser's User-Agent, Google Fonts links TrueType, which Satori reads; browsers get WOFF2, which it cannot.
  static async #googleFont(family: string, weight: 400 | 700, text: string): Promise<ArrayBuffer> {
    const query = new URLSearchParams({ family: `${family}:wght@${weight}`, text: [...new Set(text + ELLIPSIS)].join('') })
    const cssResponse = await fetch(`${GOOGLE_FONTS_CSS}?${query}`)
    if (!cssResponse.ok) throw new Error(`Google Fonts answered ${cssResponse.status} for ${family} ${weight}`)
    const fontUrl = /src:\s*url\((.+?)\)\s*format\('(?:truetype|opentype)'\)/.exec(await cssResponse.text())?.[1]
    if (!fontUrl) throw new Error(`Google Fonts linked no TrueType file for ${family} ${weight}`)
    const fontResponse = await fetch(fontUrl)
    if (!fontResponse.ok) throw new Error(`Google Fonts answered ${fontResponse.status} for the ${family} ${weight} file`)
    return fontResponse.arrayBuffer()
  }
}
