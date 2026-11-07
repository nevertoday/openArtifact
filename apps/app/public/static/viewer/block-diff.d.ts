export interface Block {
  path: string
  tag: string
  text: string
}

export interface BlockChanges {
  changed: { path: string; before: string; after: string }[]
  added: string[]
  removed: { afterPath: string | null; text: string }[]
}

export class BlockDiff {
  static between(before: Block[], after: Block[]): BlockChanges
  static changedPaths(diff: BlockChanges): string[]
  static isEmpty(diff: BlockChanges): boolean
  static stepsOf(diff: BlockChanges, afterBlocks: Block[]): string[]
}
