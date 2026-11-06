/** An error the caller can fix; its message is shown to them as is. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }

  static badRequest(message: string, options?: ErrorOptions): HttpError {
    return new HttpError(400, message, options)
  }

  static unauthorized(): HttpError {
    return new HttpError(401, 'sign in, or send a personal API token as "Authorization: Bearer oa_pat_…"')
  }

  static forbidden(action: string): HttpError {
    return new HttpError(403, `you do not have permission to ${action}`)
  }

  /** The person may do this, but the API token they sent was made for publishing only. */
  static outsideTokenScope(action: string): HttpError {
    return new HttpError(403, `this token may only publish; to ${action}, create a token with full access in 设置 › Agent 接入, or use the web page`)
  }

  /** Also used when the caller may not know the thing exists, so its existence is not revealed. */
  static notFound(what: string): HttpError {
    return new HttpError(404, `${what} not found`)
  }

  static methodNotAllowed(method: string): HttpError {
    return new HttpError(405, `${method} is not supported here`)
  }

  toResponse(): Response {
    return Response.json({ error: this.message }, { status: this.status })
  }
}

/** The person signed in, but an admin removed them from every workspace they belonged to. */
export class RemovedFromWorkspaceError extends HttpError {
  constructor() {
    super(403, 'you were removed from this workspace; ask a workspace admin')
  }
}
