import type { D1Migration } from '@cloudflare/vitest-pool-workers'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      FILES: R2Bucket
      UNLOCK_RATE_LIMITER: RateLimit
      SIGN_IN_EMAIL_RATE_LIMITER: RateLimit
      SIGN_IN_ADDRESS_RATE_LIMITER: RateLimit
      LOOSE_SIGN_IN_RATE_LIMITER: RateLimit
      MIGRATIONS: D1Migration[]
    }
  }
}
