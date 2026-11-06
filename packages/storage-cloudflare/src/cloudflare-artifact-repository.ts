import {
  ArtifactRemoval,
  type ArtifactFile,
  type ArtifactRepository,
  type ArtifactSummary,
  type ArtifactVersionContent,
  type ArtifactVersionRecord,
  type ArtifactVisibility,
  type CreatedArtifact,
  type NewArtifact,
  type Publication,
  type PublishResult,
} from '@open-artifact/core'

const SUMMARY_SELECT = `
  SELECT artifacts.id, artifacts.workspace_id, artifacts.title, artifacts.author_id, artifacts.visibility,
         artifacts.public_link_expires_at, artifacts.public_link_password_hash, artifacts.anonymous_write_enabled,
         artifacts.current_version, artifacts.updated_at, artifact_versions.published_via,
         artifacts.removed_at, artifacts.removed_by, artifacts.removed_as_admin
  FROM artifacts
  JOIN artifact_versions ON artifact_versions.artifact_id = artifacts.id AND artifact_versions.version = artifacts.current_version`

interface SummaryRow {
  id: string
  workspace_id: string
  title: string
  author_id: string
  visibility: ArtifactVisibility
  public_link_expires_at: number | null
  public_link_password_hash: string | null
  anonymous_write_enabled: number
  current_version: number
  updated_at: number
  published_via: string | null
  removed_at: number | null
  removed_by: string | null
  removed_as_admin: number | null
}

interface VersionRow {
  version: number
  upload_id: string
  author_id: string
  published_via: string | null
  created_at: number
}

interface FileRow {
  path: string
  content_type: string
}

/**
 * Files go to R2 under a fresh upload id before any row is written, and the D1 batch only points the
 * artifact at that upload once its version is claimed. A failed or rejected publish therefore never
 * leaves a version without files; at worst it leaves an unreferenced upload, which is deleted.
 */
export class CloudflareArtifactRepository implements ArtifactRepository {
  readonly #db: D1Database
  readonly #files: R2Bucket

  constructor(db: D1Database, files: R2Bucket) {
    this.#db = db
    this.#files = files
  }

