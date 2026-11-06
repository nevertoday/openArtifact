import type { D1Migration } from '@cloudflare/vitest-pool-workers'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      FILES: R2Bucket
      MIGRATIONS: D1Migration[]
    }
  }
}
