import type { SharedCollection, SharedDataRepository, SharedDocument } from '@open-artifact/core'

const DOCUMENT_COLUMNS = 'collection, id, data, created_by, updated_by, created_at, updated_at'

interface DocumentRow {
  collection: string
  id: string
  data: string
  created_by: string | null
  updated_by: string | null
  created_at: number
  updated_at: number
}

export class CloudflareSharedDataRepository implements SharedDataRepository {
  readonly #db: D1Database

  constructor(db: D1Database) {
    this.#db = db
  }

  async listCollections(artifactId: string): Promise<SharedCollection[]> {
    const { results: collectionRows } = await this.#db
      .prepare('SELECT collection, COUNT(*) AS document_count FROM shared_documents WHERE artifact_id = ? GROUP BY collection ORDER BY collection')
      .bind(artifactId)
      .all<{ collection: string; document_count: number }>()
    return collectionRows.map(collectionRow => ({ collection: collectionRow.collection, documentCount: collectionRow.document_count }))
  }

  async listDocuments(artifactId: string, collection: string): Promise<SharedDocument[]> {
    const { results: documentRows } = await this.#db
      .prepare(`SELECT ${DOCUMENT_COLUMNS} FROM shared_documents WHERE artifact_id = ? AND collection = ? ORDER BY created_at, rowid`)
      .bind(artifactId, collection)
      .all<DocumentRow>()
    return documentRows.map(CloudflareSharedDataRepository.#documentOf)
  }

  async putDocument(artifactId: string, collection: string, documentId: string, data: unknown, actorId: string | null): Promise<SharedDocument> {
    const now = Date.now()
    const documentRow = await this.#db
      .prepare(
        `INSERT INTO shared_documents (artifact_id, collection, id, data, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (artifact_id, collection, id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at
         RETURNING ${DOCUMENT_COLUMNS}`,
      )
      .bind(artifactId, collection, documentId, JSON.stringify(data), actorId, actorId, now, now)
      .first<DocumentRow>()
    if (!documentRow) throw new Error(`Shared document ${collection}/${documentId} of artifact ${artifactId} was not saved`)
    return CloudflareSharedDataRepository.#documentOf(documentRow)
  }

  async deleteDocument(artifactId: string, collection: string, documentId: string): Promise<boolean> {
    const deletion = await this.#db
      .prepare('DELETE FROM shared_documents WHERE artifact_id = ? AND collection = ? AND id = ?')
      .bind(artifactId, collection, documentId)
      .run()
    return deletion.meta.changes === 1
  }

  static #documentOf(documentRow: DocumentRow): SharedDocument {
    return {
      collection: documentRow.collection,
      documentId: documentRow.id,
      data: JSON.parse(documentRow.data),
      createdBy: documentRow.created_by,
      updatedBy: documentRow.updated_by,
      createdAt: documentRow.created_at,
      updatedAt: documentRow.updated_at,
    }
  }
}
