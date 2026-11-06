import { HttpError } from '../http-error.ts'
import type { ApiContext } from './api-context.ts'
import { ArtifactApi } from './artifact-api.ts'
import { CommentApi } from './comment-api.ts'
import { SharedDataApi } from './shared-data-api.ts'
import { SharingApi } from './sharing-api.ts'
import { TokenApi } from './token-api.ts'
import { WorkspaceApi } from './workspace-api.ts'

type RouteParams = Record<string, string | undefined>

interface ApiRoute {
  method: string
  pattern: URLPattern
  respond: (apis: Apis, request: Request, params: RouteParams) => Promise<Response>
}

class Apis {
  readonly artifacts: ArtifactApi
  readonly comments: CommentApi
  readonly sharing: SharingApi
  readonly tokens: TokenApi
  readonly sharedData: SharedDataApi
  readonly workspace: WorkspaceApi

  constructor(context: ApiContext) {
    this.artifacts = new ArtifactApi(context)
    this.comments = new CommentApi(context)
    this.sharing = new SharingApi(context)
    this.tokens = new TokenApi(context)
    this.sharedData = new SharedDataApi(context)
    this.workspace = new WorkspaceApi(context)
  }
}

function route(method: string, pathname: string, respond: ApiRoute['respond']): ApiRoute {
  return { method, pattern: new URLPattern({ pathname }), respond }
}

function param(params: RouteParams, name: string): string {
  const value = params[name]
  if (value === undefined) throw new Error(`API route is missing the :${name} parameter`)
  return decodeURIComponent(value)
}

const API_ROUTES: ApiRoute[] = [
  route('GET', '/api/me', apis => apis.workspace.me()),
  route('PATCH', '/api/me', (apis, request) => apis.workspace.rename(request)),
  route('POST', '/api/me/workspace', (apis, request) => apis.workspace.switchWorkspace(request)),
  route('GET', '/api/workspace/members', apis => apis.workspace.members()),
  route('PATCH', '/api/workspace/members/:userId', (apis, request, params) => apis.workspace.changeRole(request, param(params, 'userId'))),
  route('DELETE', '/api/workspace/members/:userId', (apis, _request, params) => apis.workspace.removeMember(param(params, 'userId'))),
  route('PATCH', '/api/workspace', (apis, request) => apis.workspace.updateSettings(request)),
  route('GET', '/api/tokens', apis => apis.tokens.list()),
  route('POST', '/api/tokens', (apis, request) => apis.tokens.create(request)),
  route('DELETE', '/api/tokens/:tokenId', (apis, _request, params) => apis.tokens.revoke(param(params, 'tokenId'))),
  route('GET', '/api/workspace/artifacts', apis => apis.artifacts.listWorkspace()),
  route('GET', '/api/workspace/audit', apis => apis.workspace.audit()),
  route('GET', '/api/artifacts', (apis, request) => apis.artifacts.list(request)),
  route('POST', '/api/artifacts', (apis, request) => apis.artifacts.create(request)),
  route('GET', '/api/artifacts/:artifactId', (apis, request, params) => apis.artifacts.read(request, param(params, 'artifactId'))),
  route('PUT', '/api/artifacts/:artifactId', (apis, request, params) => apis.artifacts.update(request, param(params, 'artifactId'))),
  route('PATCH', '/api/artifacts/:artifactId', (apis, request, params) => apis.artifacts.rename(request, param(params, 'artifactId'))),
  route('DELETE', '/api/artifacts/:artifactId', (apis, request, params) => apis.artifacts.remove(request, param(params, 'artifactId'))),
  route('POST', '/api/artifacts/:artifactId/restore', (apis, request, params) => apis.artifacts.restoreRemoved(request, param(params, 'artifactId'))),
  route('GET', '/api/artifacts/:artifactId/versions', (apis, request, params) => apis.artifacts.listVersions(request, param(params, 'artifactId'))),
  route('POST', '/api/artifacts/:artifactId/versions/:version(\\d+)/restore', (apis, request, params) =>
    apis.artifacts.restoreVersion(request, param(params, 'artifactId'), Number(param(params, 'version'))),
  ),
  route('GET', '/api/artifacts/:artifactId/comments', (apis, request, params) => apis.comments.list(request, param(params, 'artifactId'))),
  route('POST', '/api/artifacts/:artifactId/comments', (apis, request, params) => apis.comments.add(request, param(params, 'artifactId'))),
  route('PATCH', '/api/comments/:commentId', (apis, request, params) => apis.comments.setResolved(request, param(params, 'commentId'))),
  route('GET', '/api/artifacts/:artifactId/sharing', (apis, request, params) => apis.sharing.read(request, param(params, 'artifactId'))),
  route('PUT', '/api/artifacts/:artifactId/sharing', (apis, request, params) => apis.sharing.update(request, param(params, 'artifactId'))),
  route('GET', '/api/artifacts/:artifactId/sharing/people', (apis, request, params) => apis.sharing.findPerson(request, param(params, 'artifactId'))),
  route('GET', '/api/artifacts/:artifactId/data', (apis, request, params) => apis.sharedData.listCollections(request, param(params, 'artifactId'))),
  route('GET', '/api/artifacts/:artifactId/data/:collection', (apis, request, params) =>
    apis.sharedData.listDocuments(request, param(params, 'artifactId'), param(params, 'collection')),
  ),
  route('PUT', '/api/artifacts/:artifactId/data/:collection/:documentId', (apis, request, params) =>
    apis.sharedData.putDocument(request, param(params, 'artifactId'), param(params, 'collection'), param(params, 'documentId')),
  ),
  route('DELETE', '/api/artifacts/:artifactId/data/:collection/:documentId', (apis, request, params) =>
    apis.sharedData.deleteDocument(request, param(params, 'artifactId'), param(params, 'collection'), param(params, 'documentId')),
  ),
]

/** Matches /api requests to their handler and turns errors the caller can fix into JSON responses. */
export class ApiRoutes {
  static async respond(request: Request, context: ApiContext): Promise<Response> {
    const requestUrl = new URL(request.url)
    const pathMatches = API_ROUTES.map(apiRoute => ({ apiRoute, match: apiRoute.pattern.exec(requestUrl) })).filter(candidate => candidate.match !== null)
    try {
      if (pathMatches.length === 0) throw HttpError.notFound(`API route ${requestUrl.pathname}`)
      const methodMatch = pathMatches.find(candidate => candidate.apiRoute.method === request.method)
      if (!methodMatch) throw HttpError.methodNotAllowed(request.method)
      return await methodMatch.apiRoute.respond(new Apis(context), request, methodMatch.match?.pathname.groups ?? {})
    } catch (error) {
      if (error instanceof HttpError) return error.toResponse()
      throw error
    }
  }
}
