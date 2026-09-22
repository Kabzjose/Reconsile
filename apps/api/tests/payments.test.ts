import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/infrastructure/database/prisma';
import { signToken } from '../src/shared/security/jwt';

vi.mock('../src/infrastructure/database/prisma', () => ({
  prisma: {
    payment: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    paymentEvent: { create: vi.fn(), update: vi.fn() },
    order: { findMany: vi.fn() },
    allocation: { findMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const db = prisma as unknown as {
  payment: Record<'create' | 'findUnique' | 'findFirst' | 'findMany' | 'count' | 'updateMany', Mock>;
  paymentEvent: Record<'create' | 'update', Mock>;
  order: { findMany: Mock };
  allocation: Record<'findMany' | 'createMany' | 'count', Mock>;
  $transaction: Mock;
};

const app = createApp();
const auth = { Authorization: `Bearer ${signToken({ userId: 'user_1', businessId: 'biz_1' })}` };
const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

const makePayment = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay_1',
  businessId: 'biz_1',
  provider: 'MPESA',
  externalReference: 'QWE123',
  billReference: 'ORD-1042',
  amountCents: 250000,
  allocatedCents: 0,
  payerPhone: '254712345678',
  payerName: null,
  status: 'UNMATCHED',
  disputeNote: null,
  paidAt: new Date('2026-09-21T10:32:00Z'),
  metadata: null,
  createdAt: new Date('2026-09-21T10:32:05Z'),
  updatedAt: new Date('2026-09-21T10:32:05Z'),
  ...overrides,
});

const validBody = {
  provider: 'MPESA',
  externalReference: 'QWE123',
  billReference: 'ORD-1042',
  amountCents: 250000,
  payerPhone: '0712 345 678',
  paidAt: '2026-09-21T10:32:00Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(db)));
  db.paymentEvent.create.mockResolvedValue({ id: 'evt_1' });
  db.paymentEvent.update.mockResolvedValue({});
  // reconcilePayment() runs right after a successful ingest; give it an empty, harmless world by default.
  db.payment.findFirst.mockResolvedValue(null); // not found -> reconcilePayment throws, caught and logged, ingest still succeeds
  db.order.findMany.mockResolvedValue([]);
  db.allocation.findMany.mockResolvedValue([]);
  db.allocation.count.mockResolvedValue(0);
  db.payment.updateMany.mockResolvedValue({ count: 0 });
});

describe('authentication', () => {
  it.each([
    ['get', '/api/payments'],
    ['post', '/api/payments'],
    ['get', '/api/payments/pay_1'],
  ] as const)('%s %s requires a token', async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });
});

describe('POST /api/payments: ingestion', () => {
  it('stores the event FIRST, then the payment, then marks the event PROCESSED', async () => {
    db.payment.create.mockResolvedValue(makePayment());

    const res = await request(app).post('/api/payments').set(auth).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);

    // Order of operations: the raw event is on record before the payment exists.
    expect(db.paymentEvent.create.mock.invocationCallOrder[0]!).toBeLessThan(db.payment.create.mock.invocationCallOrder[0]!);
    expect(db.paymentEvent.create.mock.calls[0]![0].data).toMatchObject({
      businessId: 'biz_1',
      provider: 'MPESA',
      source: 'MANUAL',
      outcome: 'RECEIVED',
      externalReference: 'QWE123',
    });
    expect(db.paymentEvent.update.mock.calls[0]![0].data).toMatchObject({ paymentId: 'pay_1', outcome: 'PROCESSED' });
  });

  it('normalises phone and reference, scopes to the token business, and ignores server-owned fields', async () => {
    db.payment.create.mockResolvedValue(makePayment());

    const res = await request(app)
      .post('/api/payments')
      .set(auth)
      .send({ ...validBody, billReference: '  ord-1042 ', businessId: 'evil', status: 'MATCHED', allocatedCents: 250000 });

    expect(res.status).toBe(201);
    const data = db.payment.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ businessId: 'biz_1', billReference: 'ORD-1042', payerPhone: '254712345678' });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('allocatedCents');
    expect(res.body.data.businessId).toBeUndefined();
    expect(res.body.data.unallocatedCents).toBe(250000);
  });

  it('generates a CASH- reference for manual payments that have none', async () => {
    db.payment.create.mockResolvedValue(makePayment({ provider: 'MANUAL', externalReference: 'CASH-x' }));
    const res = await request(app)
      .post('/api/payments')
      .set(auth)
      .send({ provider: 'MANUAL', amountCents: 50000, paidAt: '2026-09-21T09:00:00Z' });
    expect(res.status).toBe(201);
    expect(db.payment.create.mock.calls[0]![0].data.externalReference).toMatch(/^CASH-[0-9a-f-]{36}$/);
  });
});

