import type { SharedDocument } from '@open-artifact/core'
import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const MAX_DOCUMENT_BYTES = 64 * 1024

/** The data an artifact's page keeps for its viewers, reached from the page through the viewer's postMessage proxy. */
export class SharedDataApi {
  readonly #context: ApiContext

  constructor(context: ApiContext) {
    this.#context = context
  }

  async listCollections(request: Request, artifactId: string): Promise<Response> {
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canBrowseSharedData', 'browse the data of this artifact')
    return Response.json({ collections: await this.#context.repositories.sharedData.listCollections(artifactId) })
  }

  async listDocuments(request: Request, artifactId: string, collection: string): Promise<Response> {
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canView', 'view this artifact')
    const sharedDocuments = await this.#context.repositories.sharedData.listDocuments(artifactId, SharedDataApi.#validName('collection', collection))
    const names = await this.#context.people.namesOf(sharedDocuments.flatMap(sharedDocument => [sharedDocument.createdBy, sharedDocument.updatedBy]))
    return Response.json({ documents: sharedDocuments.map(sharedDocument => SharedDataApi.#documentJson(sharedDocument, names)) })
  }

  async putDocument(request: Request, artifactId: string, collection: string, documentId: string): Promise<Response> {
    const identity = await this.#context.identity()
    await this.#context.gate.require(artifactId, identity, request, 'canWriteSharedData', 'change the data of this artifact')
    const requestBody = await JsonBody.of(request)
    const documentData = requestBody.raw('data')
    if (documentData === undefined) throw HttpError.badRequest('data is required')
    const documentBytes = new TextEncoder().encode(JSON.stringify(documentData)).byteLength
    if (documentBytes > MAX_DOCUMENT_BYTES) throw new HttpError(413, `a document must be at most ${MAX_DOCUMENT_BYTES / 1024} KB`)
    const savedDocument = await this.#context.repositories.sharedData.putDocument(
      artifactId,
      SharedDataApi.#validName('collection', collection),
      SharedDataApi.#validName('document id', documentId),
      documentData,
      identity?.userId ?? null,
    )
    const names = await this.#context.people.namesOf([savedDocument.createdBy, savedDocument.updatedBy])
    return Response.json({ document: SharedDataApi.#documentJson(savedDocument, names) })
  }

  async deleteDocument(request: Request, artifactId: string, collection: string, documentId: string): Promise<Response> {
    await this.#context.gate.require(artifactId, await this.#context.identity(), request, 'canWriteSharedData', 'change the data of this artifact')
    const deleted = await this.#context.repositories.sharedData.deleteDocument(artifactId, SharedDataApi.#validName('collection', collection), SharedDataApi.#validName('document id', documentId))
    if (!deleted) throw HttpError.notFound(`document ${collection}/${documentId}`)
    return new Response(null, { status: 204 })
  }

  static #validName(label: string, name: string): string {
    if (!NAME_PATTERN.test(name)) throw HttpError.badRequest(`${label} must be 1 to 64 letters, digits, "-" or "_"`)
    return name
  }

  static #documentJson(sharedDocument: SharedDocument, names: Map<string, string>) {
    const personOf = (userId: string | null) => (userId === null ? null : { userId, name: names.get(userId) })
    return {
      id: sharedDocument.documentId,
      collection: sharedDocument.collection,
      data: sharedDocument.data,
      createdBy: personOf(sharedDocument.createdBy),
      updatedBy: personOf(sharedDocument.updatedBy),
      createdAt: sharedDocument.createdAt,
      updatedAt: sharedDocument.updatedAt,
    }
  }
}
