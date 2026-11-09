export interface SharedDocument {
  collection: string
  documentId: string
  data: unknown
  createdBy: string | null
  updatedBy: string | null
  createdAt: number
  updatedAt: number
}

export interface SharedCollection {
  collection: string
  documentCount: number
}

/**
 * How much shared data may be kept, documents' JSON measured in UTF-8 bytes. Shared data lives in the database, apart
 * from artifact files, so it has budgets of its own: per artifact, per workspace and for the whole deployment.
 */
export interface SharedDataBudgets {
  artifactDocuments: number
  artifactBytes: number
  workspaceBytes: number
  deploymentBytes: number
}

/** Which budget a refused write would have gone over. */
export type SharedDataBudget = 'artifact' | 'workspace' | 'deployment'

export type SharedDocumentWrite =
  | { status: 'saved'; document: SharedDocument }
  | { status: 'over_budget'; budget: SharedDataBudget }
  | { status: 'not_found' }

/** Data an artifact's page keeps for its viewers, stored apart from page versions. */
export interface SharedDataRepository {
  listCollections(artifactId: string): Promise<SharedCollection[]>
  listDocuments(artifactId: string, collection: string): Promise<SharedDocument[]>
  /**
   * Creates the document or replaces its data; `actorId` is null for an anonymous visitor. Saves nothing when the
   * shared data would then go over one of `budgets`, the replaced document not counted, and says which. Concurrent
   * writes cannot together go past a budget.
   */
  putDocument(artifactId: string, collection: string, documentId: string, data: unknown, actorId: string | null, budgets: SharedDataBudgets): Promise<SharedDocumentWrite>
  deleteDocument(artifactId: string, collection: string, documentId: string): Promise<boolean>
  /** Bytes of shared data the workspace's artifacts keep, removed ones included until they are purged. */
  workspaceBytes(workspaceId: string): Promise<number>
  /** Bytes of shared data the whole deployment keeps. */
  deploymentBytes(): Promise<number>
}
