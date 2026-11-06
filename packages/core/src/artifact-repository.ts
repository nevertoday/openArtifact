import type { ArtifactRemoval } from './artifact-removal.ts'

export interface ArtifactFile {
  path: string
  contentType: string
  body: Uint8Array
}

export type ArtifactVisibility = 'private' | 'specified' | 'workspace' | 'public_link'

export interface ArtifactSharing {
  visibility: ArtifactVisibility
  publicLinkExpiresAt: number | null
  publicLinkPasswordHash: string | null
  anonymousWriteEnabled: boolean
}

/** One complete set of files and who published it; `publishedVia` names the agent client, null for the web page. */
export interface Publication {
  authorId: string
  publishedVia: string | null
  files: ArtifactFile[]
}

export interface NewArtifact extends Publication {
  workspaceId: string
  title: string
  visibility: ArtifactVisibility
}

export interface CreatedArtifact {
  artifactId: string
  version: number
}

export interface ArtifactSummary {
  artifactId: string
  workspaceId: string
  title: string
  authorId: string
  sharing: ArtifactSharing
  version: number
  publishedVia: string | null
  updatedAt: number
  /** null while the artifact is active. */
  removal: ArtifactRemoval | null
}

export interface ArtifactVersionRecord {
  version: number
  authorId: string
  publishedVia: string | null
  createdAt: number
}

export interface ArtifactVersionContent {
  artifactId: string
  version: number
  files: ArtifactFile[]
}

export type PublishResult =
  | { status: 'published'; version: number }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not_found' }

/**
 * Reads one file of a published version; all the usercontent Worker needs from storage. A published
 * version never changes, so callers may cache what it returns. A removed artifact has no files to read.
 */
export interface ArtifactFileSource {
  readVersionFile(artifactId: string, version: number, path: string): Promise<ArtifactFile | null>
}

export interface ArtifactRepository extends ArtifactFileSource {
  create(newArtifact: NewArtifact): Promise<CreatedArtifact>
  /** Publishes only while the artifact is still at `baseVersion`; a concurrent publish turns this into a conflict. */
  publishOnTopOf(artifactId: string, baseVersion: number, publication: Publication): Promise<PublishResult>
  readCurrentVersion(artifactId: string): Promise<ArtifactVersionContent | null>
  readVersion(artifactId: string, version: number): Promise<ArtifactVersionContent | null>
  /** Finds removed artifacts too; access rules decide who may still act on them. */
  findSummary(artifactId: string): Promise<ArtifactSummary | null>
  /** Every artifact of the workspace, removed ones included, most recently updated first. */
  listRecentlyUpdated(workspaceId: string): Promise<ArtifactSummary[]>
  listVersions(artifactId: string): Promise<ArtifactVersionRecord[]>
  rename(artifactId: string, title: string): Promise<void>
  /** Returns false when the artifact is missing or already removed. */
  remove(artifactId: string, removal: ArtifactRemoval): Promise<boolean>
  /** Returns false when the artifact is missing or not removed. */
  restore(artifactId: string): Promise<boolean>
  /**
   * Deletes the artifacts removed at or before `cutoff` with their versions, files, comments, grants and
   * shared data. Safe to run again after a crash part way through.
   */
  purgeRemovedBefore(cutoff: number): Promise<void>
}
