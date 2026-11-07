// Interface text lives in the dictionaries under apps/app/public/static/i18n, so every language can word it.
// Chinese anywhere else in the source is text that one language would be stuck with. Comments may still quote
// Chinese, English meant for agents may gloss an interface label in Chinese, as in "Share (分享)", and code that
// reads people's own Chinese text (punctuation that ends a sentence) is listed by file.
// `--report` prints the count of offending lines per file and always exits 0, for tracking a migration.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const repositoryRoot = new URL('..', import.meta.url).pathname
const scannedDirectories = ['apps/app/src', 'apps/app/public/static', 'apps/usercontent/src', 'apps/mcp/src']
const skippedDirectories = new Set(['i18n', 'vendor', 'node_modules'])
const cjk = /[　-〿㐀-䶿一-鿿＀-￯]/

const glossedLabel = /(?<=[A-Za-z0-9`)] )\([\p{Script=Han}\u3000-\u303f\uff00-\uffef A-Za-z›]+\)/gu
const readsPeoplesText = new Map([['apps/app/src/api/page-excerpt.ts', /\['。', '！', '？'/]])

function sourceFilesUnder(directory) {
  return readdirSync(directory).flatMap(entry => {
    if (skippedDirectories.has(entry) || entry.startsWith('.')) return []
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) return sourceFilesUnder(entryPath)
    return /\.(ts|js)$/.test(entry) && !entry.endsWith('.d.ts') ? [entryPath] : []
  })
}

// Good enough for this source: block comments, and line comments that start a line or follow whitespace (so URLs survive).
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, '$1')
}

const offendingLines = scannedDirectories
  .flatMap(directory => sourceFilesUnder(join(repositoryRoot, directory)))
  .flatMap(filePath => {
    const lines = withoutComments(readFileSync(filePath, 'utf8')).split('\n')
    return lines
      .map((line, index) => ({ file: relative(repositoryRoot, filePath), line: index + 1, text: line.trim() }))
      .filter(({ file, text }) => cjk.test(text.replace(glossedLabel, '')) && !readsPeoplesText.get(file)?.test(text))
  })

if (process.argv.includes('--report')) {
  const counts = Map.groupBy(offendingLines, ({ file }) => file)
  for (const [file, lines] of [...counts].sort(([, left], [, right]) => right.length - left.length)) console.log(`${String(lines.length).padStart(4)}  ${file}`)
  console.log(`${String(offendingLines.length).padStart(4)}  total`)
} else if (offendingLines.length > 0) {
  console.error('Interface text outside the i18n dictionaries:\n' + offendingLines.map(({ file, line, text }) => `  ${file}:${line}  ${text.slice(0, 100)}`).join('\n'))
  process.exitCode = 1
}
