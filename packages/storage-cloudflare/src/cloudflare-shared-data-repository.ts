import type { SharedCollection, SharedDataBudget, SharedDataBudgets, SharedDataRepository, SharedDocument, SharedDocumentWrite } from '@open-artifact/core'

const DOCUMENT_COLUMNS = 'collection, id, data, created_by, updated_by, created_at, updated_at'

// What a write adds, the document it replaces taken off, and the counters it would add to (kept by the triggers of
// migration 0022). Parameters: ?1 artifact, ?2 collection, ?3 document id, ?4 data.
const WRITE_CHANGE = `WITH change AS (
  SELECT length(CAST(?4 AS BLOB)) - COALESCE(replaced.size_bytes, 0) AS added_bytes, replaced.id IS NULL AS added_documents
  FROM (SELECT 1) LEFT JOIN shared_documents AS replaced ON replaced.artifact_id = ?1 AND replaced.collection = ?2 AND replaced.id = ?3
)`
const BUDGET_ROWS = `FROM change, deployment_shared_usage, artifacts
  LEFT JOIN artifact_shared_usage ON artifact_shared_usage.artifact_id = artifacts.id
  LEFT JOIN workspace_shared_usage ON workspace_shared_usage.workspace_id = artifacts.workspace_id
  WHERE artifacts.id = ?1`
// Parameters: ?7 to ?10, the budgets in the order of SharedDataBudgets.
const WITHIN: Record<SharedDataBudget, string> = {
  artifact: `COALESCE(artifact_shared_usage.documents, 0) + change.added_documents <= ?7 AND COALESCE(artifact_shared_usage.bytes, 0) + change.added_bytes <= ?8`,
  workspace: 'COALESCE(workspace_shared_usage.bytes, 0) + change.added_bytes <= ?9',
  deployment: 'deployment_shared_usage.bytes + change.added_bytes <= ?10',
}

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

  // The budgets are checked in the statement that writes, against counters its own triggers update, so concurrent
  // writes cannot together go past them. Only a refusal reads them again, to say which budget refused.
  async putDocument(artifactId: string, collection: string, documentId: string, data: unknown, actorId: string | null, budgets: SharedDataBudgets): Promise<SharedDocumentWrite> {
    const bindings = [artifactId, collection, documentId, JSON.stringify(data), actorId, Date.now(), budgets.artifactDocuments, budgets.artifactBytes, budgets.workspaceBytes, budgets.deploymentBytes]
    const documentRow = await this.#db
      .prepare(
        `${WRITE_CHANGE}
         INSERT INTO shared_documents (artifact_id, collection, id, data, created_by, updated_by, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6 ${BUDGET_ROWS} AND ${WITHIN.artifact} AND ${WITHIN.workspace} AND ${WITHIN.deployment}
         ON CONFLICT (artifact_id, collection, id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at
         RETURNING ${DOCUMENT_COLUMNS}`,
      )
      .bind(...bindings)
      .first<DocumentRow>()
    if (documentRow) return { status: 'saved', document: CloudflareSharedDataRepository.#documentOf(documentRow) }
    const fitRow = await this.#db
      .prepare(`${WRITE_CHANGE} SELECT ${WITHIN.artifact} AS artifact, ${WITHIN.workspace} AS workspace, ${WITHIN.deployment} AS deployment ${BUDGET_ROWS}`)
      .bind(...bindings)
      .first<Record<SharedDataBudget, number>>()
    if (!fitRow) return { status: 'not_found' }
    const budget = (['artifact', 'workspace', 'deployment'] as const).find(candidate => !fitRow[candidate]) ?? 'artifact'
    return { status: 'over_budget', budget }
  }

  async deleteDocument(artifactId: string, collection: string, documentId: string): Promise<boolean> {
    // RETURNING, since the changes D1 reports count the rows the counting triggers change too.
    const deleted = await this.#db
      .prepare('DELETE FROM shared_documents WHERE artifact_id = ? AND collection = ? AND id = ? RETURNING id')
      .bind(artifactId, collection, documentId)
      .first<string>('id')
    return deleted !== null
  }

  async workspaceBytes(workspaceId: string): Promise<number> {
    return (await this.#db.prepare('SELECT bytes FROM workspace_shared_usage WHERE workspace_id = ?').bind(workspaceId).first<number>('bytes')) ?? 0
  }

  async deploymentBytes(): Promise<number> {
    return (await this.#db.prepare('SELECT bytes FROM deployment_shared_usage WHERE id = 1').first<number>('bytes')) ?? 0
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
