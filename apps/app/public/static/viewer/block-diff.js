/**
 * What changed between two versions of a page, block by block in document order. A block is { path, tag, text }
 * as the artifact frame reports it. A longest common subsequence keeps the blocks that stayed the same; between two
 * kept blocks, a removed and an added block of the same tag are one changed block. Version comparison and the
 * agent's fix both read changes through this one rule.
 *
 * The result is { changed: [{ path, before, after }], added: [path], removed: [{ afterPath, text }] }; paths are in
 * the newer version, and a removed block is placed after the block that now precedes it.
 */
const MAX_ALIGNED_CELLS = 4_000_000

export class BlockDiff {
  static between(before, after) {
    const commonStart = BlockDiff.#commonStartLength(before, after)
    const commonEnd = BlockDiff.#commonEndLength(before, after, commonStart)
    const beforeMiddle = before.slice(commonStart, before.length - commonEnd)
    const afterMiddle = after.slice(commonStart, after.length - commonEnd)
    const diff = { changed: [], added: [], removed: [] }
    const gap = { removed: [], added: [], lastKeptPath: commonStart > 0 ? after[commonStart - 1].path : null }
    for (const step of BlockDiff.#editSteps(beforeMiddle, afterMiddle)) {
      if (step.kind === 'kept') {
        BlockDiff.#closeGap(gap, diff)
        gap.lastKeptPath = step.block.path
      } else gap[step.kind].push(step.block)
    }
    BlockDiff.#closeGap(gap, diff)
    diff.added = BlockDiff.#wholeRowsOf(diff.added, after)
    return diff
  }

  /** The blocks to flash after an agent's fix: what changed and what is new. */
  static changedPaths(diff) {
    return [...diff.changed.map(change => change.path), ...diff.added]
  }

  static isEmpty(diff) {
    return diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0
  }

  /** Every place that changed, once each, in the order they appear on the newer page: what 上一处 and 下一处 walk. */
  static stepsOf(diff, afterBlocks) {
    const paths = [...BlockDiff.changedPaths(diff), ...diff.removed.map(removal => removal.afterPath).filter(path => path !== null)]
    const pageOrder = path => afterBlocks.findIndex(block => block.path === path || block.path.startsWith(`${path} > `))
    return [...new Set(paths)].sort((first, second) => pageOrder(first) - pageOrder(second))
  }

  static #same(first, second) {
    return first.tag === second.tag && first.text === second.text
  }

  // Most edits touch a few blocks, so the unchanged start and end are set aside before the quadratic part.
  static #commonStartLength(before, after) {
    let length = 0
    while (length < before.length && length < after.length && BlockDiff.#same(before[length], after[length])) length++
    return length
  }

  static #commonEndLength(before, after, commonStart) {
    let length = 0
    const fitsBefore = () => before.length - length > commonStart
    const fitsAfter = () => after.length - length > commonStart
    while (fitsBefore() && fitsAfter() && BlockDiff.#same(before[before.length - 1 - length], after[after.length - 1 - length])) length++
    return length
  }

  // Past a few million cells the table would not fit in memory; the edited stretch then reads as replaced as a whole.
  static #editSteps(before, after) {
    const tooLargeToAlign = before.length * after.length > MAX_ALIGNED_CELLS
    if (tooLargeToAlign) return [...before.map(block => ({ kind: 'removed', block })), ...after.map(block => ({ kind: 'added', block }))]
    const lengths = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
    for (let i = before.length - 1; i >= 0; i--) {
      for (let j = after.length - 1; j >= 0; j--) {
        lengths[i][j] = BlockDiff.#same(before[i], after[j]) ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
      }
    }
    const steps = []
    let i = 0
    let j = 0
    while (i < before.length || j < after.length) {
      const bothLeft = i < before.length && j < after.length
      const addingKeepsMore = j < after.length && (i === before.length || lengths[i][j + 1] >= lengths[i + 1][j])
      if (bothLeft && BlockDiff.#same(before[i], after[j])) {
        steps.push({ kind: 'kept', block: after[j] })
        i++
        j++
      } else if (addingKeepsMore) steps.push({ kind: 'added', block: after[j++] })
      else steps.push({ kind: 'removed', block: before[i++] })
    }
    return steps
  }

  static #closeGap(gap, diff) {
    for (const block of gap.added) {
      const partnerIndex = gap.removed.findIndex(candidate => candidate.tag === block.tag)
      if (partnerIndex < 0) diff.added.push(block.path)
      else diff.changed.push({ path: block.path, before: gap.removed.splice(partnerIndex, 1)[0].text, after: block.text })
    }
    const afterPath = gap.added.at(-1)?.path ?? gap.lastKeptPath
    for (const block of gap.removed) diff.removed.push({ afterPath, text: block.text })
    gap.removed = []
    gap.added = []
  }

  // A table row whose every cell is new reads as one added row, not as one added cell after another.
  static #wholeRowsOf(addedPaths, afterBlocks) {
    const added = new Set(addedPaths)
    const rowOf = path => {
      const steps = path.split(' > ')
      return steps.at(-2)?.startsWith('tr:') ? steps.slice(0, -1).join(' > ') : null
    }
    const isWholeNewRow = row => afterBlocks.filter(block => block.path.startsWith(`${row} > `)).every(cell => added.has(cell.path))
    const merged = addedPaths.map(path => {
      const row = rowOf(path)
      return row && isWholeNewRow(row) ? row : path
    })
    return [...new Set(merged)]
  }
}
