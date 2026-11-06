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
        ratelimits: { UNLOCK_RATE_LIMITER: { namespace_id: '1001', simple: { limit: 5, period: 60 } } },
        bindings: { MIGRATIONS: await readD1Migrations('../../packages/storage-cloudflare/migrations') },
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
})
