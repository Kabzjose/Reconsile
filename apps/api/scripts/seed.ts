/**
 * Seeds one demo business so the app isn't empty on first login.
 * Idempotent: re-running it updates the same business (found by owner email) instead of duplicating it.
 *
 *   pnpm db:seed
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/infrastructure/database/prisma';
import { hashPassword } from '../src/shared/security/password';


//demo account credentials
const OWNER_EMAIL = 'demo@reconcile.app';
const OWNER_PASSWORD = 'password@123';

const CUSTOMERS = [
  { name: 'John Mwangi', phone: '254712000001' },
  { name: 'Grace Wanjiru', phone: '254722000002' },
  { name: 'Peter Otieno', phone: '254733000003' },
  { name: 'Mary Achieng', phone: '254744000004' },
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

async function main() {
  console.log(`Seeding demo business (owner: ${OWNER_EMAIL}) ...`);

  const passwordHash = await hashPassword(OWNER_PASSWORD);
  const existing = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { businessId: true } });

  const business = existing
    ? await prisma.business.update({ where: { id: existing.businessId }, data: {} })
    : await prisma.business.create({
        data: {
          name: 'Mama Njeri Shop',
          webhookSecret: randomBytes(32).toString('hex'),
          users: { create: { email: OWNER_EMAIL, passwordHash } },
        },
      });

  // Reset to a clean, known state so the seed is safe to re-run during the hackathon.
  await prisma.$transaction([
    prisma.allocation.deleteMany({ where: { businessId: business.id } }),
    prisma.paymentEvent.deleteMany({ where: { businessId: business.id } }),
    prisma.payment.deleteMany({ where: { businessId: business.id } }),
    prisma.order.deleteMany({ where: { businessId: business.id } }),
    prisma.customer.deleteMany({ where: { businessId: business.id } }),
  ]);

  const customers = await Promise.all(
    CUSTOMERS.map((customer) => prisma.customer.create({ data: { businessId: business.id, ...customer } })),
  );

  // Orders: some already paid (seeded directly as PAID, no allocation — these are last week's
  // closed business, not something to reconcile), some open at the SAME amount on purpose
  // (this is what makes automatic matching a genuinely hard problem), one that will underpay,
  // one that will overpay, one disputed, one cancelled.
  await prisma.order.createMany({
    data: [
      { businessId: business.id, customerId: customers[0]!.id, reference: 'ORD-1001', description: 'Catering – birthday order', amountCents: 850000, status: 'PAID', allocatedCents: 850000, createdAt: hoursAgo(72) },
      { businessId: business.id, customerId: customers[1]!.id, reference: 'ORD-1002', description: '2 bags of cement', amountCents: 250000, status: 'PAID', allocatedCents: 250000, createdAt: hoursAgo(50) },
      { businessId: business.id, customerId: customers[0]!.id, reference: 'ORD-1003', description: 'Weekly grocery supply', amountCents: 250000, status: 'UNPAID', createdAt: hoursAgo(6) },
      { businessId: business.id, customerId: customers[2]!.id, reference: 'ORD-1004', description: 'Weekly grocery supply', amountCents: 250000, status: 'UNPAID', createdAt: hoursAgo(4) },
      { businessId: business.id, reference: 'ORD-1005', description: 'Walk-in: hardware supplies', amountCents: 250000, status: 'UNPAID', createdAt: hoursAgo(2) },
      { businessId: business.id, customerId: customers[3]!.id, reference: 'ORD-1006', description: 'Wedding cake deposit', amountCents: 470000, status: 'UNPAID', createdAt: hoursAgo(30) },
      { businessId: business.id, customerId: customers[1]!.id, reference: 'ORD-1007', description: 'Office stationery', amountCents: 180000, status: 'UNPAID', createdAt: hoursAgo(20) },
      { businessId: business.id, reference: 'ORD-1008', description: 'Walk-in: 1 sack of rice', amountCents: 620000, status: 'DISPUTED', disputeNote: 'Customer says they paid at a different till', createdAt: hoursAgo(15) },
      { businessId: business.id, reference: 'ORD-1009', description: 'Cancelled — customer changed order', amountCents: 90000, status: 'CANCELLED', createdAt: hoursAgo(40) },
    ],
  });

  console.log('Seed complete.');
  console.log(`  Business: ${business.name} (${business.id})`);
  console.log(`  Log in:   ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log('  Orders:   ORD-1003 and ORD-1004 are both open at KSh 2,500 on purpose —');
  console.log('            that ambiguity is the reason the matching engine has to look past amount.');
  console.log('  Next:     start the API, log in, then POST /api/simulator/scenarios/CLEAN (etc.)');
  console.log('            or import GET /api/imports/sample to see reconciliation happen live.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
