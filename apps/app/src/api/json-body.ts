import { HttpError } from '../http-error.ts'

const MAX_BODY_BYTES = 25 * 1024 * 1024

/** Reads and checks the fields of a JSON request body. */
export class JsonBody {
  readonly #fields: Record<string, unknown>

  private constructor(fields: Record<string, unknown>) {
    this.#fields = fields
  }

  static async of(request: Request): Promise<JsonBody> {
    const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
    if (declaredLength > MAX_BODY_BYTES) throw new HttpError(413, `request body must be at most ${MAX_BODY_BYTES / 1024 / 1024} MB`)
    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch (error) {
      throw HttpError.badRequest('request body must be JSON', { cause: error })
    }
    const isObject = typeof parsedBody === 'object' && parsedBody !== null && !Array.isArray(parsedBody)
    if (!isObject) throw HttpError.badRequest('request body must be a JSON object')
    return new JsonBody(parsedBody as Record<string, unknown>)
  }

  raw(field: string): unknown {
    return this.#fields[field]
  }

  has(field: string): boolean {
    return field in this.#fields
  }

  text(field: string, maxLength: number): string {
    const value = this.#fields[field]
    const trimmedValue = typeof value === 'string' ? value.trim() : ''
    const isValidLength = trimmedValue.length > 0 && trimmedValue.length <= maxLength
    if (!isValidLength) throw HttpError.badRequest(`${field} must be 1 to ${maxLength} characters`)
    return trimmedValue
  }

  /** A field that is missing, null or an empty string holds no value. */
  #isBlank(field: string): boolean {
    const value = this.#fields[field]
    return value === undefined || value === null || value === ''
  }

  optionalText(field: string, maxLength: number): string | null {
    return this.#isBlank(field) ? null : this.text(field, maxLength)
  }

  boolean(field: string, defaultValue: boolean): boolean {
    const value = this.#fields[field]
    if (value === undefined) return defaultValue
    if (typeof value !== 'boolean') throw HttpError.badRequest(`${field} must be true or false`)
    return value
  }

  positiveInteger(field: string, hint: string): number {
    const value = this.#fields[field]
    const isPositiveInteger = Number.isInteger(value) && (value as number) >= 1
    if (!isPositiveInteger) throw HttpError.badRequest(`${field} must be a positive integer; ${hint}`)
    return value as number
  }

  oneOf<Choice extends string>(field: string, choices: readonly Choice[], defaultValue?: Choice): Choice {
    const value = this.#fields[field]
    if (value === undefined && defaultValue !== undefined) return defaultValue
    const choice = choices.find(candidate => candidate === value)
    if (!choice) throw HttpError.badRequest(`${field} must be one of ${choices.join(', ')}`)
    return choice
  }
}
