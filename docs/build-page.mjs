// Builds a page in which every <!--DIAGRAM:key|title--> marker becomes the full archify viewer in an iframe srcdoc,
// and copies each viewer next to the output so the 全屏打开 link can open it on its own.
// Usage: node docs/build-page.mjs <source.html> <diagrams.json> <output.html>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

class PageBuild {
  #sourcePath
  #diagramSources
  #outputPath

  constructor(sourcePath, diagramSourcesPath, outputPath) {
    this.#sourcePath = resolve(sourcePath)
    this.#diagramSources = JSON.parse(readFileSync(diagramSourcesPath, 'utf8'))
    this.#outputPath = resolve(outputPath)
  }

  run() {
    mkdirSync(join(dirname(this.#outputPath), 'diagrams'), { recursive: true })
    const template = readFileSync(this.#sourcePath, 'utf8')
    const page = template.replace(/<!--DIAGRAM:([\w-]+)\|([^>]+)-->/g, (_, key, title) => this.#diagramFigure(key, title))
    writeFileSync(this.#outputPath, page)
  }

  #diagramFigure(key, title) {
    const viewerPath = this.#diagramSources[key]
    if (!viewerPath) throw new Error(`No diagram source configured for "${key}"`)
    const standalonePath = `diagrams/${key}.html`
    copyFileSync(viewerPath, join(dirname(this.#outputPath), standalonePath))
    const viewerHtml = readFileSync(viewerPath, 'utf8')
    return `<figure class="diagram">
  <iframe title="${title}" srcdoc="${PageBuild.#escapeAttribute(viewerHtml)}"></iframe>
  <figcaption>${title}：拖动平移，滚轮缩放；工具栏可以切换主题、搜索、聚焦、导出 PNG / SVG。<a href="${standalonePath}" target="_blank" rel="noopener">全屏打开</a></figcaption>
</figure>`
  }

  static #escapeAttribute(html) {
    return html.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  }
}

const [sourcePath, diagramSourcesPath, outputPath] = process.argv.slice(2)
if (!sourcePath || !diagramSourcesPath || !outputPath) throw new Error('Usage: node docs/build-page.mjs <source.html> <diagrams.json> <output.html>')
new PageBuild(sourcePath, diagramSourcesPath, outputPath).run()
