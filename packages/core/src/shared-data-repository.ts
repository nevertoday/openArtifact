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

/** Data an artifact's page keeps for its viewers, stored apart from page versions. */
export interface SharedDataRepository {
  listCollections(artifactId: string): Promise<SharedCollection[]>
  listDocuments(artifactId: string, collection: string): Promise<SharedDocument[]>
  /** Creates the document or replaces its data; `actorId` is null for an anonymous visitor. */
  putDocument(artifactId: string, collection: string, documentId: string, data: unknown, actorId: string | null): Promise<SharedDocument>
  deleteDocument(artifactId: string, collection: string, documentId: string): Promise<boolean>
}
