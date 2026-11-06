import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-08-20',
        d1Databases: ['DB'],
        r2Buckets: ['FILES'],
        bindings: { MIGRATIONS: await readD1Migrations('./migrations') },
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
})
