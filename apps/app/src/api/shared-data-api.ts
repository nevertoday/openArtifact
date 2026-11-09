import type { SharedDataBudget, SharedDocument } from '@open-artifact/core'
import type { Identity } from '../auth/request-identity.ts'
import { HttpError } from '../http-error.ts'
import { SenderNetwork } from '../sender-network.ts'
import type { ApiContext } from './api-context.ts'
import { JsonBody } from './json-body.ts'
import { SHARED_DATA_BUDGETS } from './publish-limits.ts'

/** Who may change shared data how often: visitors who are not signed in per sender network, people signed in each on their own. */
export interface SharedDataWriteLimiters {
  visitorNetwork: RateLimit
  person: RateLimit
}

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
    await this.#ensureWriterAllowed(request, identity)
    await this.#context.gate.require(artifactId, identity, request, 'canWriteSharedData', 'change the data of this artifact')
    const requestBody = await JsonBody.of(request)
    const documentData = requestBody.raw('data')
    if (documentData === undefined) throw HttpError.badRequest('data is required')
    const documentBytes = new TextEncoder().encode(JSON.stringify(documentData)).byteLength
    if (documentBytes > MAX_DOCUMENT_BYTES) throw HttpError.tooLarge(`a document must be at most ${MAX_DOCUMENT_BYTES / 1024} KB`)
    const validCollection = SharedDataApi.#validName('collection', collection)
    const validDocumentId = SharedDataApi.#validName('document id', documentId)
    const write = await this.#context.repositories.sharedData.putDocument(artifactId, validCollection, validDocumentId, documentData, identity?.userId ?? null, SHARED_DATA_BUDGETS)
    switch (write.status) {
      case 'saved': {
        const names = await this.#context.people.namesOf([write.document.createdBy, write.document.updatedBy])
        return Response.json({ document: SharedDataApi.#documentJson(write.document, names) })
      }
      case 'over_budget':
        throw SharedDataApi.#overBudget(write.budget)
      case 'not_found':
        throw HttpError.notFound(`artifact ${artifactId}`)
    }
  }

  async deleteDocument(request: Request, artifactId: string, collection: string, documentId: string): Promise<Response> {
    const identity = await this.#context.identity()
    await this.#ensureWriterAllowed(request, identity)
    await this.#context.gate.require(artifactId, identity, request, 'canWriteSharedData', 'change the data of this artifact')
    const deleted = await this.#context.repositories.sharedData.deleteDocument(artifactId, SharedDataApi.#validName('collection', collection), SharedDataApi.#validName('document id', documentId))
    if (!deleted) throw HttpError.notFound(`document ${collection}/${documentId}`)
    return new Response(null, { status: 204 })
  }

  // Visitors of a public link that lets anyone write are no one in particular, so their writes are limited per sender
  // network; anyone signed in is limited on their own, wherever they write from.
  async #ensureWriterAllowed(request: Request, identity: Identity | null): Promise<void> {
    const limiters = this.#context.sharedDataWriteLimiters
    if (identity !== null) {
      const { success } = await limiters.person.limit({ key: identity.userId })
      if (!success) throw new HttpError(429, 'rate_limited', 'too many changes to shared data from you; wait a minute and try again')
      return
    }
    const senderNetwork = SenderNetwork.of(request)
    if (senderNetwork === null) return
    const { success } = await limiters.visitorNetwork.limit({ key: senderNetwork })
    if (!success) throw new HttpError(429, 'rate_limited', 'too many changes to shared data from this network; wait a minute and try again')
  }

  static #overBudget(budget: SharedDataBudget): HttpError {
    const { artifactDocuments, artifactBytes, workspaceBytes, deploymentBytes } = SHARED_DATA_BUDGETS
    const megabytes = (bytes: number) => `${bytes / 1024 ** 2} MB`
    switch (budget) {
      case 'artifact':
        return new HttpError(
          413,
          'shared_data_full',
          `this page's shared data would then be more than the ${artifactDocuments} documents or ${megabytes(artifactBytes)} one page may keep; ` +
            'nothing was saved. Delete documents the page no longer needs, or replace one instead of adding another',
        )
      case 'workspace':
        return new HttpError(
          413,
          'shared_data_full',
          `the shared data of this workspace's pages would then be more than the ${megabytes(workspaceBytes)} one workspace may keep; nothing was saved. ` +
            "Delete documents its pages no longer need; a removed artifact's data counts until it is deleted forever under Recently deleted (最近删除) or purged 30 days later",
        )
      case 'deployment':
        return new HttpError(
          507,
          'shared_data_full',
          `this deployment keeps the most shared data it may, ${megabytes(deploymentBytes)} across every workspace; nothing was saved. Tell whoever runs it`,
        )
    }
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
