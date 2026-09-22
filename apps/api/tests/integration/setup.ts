import { beforeEach } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma';

// A clean slate before every test. CASCADE ignores the app-level onDelete: Restrict (that
// guard is for normal queries, not test cleanup) and RESTART IDENTITY isn't needed since every
// id is a cuid, not a sequence.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE allocations, payment_events, payments, orders, customers, users, businesses CASCADE',
  );
});
