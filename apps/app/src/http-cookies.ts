export interface CookieOptions {
  maxAgeSeconds: number
  path?: string
}

export class HttpCookies {
  static read(request: Request, name: string): string | null {
    const cookieHeader = request.headers.get('Cookie') ?? ''
    for (const cookiePair of cookieHeader.split(';')) {
      const separatorIndex = cookiePair.indexOf('=')
      if (separatorIndex === -1) continue
      const cookieName = cookiePair.slice(0, separatorIndex).trim()
      if (cookieName === name) return decodeURIComponent(cookiePair.slice(separatorIndex + 1).trim())
    }
    return null
  }

  /** HttpOnly and SameSite=Lax: page scripts cannot read it and other sites cannot send it with a write. */
  static serialize(name: string, value: string, options: CookieOptions, secure: boolean): string {
    const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`, `Max-Age=${options.maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax']
    if (secure) attributes.push('Secure')
    return attributes.join('; ')
  }
}
