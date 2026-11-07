import type { ArtifactFile } from '@open-artifact/core'

const ENTRY_PAGE = 'index.html'
const MIN_PARAGRAPH_LENGTH = 20
const MAX_EXCERPT_LENGTH = 160
// Words in these are controls, chrome or pictures, not what the page says.
const NOT_PROSE = 'nav, header, footer, aside, button, form, svg, figure, template, noscript, dialog, [hidden], [aria-hidden="true"], [role]'

/**
 * The opening words of a page for the author's personal page: the page's own description when it has one,
 * otherwise its first real paragraph, preferring the main content to whatever comes before it.
 */
export class PageExcerpt {
  #description: string | null = null
  #firstInMain: string | null = null
  #firstAnywhere: string | null = null
  #proseBlockers = 0
  #mainDepth = 0

  static async of(files: ArtifactFile[]): Promise<string | null> {
    const entryPage = files.find(file => file.path === ENTRY_PAGE)
    if (!entryPage) return null
    const pageExcerpt = new PageExcerpt()
    await pageExcerpt.#read(entryPage.body)
    const opening = pageExcerpt.#description ?? pageExcerpt.#firstInMain ?? pageExcerpt.#firstAnywhere
    return opening === null ? null : PageExcerpt.#clip(opening)
  }

  async #read(page: Uint8Array): Promise<void> {
    await new HTMLRewriter()
      .on('meta[name="description" i]', { element: meta => this.#takeDescription(meta.getAttribute('content')) })
      .on(NOT_PROSE, { element: blocker => this.#countWhileOpen(blocker, 'blocker') })
      .on('main, article', { element: main => this.#countWhileOpen(main, 'main') })
      .on('p', { element: paragraph => this.#readParagraph(paragraph), text: chunk => this.#readParagraphText(chunk) })
      .transform(new Response(page))
      .arrayBuffer()
  }

  #takeDescription(content: string | null) {
    const description = PageExcerpt.#collapse(content ?? '')
    if (description.length > 0) this.#description ??= description
  }

  #countWhileOpen(element: Element, region: 'blocker' | 'main') {
    const change = (step: number) => (region === 'blocker' ? (this.#proseBlockers += step) : (this.#mainDepth += step))
    change(1)
    element.onEndTag(() => void change(-1))
  }

  #openParagraph: { text: string; inMain: boolean } | null = null

  #readParagraph(paragraph: Element) {
    if (this.#proseBlockers > 0) return
    const openParagraph = { text: '', inMain: this.#mainDepth > 0 }
    this.#openParagraph = openParagraph
    paragraph.onEndTag(() => {
      this.#openParagraph = null
      this.#takeParagraph(PageExcerpt.#collapse(openParagraph.text), openParagraph.inMain)
    })
  }

  // The paragraph's words arrive in chunks, those of its links and emphasis included.
  #readParagraphText(chunk: Text) {
    if (this.#openParagraph) this.#openParagraph.text += chunk.text
  }

  #takeParagraph(text: string, inMain: boolean) {
    if (text.length < MIN_PARAGRAPH_LENGTH) return
    if (inMain) this.#firstInMain ??= text
    this.#firstAnywhere ??= text
  }

  static #collapse(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  // Ends at a sentence when one ends late enough, so the excerpt does not stop mid-thought.
  static #clip(text: string): string {
    if (text.length <= MAX_EXCERPT_LENGTH) return text
    const head = text.slice(0, MAX_EXCERPT_LENGTH)
    const sentenceEnd = Math.max(...['。', '！', '？', '. ', '! ', '? '].map(mark => head.lastIndexOf(mark)))
    return sentenceEnd >= MAX_EXCERPT_LENGTH / 2 ? head.slice(0, sentenceEnd + 1).trim() : `${head.trimEnd()}…`
  }
}
