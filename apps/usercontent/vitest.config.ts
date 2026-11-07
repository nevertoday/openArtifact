import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// The Worker runs in workerd; the SDK it serves runs in a browser page, so its tests run in a DOM instead.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            miniflare: {
              compatibilityDate: '2026-08-20',
              d1Databases: ['DB'],
              r2Buckets: ['FILES'],
              bindings: { MIGRATIONS: await readD1Migrations('../../packages/storage-cloudflare/migrations') },
            },
          })),
        ],
        test: { name: 'worker', include: ['test/**/*.test.ts'], exclude: ['test/sdk/**'], setupFiles: ['./test/apply-migrations.ts'] },
      },
      {
        test: { name: 'sdk', include: ['test/sdk/**/*.test.ts'], environment: 'node' },
      },
    ],
  },
})
