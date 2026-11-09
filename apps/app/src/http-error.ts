/**
 * Stable names for what went wrong. Agents read the English `error`; the web pages map `code` to the reader's
 * language in the `client.errors` messages (public/static/i18n), so a code is renamed in both places or neither.
 */
export type ErrorCode =
  | 'unauthenticated'
  | 'token_invalid'
  | 'token_revoked'
  | 'token_expired'
  | 'forbidden'
  | 'admin_required'
  | 'browser_session_required'
  | 'outside_token_scope'
  | 'cross_site_request'
  | 'not_found'
  | 'method_not_allowed'
  | 'invalid_request'
  | 'field_required'
  | 'field_too_long'
  | 'field_invalid'
  | 'too_large'
  | 'last_admin'
  | 'cannot_remove_self'
  | 'author_always_sees'
  | 'public_links_off'
  | 'version_conflict'
  | 'not_listable'
  | 'share_text_too_long'
  | 'rate_limited'
  | 'mail_limit_reached'
  | 'workspace_quota_reached'
  | 'publish_limit_reached'
  | 'shared_data_full'
  | 'workspace_limit_reached'
  | 'workspace_changed'
  | 'workspace_deleted'
  | 'personal_workspace'

/** Which request field an error is about, so a page can show it under that field. */
export interface FieldDetail {
  field: string
  maxLength?: number
}

/** An error the caller can fix; its message is shown to agents as is. */
export class HttpError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly fieldDetail: FieldDetail | null

  constructor(status: number, code: ErrorCode, message: string, fieldDetail: FieldDetail | null = null, options?: ErrorOptions) {
    super(message, options)
    this.status = status
    this.code = code
    this.fieldDetail = fieldDetail
  }

  static badRequest(message: string, options?: ErrorOptions): HttpError {
    return new HttpError(400, 'invalid_request', message, null, options)
  }

  /** `maxLength` is null for a field that has no length limit. */
  static fieldRequired(field: string, maxLength: number | null): HttpError {
    if (maxLength === null) return new HttpError(400, 'field_required', `${field} is required`, { field })
    return new HttpError(400, 'field_required', `${field} must be 1 to ${maxLength} characters`, { field, maxLength })
  }

  static fieldTooLong(field: string, maxLength: number): HttpError {
    return new HttpError(400, 'field_too_long', `${field} must be 1 to ${maxLength} characters`, { field, maxLength })
  }

  static fieldInvalid(field: string, message: string, options?: ErrorOptions): HttpError {
    return new HttpError(400, 'field_invalid', message, { field }, options)
  }

  static unauthorized(): HttpError {
    return new HttpError(401, 'unauthenticated', 'sign in, or send a personal API token as "Authorization: Bearer oa_pat_…"')
  }

  static forbidden(action: string): HttpError {
    return new HttpError(403, 'forbidden', `you do not have permission to ${action}`)
  }

  static adminRequired(action: string): HttpError {
    return new HttpError(403, 'admin_required', `you do not have permission to ${action}; ask a workspace admin`)
  }

  /** The person may do this, but the API token they sent was made for publishing only. */
  static outsideTokenScope(action: string): HttpError {
    return new HttpError(403, 'outside_token_scope', `this token may only publish; to ${action}, create a token with full access in Settings › Agent access (设置 › Agent 接入), or use the web page`)
  }

  /** Also used when the caller may not know the thing exists, so its existence is not revealed. */
  static notFound(what: string): HttpError {
    return new HttpError(404, 'not_found', `${what} not found`)
  }

  static methodNotAllowed(method: string): HttpError {
    return new HttpError(405, 'method_not_allowed', `${method} is not supported here`)
  }

  static tooLarge(message: string): HttpError {
    return new HttpError(413, 'too_large', message)
  }

  toResponse(): Response {
    return Response.json({ error: this.message, code: this.code, ...this.fieldDetail }, { status: this.status })
  }
}
