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
  /** Visitors of the public link may read the comments; otherwise they see the page alone. */
  publicLinkShowsComments: boolean
  /** The author put it on their personal page; it shows there only while anyone may open it without a password. */
  listed: boolean
}

/** How a version came to be: new files, or the files of an earlier version published again. */
export type VersionOrigin = { kind: 'published' } | { kind: 'restored'; restoredFrom: number }

/**
 * One complete set of files and who published it; `publishedVia` names the agent client, null for the web page.
 * `note` says in one sentence what changed, null when the publisher gave none.
 */
export interface Publication {
  authorId: string
  publishedVia: string | null
  origin: VersionOrigin
  note: string | null
  /** The opening words of the entry page, for the author's personal page; null when the page has none. */
  excerpt: string | null
  files: ArtifactFile[]
}

/** The first version of an artifact is always published, never restored. */
export interface NewArtifact extends Omit<Publication, 'origin'> {
  workspaceId: string
  title: string
  /** Already normalized by ArtifactSlug; the repository gives the artifact its short id. */
  slug: string
  visibility: ArtifactVisibility
  /** null for a link that never expires; it matters only while the visibility is public_link. */
  publicLinkExpiresAt: number | null
  listed: boolean
  /** The publisher's own summary; null leaves it to the page's opening words. */
  summary: string | null
  /** Already checked to fit in a post on X with the link; null leaves the post to the title and summary. */
  shareText: string | null
}

export interface CreatedArtifact {
  artifactId: string
  shortId: string
  version: number
}

export interface ArtifactSummary {
  artifactId: string
  /** Names the artifact in its address; see ArtifactPath. */
  shortId: string
  /** Words in its address for people to read, possibly empty; never used to find the artifact. */
  slug: string
  workspaceId: string
  title: string
  authorId: string
  sharing: ArtifactSharing
  version: number
  publishedVia: string | null
  updatedAt: number
  /** null while the artifact is active. */
  removal: ArtifactRemoval | null
  /** What the author wrote it is about, or else the current version's opening words; null when neither exists. */
  summary: string | null
  /** The current version's note and when it was published. */
  currentVersionNote: string | null
  currentVersionAt: number
  /** What the author wrote to go before the link when it is shared on X; null leaves it to the title and summary. */
  shareText: string | null
}

export interface ArtifactVersionRecord {
  version: number
  authorId: string
  publishedVia: string | null
  origin: VersionOrigin
  note: string | null
  createdAt: number
}

export interface ArtifactVersionContent {
  artifactId: string
  version: number
  files: ArtifactFile[]
}

/** What a workspace holds, for the limits on what it may store. */
export interface WorkspaceUsage {
  /** Artifacts not removed. */
  activeArtifacts: number
  /** Every stored version's files, removed artifacts included until they are purged. */
  fileBytes: number
}

export type PublishResult =
  | { status: 'published'; version: number }
  /**
   * The artifact is no longer at the base version. `uploaded` says the publish stored its files before finding out,
   * as when another publish won a race; a publish on a stale version finds out before it stores anything.
   */
  | { status: 'conflict'; currentVersion: number; uploaded: boolean }
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
  /**
   * Publishes only while the artifact is still at `baseVersion`. A stale base version is refused before any file is
   * stored; a concurrent publish that wins in the meantime turns this into a conflict after the upload.
   */
  publishOnTopOf(artifactId: string, baseVersion: number, publication: Publication): Promise<PublishResult>
  readCurrentVersion(artifactId: string): Promise<ArtifactVersionContent | null>
  readVersion(artifactId: string, version: number): Promise<ArtifactVersionContent | null>
  /**
   * Finds removed artifacts too; access rules decide who may still act on them. Every read leaves out the artifacts
   * of a deleted workspace, files included.
   */
  findSummary(artifactId: string): Promise<ArtifactSummary | null>
  /** Like findSummary, by the short id in the artifact's address. */
  findSummaryByShortId(shortId: string): Promise<ArtifactSummary | null>
  /** Every artifact of the workspace, removed ones included, most recently updated first. */
  listRecentlyUpdated(workspaceId: string): Promise<ArtifactSummary[]>
  /** The active artifacts granted to the user one by one, in every workspace, most recently updated first. */
  listGrantedTo(userId: string): Promise<ArtifactSummary[]>
  /** The author's active artifacts they put on their personal page, in every workspace, most recently updated first. */
  listListedBy(authorId: string): Promise<ArtifactSummary[]>
  /** null goes back to the page's opening words. */
  setSummary(artifactId: string, summary: string | null): Promise<void>
  /** null goes back to the words made from the title and summary. */
  setShareText(artifactId: string, shareText: string | null): Promise<void>
  listVersions(artifactId: string): Promise<ArtifactVersionRecord[]>
  /** Changes the title and the words of the address together; the short id never changes. */
  rename(artifactId: string, name: { title: string; slug: string }): Promise<void>
  /** Returns false when the artifact is missing or already removed. */
  remove(artifactId: string, removal: ArtifactRemoval): Promise<boolean>
  /** Returns false when the artifact is missing or not removed. */
  restore(artifactId: string): Promise<boolean>
  /**
   * Deletes the artifacts removed at or before `cutoff`, and every artifact of a workspace deleted at or before it,
   * with their versions, files, comments, grants and shared data. Safe to run again after a crash part way through.
   * Purges at most `limit` artifacts; the next call takes the rest.
   */
  purgeRemovedBefore(cutoff: number, limit: number): Promise<void>
  /**
   * Purges one removed artifact now, as purgeRemovedBefore does once it is past restoring. It is made past restoring
   * as of `cutoff` first, so nobody can restore it meanwhile and a crash part way leaves it to the daily purge.
   * Returns false, and changes nothing, when the artifact is missing or not removed.
   */
  purgeRemovedNow(artifactId: string, cutoff: number): Promise<boolean>
  usageOf(workspaceId: string): Promise<WorkspaceUsage>
}
