import { randomBytes } from 'node:crypto';
import { prisma } from '../../src/infrastructure/database/prisma';

export async function createBusiness(name = 'Test Shop') {
  return prisma.business.create({ data: { name, webhookSecret: randomBytes(32).toString('hex') } });
}

/** Allocation.decidedById is a real foreign key to users, so tests need an actual user row too. */
export async function createBusinessWithUser(name = 'Test Shop') {
  const business = await createBusiness(name);
  const user = await prisma.user.create({ data: { businessId: business.id, email: `${randomBytes(6).toString('hex')}@test.local`, passwordHash: 'x' } });
  return { business, user };
}

export async function createOrder(businessId: string, overrides: Partial<{ reference: string; amountCents: number; customerId: string | null }> = {}) {
  return prisma.order.create({
    data: {
      businessId,
      reference: overrides.reference ?? `ORD-${randomBytes(4).toString('hex')}`,
      amountCents: overrides.amountCents ?? 250000,
      customerId: overrides.customerId ?? null,
    },
  });
}
