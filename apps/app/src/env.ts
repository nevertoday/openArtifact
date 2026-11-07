export interface AppEnv {
  DB: D1Database
  FILES: R2Bucket
  UNLOCK_RATE_LIMITER: RateLimit
  /** Sign-in links mailed to one address. */
  SIGN_IN_EMAIL_RATE_LIMITER: RateLimit
  /** Sign-in links asked for from one network address. */
  SIGN_IN_ADDRESS_RATE_LIMITER: RateLimit
  USERCONTENT_ORIGIN: string
  /** Where the MCP Worker runs; the settings page shows agents this address. */
  MCP_ORIGIN: string
  BETTER_AUTH_SECRET: string
  /** Shared with the usercontent Worker, which checks the signed file URLs the app hands out. */
  USERCONTENT_SIGNING_KEY: string
  /** Comma-separated email domains whose people may create an account, or "*" for any address; unset lets only the founder sign up. */
  ALLOWED_EMAIL_DOMAINS?: string
  /** "console" prints mail to the log for local development; "cloudflare" sends through the EMAIL binding. */
  MAILER?: string
  /** Cloudflare Email Service binding, used when MAILER is "cloudflare". */
  EMAIL?: SendEmail
  /** Sender for MAILER=cloudflare, on a domain verified in Cloudflare Email Service. */
  MAIL_FROM?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Company SSO through any OpenID Connect provider (Okta, Azure AD, Feishu, DingTalk, ...). */
  OIDC_DISCOVERY_URL?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  OIDC_DISPLAY_NAME?: string
}
