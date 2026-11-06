export interface AppResponse {
  status: number
  body: unknown
}

/** Calls the app Worker's HTTP API as the agent: its token and its client name go along with every request. */
export class AppClient {
  readonly #app: Fetcher
  readonly #appOrigin: string
  readonly #authorization: string
  readonly #agentClient: string

  constructor(app: Fetcher, appOrigin: string, authorization: string, agentClient: string) {
    this.#app = app
    this.#appOrigin = appOrigin
    this.#authorization = authorization
    this.#agentClient = agentClient
  }

  async call(method: string, path: string, body?: unknown): Promise<AppResponse> {
    const headers = new Headers({ Authorization: this.#authorization, 'X-Open-Artifact-Client': this.#agentClient })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    // The real app address keeps the links in the app's answers pointing where people can open them.
    const appResponse = await this.#app.fetch(new Request(`${this.#appOrigin}${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body) }))
    const contentType = appResponse.headers.get('Content-Type') ?? ''
    const responseBody = appResponse.status === 204 ? null : contentType.includes('application/json') ? await appResponse.json() : await appResponse.text()
    return { status: appResponse.status, body: responseBody }
  }
}
