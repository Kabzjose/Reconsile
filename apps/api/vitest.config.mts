import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'], // needs a real database; run separately via `pnpm test:integration`
    // Set BEFORE any module is imported, because src/config/env.ts validates on import.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://reconcile:reconcile@localhost:5432/reconcile_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      BCRYPT_ROUNDS: '4',
      LOG_LEVEL: 'silent',
    },
  },
});
