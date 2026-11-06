// Business code reaches D1 and R2 only through repositories, so a Postgres + S3 adapter can replace
// packages/storage-cloudflare without touching it. Binding types may appear in each Worker's env.ts,
// and test fixtures may seed storage directly.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const repositoryRoot = new URL('..', import.meta.url).pathname
const scannedDirectories = ['packages', 'apps']
const allowedPaths = [/^packages\/storage-cloudflare\//, /^apps\/[^/]+\/src\/env\.ts$/, /^(apps|packages)\/[^/]+\/test\//]
const storageApiPattern = /\b(D1Database|D1PreparedStatement|R2Bucket|R2Object)\b|\.prepare\(/

function sourceFilesUnder(directory) {
  return readdirSync(directory).flatMap(entry => {
    if (entry === 'node_modules' || entry.startsWith('.')) return []
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) return sourceFilesUnder(entryPath)
    return entryPath.endsWith('.ts') ? [entryPath] : []
  })
}

const violations = scannedDirectories
  .flatMap(directory => sourceFilesUnder(join(repositoryRoot, directory)))
  .map(filePath => relative(repositoryRoot, filePath))
  .filter(filePath => !allowedPaths.some(allowedPath => allowedPath.test(filePath)))
  .filter(filePath => storageApiPattern.test(readFileSync(join(repositoryRoot, filePath), 'utf8')))

if (violations.length > 0) {
  console.error('D1 / R2 used outside the repository layer:\n' + violations.map(filePath => `  ${filePath}`).join('\n'))
  process.exit(1)
}
console.log('Storage boundary holds: D1 and R2 are only used in packages/storage-cloudflare.')
