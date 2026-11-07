import { Window, type ShadowRoot } from 'happy-dom'
import { ArtifactSdk } from '../../src/artifact-sdk.ts'

export const APP_ORIGIN = 'http://app.test'
const PAGE_URL = 'http://usercontent.test/s/signature/artifact-1/v1/index.html'
// happy-dom gives table cells no display and does not accept table-cell; a browser shows them as blocks of their own.
const BROWSER_DEFAULTS = 'td, th, caption { display: block }'

export interface FrameMessage {
  type: string
  [field: string]: unknown
}

/** An artifact page with the SDK injected, framed by a stand-in for the viewer page that records what the SDK tells it. */
export class FramedPage {
  readonly window: Window
  readonly sent: FrameMessage[] = []
  readonly #viewer = {
    postMessage: (message: FrameMessage, targetOrigin: string) => {
      if (targetOrigin === APP_ORIGIN) this.sent.push(message)
    },
  }

  constructor(body: string, pageUrl = PAGE_URL) {
    this.window = new Window({ url: pageUrl, settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
    Object.defineProperty(this.window, 'parent', { value: this.#viewer })
    this.window.document.write(`<!doctype html><html><head><style>${BROWSER_DEFAULTS}</style><script>${ArtifactSdk.script(APP_ORIGIN)}</script></head><body>${body}</body></html>`)
  }

  static async loaded(body: string, pageUrl?: string): Promise<FramedPage> {
    const page = new FramedPage(body, pageUrl)
    page.window.dispatchEvent(new page.window.Event('load'))
    await page.settle()
    return page
  }

  get document() {
    return this.window.document
  }

  async settle(milliseconds = 0): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, milliseconds))
    await this.window.happyDOM.waitUntilComplete()
  }

  /** A message from the viewer page; `origin` stands in for a window on another site. */
  async tell(name: string, fields: Record<string, unknown> = {}, origin = APP_ORIGIN): Promise<void> {
    this.window.dispatchEvent(new this.window.MessageEvent('message', { data: { type: `open-artifact:${name}`, ...fields }, origin, source: this.#viewer as never }))
    await this.settle()
  }

  messagesNamed(name: string): FrameMessage[] {
    return this.sent.filter(message => message.type === `open-artifact:${name}`)
  }

  lastMessageNamed(name: string): FrameMessage | undefined {
    return this.messagesNamed(name).at(-1)
  }

  get overlay(): ShadowRoot | null {
    const host = this.document.querySelector('div[data-open-artifact-ui="pins"]')
    return host?.shadowRoot ?? null
  }

  get marksOverlay(): ShadowRoot | null {
    const host = this.document.querySelector('div[data-open-artifact-ui="marks"]')
    return host?.shadowRoot ?? null
  }

  async click(selector: string): Promise<void> {
    const element = this.document.querySelector(selector)
    if (!element) throw new Error(`no element matches ${selector}`)
    element.dispatchEvent(new this.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await this.settle()
  }

  async press(key: string, options: { on?: string; metaKey?: boolean; repeat?: boolean } = {}): Promise<void> {
    const target = options.on ? this.document.querySelector(options.on) : this.document.body
    target?.dispatchEvent(new this.window.KeyboardEvent('keydown', { key, bubbles: true, metaKey: options.metaKey ?? false, repeat: options.repeat ?? false }))
    await this.settle()
  }

  close(): Promise<void> {
    return this.window.happyDOM.close()
  }
}
