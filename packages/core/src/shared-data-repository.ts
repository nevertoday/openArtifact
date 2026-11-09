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

/** How much shared data one artifact may hold, its documents' JSON measured in UTF-8 bytes. */
export interface SharedDataCap {
  maxDocuments: number
  maxBytes: number
}

/** Data an artifact's page keeps for its viewers, stored apart from page versions. */
export interface SharedDataRepository {
  listCollections(artifactId: string): Promise<SharedCollection[]>
  listDocuments(artifactId: string, collection: string): Promise<SharedDocument[]>
  /**
   * Creates the document or replaces its data; `actorId` is null for an anonymous visitor. Returns null, and saves
   * nothing, when the artifact's documents would then be more than `cap` allows, the replaced document not counted.
   * Concurrent writes cannot together go past the cap.
   */
  putDocument(artifactId: string, collection: string, documentId: string, data: unknown, actorId: string | null, cap: SharedDataCap): Promise<SharedDocument | null>
  deleteDocument(artifactId: string, collection: string, documentId: string): Promise<boolean>
}
