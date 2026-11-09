import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-08-20',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['FILES'],
        ratelimits: {
          UNLOCK_RATE_LIMITER: { namespace_id: '1001', simple: { limit: 5, period: 60 } },
          SIGN_IN_EMAIL_RATE_LIMITER: { namespace_id: '1002', simple: { limit: 3, period: 60 } },
          SIGN_IN_ADDRESS_RATE_LIMITER: { namespace_id: '1003', simple: { limit: 20, period: 60 } },
          REPORT_RATE_LIMITER: { namespace_id: '1004', simple: { limit: 5, period: 60 } },
          LOOSE_SIGN_IN_RATE_LIMITER: { namespace_id: '1099', simple: { limit: 100000, period: 60 } },
        },
        bindings: { MIGRATIONS: await readD1Migrations('../../packages/storage-cloudflare/migrations') },
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
})
