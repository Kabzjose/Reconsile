import { defineConfig } from 'vitest/config';

// Runs against a REAL PostgreSQL (see tests/integration/README.md), unlike vitest.config.mts,
// which mocks the database entirely. Separate config so `pnpm test` (CI-safe, no DB needed)
// and `pnpm test:integration` (needs Postgres) stay independent.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
    // DATABASE_URL is expected to already be set in the environment (see the README);
    // everything else matches vitest.config.mts.
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      BCRYPT_ROUNDS: '4',
      LOG_LEVEL: 'silent',
    },
    fileParallelism: false, // tests share one database; truncation between them must not race
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
  },
});
