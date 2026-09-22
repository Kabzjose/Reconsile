# Integration tests

`vitest.config.mts` (`pnpm test`) mocks Prisma entirely and never touches a database — that's
what runs in CI and what the earlier phases' tests use.

This folder is different: it runs the real service/route code against a real PostgreSQL,
covering exactly the things a mock can't: the append-only trigger, the CHECK constraints, and —
most importantly — concurrent requests racing for the same money.

## Running

```bash
docker compose up -d          # or any PostgreSQL 14+
export DATABASE_URL="postgresql://reconcile:reconcile@localhost:5432/reconcile_test?schema=public"
pnpm exec prisma migrate deploy --schema prisma/schema.prisma   # once, against reconcile_test
pnpm test:integration
```

Use a database you don't mind being wiped: every test truncates all tables first.
