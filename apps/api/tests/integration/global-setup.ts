// Runs once before the whole integration suite. Confirms the database is reachable and its
// schema matches (every table this suite needs already exists) before any test starts,
// so a missing `prisma migrate deploy` fails with one clear message instead of 20 confusing ones.
import { Client } from 'pg';

export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. See tests/integration/README.md.');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = new Set(rows.map((row) => row.table_name));
    for (const required of ['businesses', 'orders', 'payments', 'allocations', 'payment_events']) {
      if (!tables.has(required)) {
        throw new Error(`Table "${required}" is missing. Run: pnpm exec prisma migrate deploy`);
      }
    }
  } finally {
    await client.end();
  }
}
