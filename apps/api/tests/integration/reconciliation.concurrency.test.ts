import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma';
import { allocateManually, confirmSuggestion, reconcilePayment, voidAllocation } from '../../src/modules/reconciliation/reconciliation.service';
import { createBusinessWithUser, createOrder } from './helpers';

/**
 * The whole reason the reconciliation engine runs its money moves as guarded UPDATE statements
 * (reconciliation.sql.ts) instead of "read the balance, check it in JavaScript, write the new
 * balance" is to survive concurrent requests. A mock can't prove that — this needs a real database
 * enforcing real row locks.
 */

async function makePayment(businessId: string, overrides: Partial<{ amountCents: number; billReference: string | null }> = {}) {
  return prisma.payment.create({
    data: {
      businessId,
      provider: 'MPESA',
      externalReference: `TX-${Math.random().toString(36).slice(2)}`,
      amountCents: overrides.amountCents ?? 250000,
      billReference: overrides.billReference ?? null,
      paidAt: new Date(),
    },
  });
}

describe('concurrent allocation: two requests racing for the same money', () => {
  it('two simultaneous manual allocations of the SAME payment to the SAME order: exactly one succeeds, balances never exceed the amount', async () => {
    const { business, user } = await createBusinessWithUser();
    const order = await createOrder(business.id, { amountCents: 250000 });
    const payment = await makePayment(business.id, { amountCents: 250000 });

    const results = await Promise.allSettled([
      allocateManually(business.id, user.id, payment.id, order.id),
      allocateManually(business.id, user.id, payment.id, order.id),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1); // the second sees "already allocated" or "nothing left"
    expect(rejected).toHaveLength(1);

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalOrder.allocatedCents).toBe(250000); // not 500000
    expect(finalOrder.status).toBe('PAID');
    expect(finalPayment.allocatedCents).toBe(250000);
    expect(finalPayment.status).toBe('MATCHED');

    const activeAllocations = await prisma.allocation.count({ where: { businessId: business.id, status: 'ACTIVE' } });
    expect(activeAllocations).toBe(1);
  });

  it('one payment, one order, THREE competing full-amount claims: only one wins, no matter how many race', async () => {
    const { business, user } = await createBusinessWithUser();
    const order = await createOrder(business.id, { amountCents: 100000 });
    const payment = await makePayment(business.id, { amountCents: 100000 });

    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => allocateManually(business.id, user.id, payment.id, order.id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.allocatedCents).toBe(100000);
  });

  it("the classic hackathon case, made real: one payment, THREE orders at the SAME amount, racing to claim it — never double-spent", async () => {
    const { business, user } = await createBusinessWithUser();
    const orders = await Promise.all([
      createOrder(business.id, { amountCents: 250000 }),
      createOrder(business.id, { amountCents: 250000 }),
      createOrder(business.id, { amountCents: 250000 }),
    ]);
    const payment = await makePayment(business.id, { amountCents: 250000 });

    const results = await Promise.allSettled(orders.map((order) => allocateManually(business.id, user.id, payment.id, order.id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); // the payment only has KSh 2,500 once

    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalPayment.allocatedCents).toBe(250000); // not 750000

    const paidOrders = await prisma.order.count({ where: { businessId: business.id, status: 'PAID' } });
    expect(paidOrders).toBe(1); // exactly one of the three actually got paid
  });

  it('a payment split across two orders (two allocations) never exceeds the payment amount even when both requests race', async () => {
    const { business, user } = await createBusinessWithUser();
    const orderA = await createOrder(business.id, { amountCents: 150000 });
    const orderB = await createOrder(business.id, { amountCents: 150000 });
    const payment = await makePayment(business.id, { amountCents: 200000 }); // only enough for ONE of the two

    const results = await Promise.allSettled([
      allocateManually(business.id, user.id, payment.id, orderA.id),
      allocateManually(business.id, user.id, payment.id, orderB.id),
    ]);

    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalPayment.allocatedCents).toBeLessThanOrEqual(200000);
    // Whichever order(s) actually got money, the sum never exceeds what the payment had.
    const orderA2 = await prisma.order.findUniqueOrThrow({ where: { id: orderA.id } });
    const orderB2 = await prisma.order.findUniqueOrThrow({ where: { id: orderB.id } });
    expect(orderA2.allocatedCents + orderB2.allocatedCents).toBe(finalPayment.allocatedCents);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('confirming the same suggestion twice at once: exactly one confirmation wins', async () => {
    const { business, user } = await createBusinessWithUser();
    const order = await createOrder(business.id, { reference: 'ORD-9001', amountCents: 250000 });
    const payment = await makePayment(business.id, { amountCents: 250000, billReference: null });

    // Score low enough that the engine suggests rather than auto-matches.
    await prisma.customer.create({ data: { businessId: business.id, name: 'X', phone: '254711111111' } }).then((c) =>
      prisma.order.update({ where: { id: order.id }, data: { customerId: c.id } }),
    );
    await reconcilePayment(business.id, payment.id);
    const suggestion = await prisma.allocation.findFirstOrThrow({ where: { businessId: business.id, status: 'SUGGESTED' } });

    const results = await Promise.allSettled([
      confirmSuggestion(business.id, user.id, suggestion.id),
      confirmSuggestion(business.id, user.id, suggestion.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalPayment.allocatedCents).toBeLessThanOrEqual(250000);
  });
});

describe('void reverses exactly what it allocated', () => {
  it('voiding an ACTIVE allocation gives the money back to both sides and reopens their status', async () => {
    const { business, user } = await createBusinessWithUser();
    const order = await createOrder(business.id, { amountCents: 250000 });
    const payment = await makePayment(business.id, { amountCents: 250000 });
    const allocation = await allocateManually(business.id, user.id, payment.id, order.id);

    await voidAllocation(business.id, user.id, allocation.id, 'Wrong order picked');

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(finalOrder.allocatedCents).toBe(0);
    expect(finalOrder.status).toBe('UNPAID');
    expect(finalPayment.allocatedCents).toBe(0);
    expect(finalPayment.status).toBe('UNMATCHED');

    const voided = await prisma.allocation.findUniqueOrThrow({ where: { id: allocation.id } });
    expect(voided.status).toBe('VOIDED');
    expect(voided.voidReason).toBe('Wrong order picked');
  });

  it('voiding is idempotent: voiding twice does not double-refund', async () => {
    const { business, user } = await createBusinessWithUser();
    const order = await createOrder(business.id, { amountCents: 250000 });
    const payment = await makePayment(business.id, { amountCents: 250000 });
    const allocation = await allocateManually(business.id, user.id, payment.id, order.id);

    await voidAllocation(business.id, user.id, allocation.id);
    await voidAllocation(business.id, user.id, allocation.id); // second call: already voided

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.allocatedCents).toBe(0); // not negative
  });

  it('a wrong match can be corrected: void, then allocate to the right order — the audit trail keeps both rows', async () => {
    const { business, user } = await createBusinessWithUser();
    const wrongOrder = await createOrder(business.id, { amountCents: 250000 });
    const rightOrder = await createOrder(business.id, { amountCents: 250000 });
    const payment = await makePayment(business.id, { amountCents: 250000 });

    const wrong = await allocateManually(business.id, user.id, payment.id, wrongOrder.id);
    await voidAllocation(business.id, user.id, wrong.id, 'Wrong order');
    await allocateManually(business.id, user.id, payment.id, rightOrder.id);

    const allRows = await prisma.allocation.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'asc' } });
    expect(allRows).toHaveLength(2);
    expect(allRows[0]).toMatchObject({ orderId: wrongOrder.id, status: 'VOIDED' });
    expect(allRows[1]).toMatchObject({ orderId: rightOrder.id, status: 'ACTIVE' });

    const right = await prisma.order.findUniqueOrThrow({ where: { id: rightOrder.id } });
    expect(right.status).toBe('PAID');
  });
});
