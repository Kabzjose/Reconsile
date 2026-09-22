import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/infrastructure/database/prisma';
import { processWebhook } from '../../src/modules/webhooks/webhook.service';
import { signBody } from '../../src/modules/webhooks/webhook.signature';
import { createBusiness, createOrder } from './helpers';

function send(businessId: string, secret: string, payload: unknown) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return processWebhook({ businessId, rawBody, signatureHeader: signBody(secret, rawBody) });
}

describe('webhook idempotency: the retry that matters most', () => {
  it('the SAME transaction id delivered TWICE AT ONCE creates exactly one payment (the real race a provider retry causes)', async () => {
    const business = await createBusiness();
    const payload = { event: 'payment.completed', provider: 'MPESA', transactionId: 'QWE123', amount: 2500 };

    const results = await Promise.all([
      send(business.id, business.webhookSecret, payload),
      send(business.id, business.webhookSecret, payload),
    ]);

    expect(results.every((r) => r.httpStatus === 200)).toBe(true);
    const statuses = results.map((r) => r.body.status).sort();
    expect(statuses).toEqual(['duplicate', 'processed']); // one wins the race, the other is recognised, neither is an error

    const payments = await prisma.payment.findMany({ where: { businessId: business.id, externalReference: 'QWE123' } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amountCents).toBe(250000);

    const events = await prisma.paymentEvent.findMany({ where: { businessId: business.id } });
    expect(events).toHaveLength(2); // BOTH deliveries are on record — the retry is never lost
    expect(events.map((e) => e.outcome).sort()).toEqual(['DUPLICATE', 'PROCESSED']);
  });

  it('ten concurrent deliveries of the same transaction: still exactly one payment', async () => {
    const business = await createBusiness();
    const payload = { event: 'payment.completed', provider: 'MPESA', transactionId: 'TX-FLOOD', amount: 1000 };

    await Promise.all(Array.from({ length: 10 }, () => send(business.id, business.webhookSecret, payload)));

    const payments = await prisma.payment.count({ where: { businessId: business.id, externalReference: 'TX-FLOOD' } });
    expect(payments).toBe(1);
    const events = await prisma.paymentEvent.count({ where: { businessId: business.id } });
    expect(events).toBe(10);
  });

  it('the same transaction id arriving with a DIFFERENT amount is rejected, not silently merged', async () => {
    const business = await createBusiness();
    await send(business.id, business.webhookSecret, { event: 'payment.completed', provider: 'MPESA', transactionId: 'QWE1', amount: 2500 });
    await expect(
      send(business.id, business.webhookSecret, { event: 'payment.completed', provider: 'MPESA', transactionId: 'QWE1', amount: 9999 }),
    ).rejects.toThrow(/different amount/i);

    const payment = await prisma.payment.findFirstOrThrow({ where: { businessId: business.id, externalReference: 'QWE1' } });
    expect(payment.amountCents).toBe(250000); // the original is untouched
  });

  it('two DIFFERENT businesses can each use the same provider transaction id (idempotency is per-business)', async () => {
    const businessA = await createBusiness('Shop A');
    const businessB = await createBusiness('Shop B');
    const payload = { event: 'payment.completed', provider: 'MPESA', transactionId: 'SHARED123', amount: 500 };

    const [resultA, resultB] = await Promise.all([send(businessA.id, businessA.webhookSecret, payload), send(businessB.id, businessB.webhookSecret, payload)]);
    expect(resultA.body.status).toBe('processed');
    expect(resultB.body.status).toBe('processed');
    expect(await prisma.payment.count()).toBe(2);
  });

  it('rejects a wrong signature before storing anything', async () => {
    const business = await createBusiness();
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.completed', provider: 'MPESA', transactionId: 'X', amount: 100 }));
    await expect(processWebhook({ businessId: business.id, rawBody, signatureHeader: 'sha256=wrong' })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(await prisma.paymentEvent.count({ where: { businessId: business.id } })).toBe(0);
  });

  it('malformed JSON is stored as an INVALID event, not a crash', async () => {
    const business = await createBusiness();
    const rawBody = Buffer.from('{"not valid json');
    const result = await processWebhook({ businessId: business.id, rawBody, signatureHeader: signBody(business.webhookSecret, rawBody) });
    expect(result.httpStatus).toBe(422);
    const event = await prisma.paymentEvent.findFirstOrThrow({ where: { businessId: business.id } });
    expect(event.outcome).toBe('INVALID');
  });

  it('an event type other than payment.completed is acknowledged (200) but does not create a payment', async () => {
    const business = await createBusiness();
    const result = await send(business.id, business.webhookSecret, { event: 'payment.refunded', provider: 'MPESA', transactionId: 'R1', amount: 100 });
    expect(result.httpStatus).toBe(200);
    expect(await prisma.payment.count({ where: { businessId: business.id } })).toBe(0);
  });
});

describe('webhook -> reconciliation, end to end', () => {
  it('an exact-reference payment auto-matches and the order flips to PAID, all from one webhook call', async () => {
    const business = await createBusiness();
    const order = await createOrder(business.id, { reference: 'ORD-1042', amountCents: 250000 });

    const result = await send(business.id, business.webhookSecret, {
      event: 'payment.completed',
      provider: 'MPESA',
      transactionId: 'QWE123',
      amount: 2500,
      reference: 'ord-1042', // lower-case on purpose: matching must be case-insensitive
    });

    expect(result.body.reconciliation!).toMatchObject({ outcome: 'AUTO_MATCHED', orderReference: 'ORD-1042' });
    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe('PAID');
  });

  it('the exact worked example from the brief: Order #1042, KSh 2,500, arrives one minute later — auto-matched', async () => {
    const business = await createBusiness();
    await prisma.order.create({
      data: { businessId: business.id, reference: 'ORD-1042', amountCents: 250000, createdAt: new Date('2026-09-21T10:31:00Z') },
    });
    const result = await send(business.id, business.webhookSecret, {
      event: 'payment.completed',
      provider: 'MPESA',
      transactionId: 'ABC123XYZ',
      amount: 2500,
      reference: 'ORD-1042',
      paidAt: '2026-09-21T10:32:00Z',
    });
    expect(result.body.reconciliation!.outcome).toBe('AUTO_MATCHED');
    expect(result.body.reconciliation!.confidence).toBeGreaterThanOrEqual(90);
  });

  it('a Till payment with no reference, matching THREE identical-amount orders, is left for review — never guessed', async () => {
    const business = await createBusiness();
    await Promise.all([
      createOrder(business.id, { reference: 'ORD-A', amountCents: 250000 }),
      createOrder(business.id, { reference: 'ORD-B', amountCents: 250000 }),
      createOrder(business.id, { reference: 'ORD-C', amountCents: 250000 }),
    ]);

    const result = await send(business.id, business.webhookSecret, { event: 'payment.completed', provider: 'MPESA', transactionId: 'TILL1', amount: 2500 });

    expect(result.body.reconciliation!.outcome).not.toBe('AUTO_MATCHED');
    const paid = await prisma.order.count({ where: { businessId: business.id, status: 'PAID' } });
    expect(paid).toBe(0); // none of the three was guessed at
  });
});