  async create(newArtifact: NewArtifact): Promise<CreatedArtifact> {
    const artifactId = crypto.randomUUID()
    const firstVersion = 1
    const createdAt = Date.now()
    await this.#writeVersion(artifactId, newArtifact.files, uploadId => [
      this.#db
        .prepare(
          `INSERT INTO artifacts (id, workspace_id, author_id, title, visibility, current_version, current_upload_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(artifactId, newArtifact.workspaceId, newArtifact.authorId, newArtifact.title, newArtifact.visibility, firstVersion, uploadId, createdAt, createdAt),
      ...this.#recordVersionStatements(artifactId, firstVersion, uploadId, newArtifact, createdAt),
    ])
    return { artifactId, version: firstVersion }
  }

  async publishOnTopOf(artifactId: string, baseVersion: number, publication: Publication): Promise<PublishResult> {
    const nextVersion = baseVersion + 1
    const publishedAt = Date.now()
    const { batchResults, uploadId } = await this.#writeVersion(artifactId, publication.files, uploadId => [
      this.#db
        .prepare('UPDATE artifacts SET current_version = ?, current_upload_id = ?, updated_at = ? WHERE id = ? AND current_version = ?')
        .bind(nextVersion, uploadId, publishedAt, artifactId, baseVersion),
      ...this.#recordVersionStatements(artifactId, nextVersion, uploadId, publication, publishedAt),
    ])
    const versionAdvance = batchResults[0]
    const claimedNextVersion = versionAdvance?.meta.changes === 1
    if (claimedNextVersion) return { status: 'published', version: nextVersion }
    await this.#discardUpload(artifactId, uploadId, publication.files)
    return this.#rejectionFor(artifactId)
  }

  async readCurrentVersion(artifactId: string): Promise<ArtifactVersionContent | null> {
    const currentVersion = await this.#db.prepare('SELECT current_version FROM artifacts WHERE id = ?').bind(artifactId).first<number>('current_version')
    if (currentVersion === null) return null
    return this.readVersion(artifactId, currentVersion)
  }

  async readVersion(artifactId: string, version: number): Promise<ArtifactVersionContent | null> {
    const versionRow = await this.#versionRow(artifactId, version)
    if (!versionRow) return null
    const { results: fileRows } = await this.#db
      .prepare('SELECT path, content_type FROM artifact_files WHERE artifact_id = ? AND upload_id = ? ORDER BY path')
      .bind(artifactId, versionRow.upload_id)
      .all<FileRow>()
    const files = await Promise.all(fileRows.map(fileRow => this.#downloadFile(artifactId, versionRow.upload_id, fileRow)))
    return { artifactId, version, files }
  }

  async readVersionFile(artifactId: string, version: number, path: string): Promise<ArtifactFile | null> {
    const versionFile = await this.#db
      .prepare(
        `SELECT artifact_files.upload_id, artifact_files.path, artifact_files.content_type
         FROM artifact_versions
         JOIN artifact_files ON artifact_files.artifact_id = artifact_versions.artifact_id AND artifact_files.upload_id = artifact_versions.upload_id
         WHERE artifact_versions.artifact_id = ? AND artifact_versions.version = ? AND artifact_files.path = ?`,
      )
      .bind(artifactId, version, path)
      .first<FileRow & { upload_id: string }>()
    if (!versionFile) return null
    return this.#downloadFile(artifactId, versionFile.upload_id, versionFile)
  }

  async findSummary(artifactId: string): Promise<ArtifactSummary | null> {
    const summaryRow = await this.#db.prepare(`${SUMMARY_SELECT} WHERE artifacts.id = ?`).bind(artifactId).first<SummaryRow>()
    return summaryRow ? CloudflareArtifactRepository.#summaryOf(summaryRow) : null
  }

  async listRecentlyUpdated(workspaceId: string): Promise<ArtifactSummary[]> {
    const { results: summaryRows } = await this.#db
      .prepare(`${SUMMARY_SELECT} WHERE artifacts.workspace_id = ? ORDER BY artifacts.updated_at DESC`)
      .bind(workspaceId)
      .all<SummaryRow>()
    return summaryRows.map(summaryRow => CloudflareArtifactRepository.#summaryOf(summaryRow))
  }

  async listVersions(artifactId: string): Promise<ArtifactVersionRecord[]> {
    const { results: versionRows } = await this.#db
      .prepare('SELECT version, upload_id, author_id, published_via, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC')
      .bind(artifactId)
      .all<VersionRow>()
    return versionRows.map(versionRow => ({
      version: versionRow.version,
      authorId: versionRow.author_id,
      publishedVia: versionRow.published_via,
      createdAt: versionRow.created_at,
    }))
  }

  async rename(artifactId: string, title: string): Promise<void> {
    await this.#db.prepare('UPDATE artifacts SET title = ? WHERE id = ?').bind(title, artifactId).run()
  }

  async remove(artifactId: string, removal: ArtifactRemoval): Promise<boolean> {
    const removalUpdate = await this.#db
      .prepare('UPDATE artifacts SET removed_at = ?, removed_by = ?, removed_as_admin = ? WHERE id = ? AND removed_at IS NULL')
      .bind(removal.removedAt, removal.removedBy, removal.removedAsAdmin ? 1 : 0, artifactId)
      .run()
    return removalUpdate.meta.changes === 1
  }

  async restore(artifactId: string): Promise<boolean> {
    const restoreUpdate = await this.#db
      .prepare('UPDATE artifacts SET removed_at = NULL, removed_by = NULL, removed_as_admin = NULL WHERE id = ? AND removed_at IS NOT NULL')
      .bind(artifactId)
      .run()
    return restoreUpdate.meta.changes === 1
  }

  async #versionRow(artifactId: string, version: number): Promise<VersionRow | null> {
    return this.#db
      .prepare('SELECT version, upload_id, author_id, published_via, created_at FROM artifact_versions WHERE artifact_id = ? AND version = ?')
      .bind(artifactId, version)
      .first<VersionRow>()
  }

  async #writeVersion(
    artifactId: string,
    files: ArtifactFile[],
    statementsFor: (uploadId: string) => D1PreparedStatement[],
  ): Promise<{ batchResults: D1Result[]; uploadId: string }> {
    const uploadId = crypto.randomUUID()
    await this.#uploadFiles(artifactId, uploadId, files)
    try {
      const batchResults = await this.#db.batch(statementsFor(uploadId))
      return { batchResults, uploadId }
    } catch (error) {
      await this.#discardUpload(artifactId, uploadId, files)
      throw new Error(`Artifact ${artifactId} version could not be saved`, { cause: error })
    }
  }

  // The version and file rows are written only if this upload is the one the artifact now points at,
  // so a publish that lost the race writes nothing.
  #recordVersionStatements(artifactId: string, version: number, uploadId: string, publication: Publication, createdAt: number): D1PreparedStatement[] {
    const versionRow = this.#db
      .prepare(
        `INSERT INTO artifact_versions (artifact_id, version, upload_id, author_id, published_via, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM artifacts WHERE id = ? AND current_upload_id = ?)`,
      )
      .bind(artifactId, version, uploadId, publication.authorId, publication.publishedVia, createdAt, artifactId, uploadId)
    const fileRows = publication.files.map(file =>
      this.#db
        .prepare(
          `INSERT INTO artifact_files (artifact_id, upload_id, path, content_type, size_bytes)
           SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM artifact_versions WHERE artifact_id = ? AND upload_id = ?)`,
        )
        .bind(artifactId, uploadId, file.path, file.contentType, file.body.byteLength, artifactId, uploadId),
    )
    return [versionRow, ...fileRows]
  }

  async #rejectionFor(artifactId: string): Promise<PublishResult> {
    const currentVersion = await this.#db.prepare('SELECT current_version FROM artifacts WHERE id = ?').bind(artifactId).first<number>('current_version')
    if (currentVersion === null) return { status: 'not_found' }
    return { status: 'conflict', currentVersion }
  }

  async #uploadFiles(artifactId: string, uploadId: string, files: ArtifactFile[]): Promise<void> {
    await Promise.all(
      files.map(file =>
        this.#files.put(CloudflareArtifactRepository.#objectKey(artifactId, uploadId, file.path), file.body, {
          httpMetadata: { contentType: file.contentType },
        }),
      ),
    )
  }

  async #discardUpload(artifactId: string, uploadId: string, files: ArtifactFile[]): Promise<void> {
    await this.#files.delete(files.map(file => CloudflareArtifactRepository.#objectKey(artifactId, uploadId, file.path)))
  }

  async #downloadFile(artifactId: string, uploadId: string, fileRow: FileRow): Promise<ArtifactFile> {
    const storedObject = await this.#files.get(CloudflareArtifactRepository.#objectKey(artifactId, uploadId, fileRow.path))
    if (!storedObject) throw new Error(`Artifact ${artifactId} file ${fileRow.path} is missing from storage`)
    return { path: fileRow.path, contentType: fileRow.content_type, body: new Uint8Array(await storedObject.arrayBuffer()) }
  }

  static #summaryOf(summaryRow: SummaryRow): ArtifactSummary {
    return {
      artifactId: summaryRow.id,
      workspaceId: summaryRow.workspace_id,
      title: summaryRow.title,
      authorId: summaryRow.author_id,
      sharing: {
        visibility: summaryRow.visibility,
        publicLinkExpiresAt: summaryRow.public_link_expires_at,
        publicLinkPasswordHash: summaryRow.public_link_password_hash,
        anonymousWriteEnabled: summaryRow.anonymous_write_enabled === 1,
      },
      version: summaryRow.current_version,
      publishedVia: summaryRow.published_via,
      updatedAt: summaryRow.updated_at,
      removal: CloudflareArtifactRepository.#removalOf(summaryRow),
    }
  }

  static #removalOf(summaryRow: SummaryRow): ArtifactRemoval | null {
    if (summaryRow.removed_at === null || summaryRow.removed_by === null) return null
    return new ArtifactRemoval(summaryRow.removed_at, summaryRow.removed_by, summaryRow.removed_as_admin === 1)
  }

  static #objectKey(artifactId: string, uploadId: string, path: string): string {
    return `artifacts/${artifactId}/uploads/${uploadId}/${path}`
  }
}