describe('POST /api/payments: idempotency', () => {
  it('a retried payment is not an error: 200, duplicate: true, the original payment, and the retry is logged', async () => {
    db.payment.create.mockRejectedValue(uniqueViolation());
    db.payment.findUnique.mockResolvedValue(makePayment());

    const res = await request(app).post('/api/payments').set(auth).send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, data: { id: 'pay_1' } });
    expect(db.payment.create).toHaveBeenCalledTimes(1); // one attempt, no second row
    expect(db.paymentEvent.update.mock.calls[0]![0].data).toMatchObject({ paymentId: 'pay_1', outcome: 'DUPLICATE', error: null });
    expect(db.payment.findUnique.mock.calls[0]![0].where).toEqual({
      businessId_provider_externalReference: { businessId: 'biz_1', provider: 'MPESA', externalReference: 'QWE123' },
    });
  });

  it('the constraint decides, not a prior lookup: findUnique (the duplicate-resolution lookup) is never called on the happy path', async () => {
    db.payment.create.mockResolvedValue(makePayment());
    await request(app).post('/api/payments').set(auth).send(validBody);
    expect(db.payment.findUnique).not.toHaveBeenCalled();
    // The re-read after reconciliation is scoped by businessId, like every other query.
    expect(db.payment.findFirst).toHaveBeenCalledWith({ where: { id: 'pay_1', businessId: 'biz_1' } });
  });

  it('same transaction id with a DIFFERENT amount is flagged as a conflict, not silently accepted', async () => {
    db.payment.create.mockRejectedValue(uniqueViolation());
    db.payment.findUnique.mockResolvedValue(makePayment({ amountCents: 100000 }));

    const res = await request(app).post('/api/payments').set(auth).send(validBody); // 250000

    expect(res.status).toBe(409);
    expect(db.paymentEvent.update.mock.calls[0]![0].data.error).toContain('Amount mismatch');
  });

  it('an unexpected failure leaves the event on record as FAILED, and the client sees a generic 500', async () => {
    db.payment.create.mockRejectedValue(new Error('connection reset by 10.0.0.5'));

    const res = await request(app).post('/api/payments').set(auth).send(validBody);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    expect(db.paymentEvent.create).toHaveBeenCalledTimes(1); // stored before the failure
    expect(db.paymentEvent.update.mock.calls[0]![0].data).toMatchObject({ outcome: 'FAILED' });
  });
});

describe('POST /api/payments: validation', () => {
  it.each([
    ['zero amount', { ...validBody, amountCents: 0 }],
    ['fractional cents', { ...validBody, amountCents: 99.5 }],
    ['amount beyond the 32-bit column', { ...validBody, amountCents: 9_999_999_999 }],
    ['unknown provider', { ...validBody, provider: 'PAYPAL' }],
    ['M-Pesa payment without a transaction id', { ...validBody, externalReference: undefined }],
    ['invalid phone', { ...validBody, payerPhone: '12345' }],
    ['missing paidAt', { ...validBody, paidAt: undefined }],
    ['garbage paidAt', { ...validBody, paidAt: 'yesterday-ish' }],
    ['future paidAt', { ...validBody, paidAt: '2099-01-01T00:00:00Z' }],
    ['paidAt = null (would become 1970)', { ...validBody, paidAt: null }],
  ])('rejects %s', async (_label, body) => {
    const res = await request(app).post('/api/payments').set(auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(db.paymentEvent.create).not.toHaveBeenCalled();
    expect(db.payment.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/payments', () => {
  it('paginates newest-paid-first and scopes to the business', async () => {
    db.payment.count.mockResolvedValue(3);
    db.payment.findMany.mockResolvedValue([makePayment()]);
    const res = await request(app).get('/api/payments').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    const args = db.payment.findMany.mock.calls[0]![0];
    expect(args.where.businessId).toBe('biz_1');
    expect(args.orderBy).toEqual([{ paidAt: 'desc' }, { id: 'desc' }]);
  });

  it('supports the "needs review" queue filter and provider/search filters', async () => {
    db.payment.count.mockResolvedValue(0);
    db.payment.findMany.mockResolvedValue([]);
    await request(app).get('/api/payments').query({ status: 'unmatched,suggested', provider: 'mpesa', search: '0712' }).set(auth);
    const where = db.payment.findMany.mock.calls[0]![0].where;
    expect(where.status).toEqual({ in: ['UNMATCHED', 'SUGGESTED'] });
    expect(where.provider).toEqual({ in: ['MPESA'] });
    expect(where.OR).toHaveLength(4);
  });

  it.each([
    ['unknown status', { status: 'BOGUS' }],
    ['unknown provider', { provider: 'PAYPAL' }],
    ['pageSize too large', { pageSize: 1000 }],
  ])('rejects %s', async (_label, query) => {
    expect((await request(app).get('/api/payments').query(query).set(auth)).status).toBe(400);
  });
});

describe('GET /api/payments/:id', () => {
  it('looks up by id AND businessId, with its allocations', async () => {
    db.payment.findFirst.mockResolvedValue(makePayment({ allocations: [] }));
    const res = await request(app).get('/api/payments/pay_1').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.allocations).toEqual([]);
    expect(db.payment.findFirst.mock.calls[0]![0].where).toEqual({ id: 'pay_1', businessId: 'biz_1' });
  });

  it("404s for another business's payment", async () => {
    db.payment.findFirst.mockResolvedValue(null);
    expect((await request(app).get('/api/payments/foreign').set(auth)).status).toBe(404);
  });
});
