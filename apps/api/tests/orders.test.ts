import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/infrastructure/database/prisma';
import { signToken } from '../src/shared/security/jwt';

vi.mock('../src/infrastructure/database/prisma', () => ({
  prisma: {
    order: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    customer: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const db = prisma as unknown as {
  order: Record<'findFirst' | 'findMany' | 'count' | 'create', Mock>;
  customer: { findFirst: Mock };
  $transaction: Mock;
};

const app = createApp();
const auth = { Authorization: `Bearer ${signToken({ userId: 'user_1', businessId: 'biz_1' })}` };

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'ord_1',
  businessId: 'biz_1',
  customerId: null,
  reference: 'ORD-1042',
  description: null,
  amountCents: 250000,
  allocatedCents: 0,
  status: 'UNPAID',
  disputeNote: null,
  createdAt: new Date('2026-09-21T10:31:00Z'),
  updatedAt: new Date('2026-09-21T10:31:00Z'),
  customer: null,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(db)));
});

describe('authentication', () => {
  it.each([
    ['get', '/api/orders'],
    ['post', '/api/orders'],
    ['get', '/api/orders/ord_1'],
  ] as const)('%s %s requires a token', async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });
});

describe('POST /api/orders', () => {
  it('creates an order scoped to the token business, ignoring spoofed fields, and hides internals', async () => {
    db.order.create.mockResolvedValue(makeOrder());

    const res = await request(app)
      .post('/api/orders')
      .set(auth)
      .send({ reference: ' ord-1042 ', amountCents: 250000, businessId: 'evil', status: 'PAID', allocatedCents: 250000 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ reference: 'ORD-1042', status: 'UNPAID', balanceCents: 250000 });
    expect(res.body.data.businessId).toBeUndefined();

    const data = db.order.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ businessId: 'biz_1', reference: 'ORD-1042' }); // trimmed + upper-cased
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('allocatedCents');
  });

  it("refuses a customerId from another business (lookup is scoped, so it's simply not found)", async () => {
    db.customer.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/orders').set(auth).send({ reference: 'A1', amountCents: 100, customerId: 'foreign_customer' });
    expect(res.status).toBe(404);
    expect(db.customer.findFirst.mock.calls[0]![0].where).toEqual({ id: 'foreign_customer', businessId: 'biz_1' });
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it.each([
    ['zero amount', { reference: 'A1', amountCents: 0 }],
    ['negative amount', { reference: 'A1', amountCents: -5 }],
    ['fractional cents', { reference: 'A1', amountCents: 10.5 }],
    ['amount as a string', { reference: 'A1', amountCents: '2500' }],
    ['amount beyond the 32-bit column', { reference: 'A1', amountCents: 5_000_000_000 }],
    ['missing reference', { amountCents: 100 }],
    ['reference with spaces', { reference: 'ORD 1', amountCents: 100 }],
  ])('rejects %s with 400 before touching the database', async (_label, body) => {
    const res = await request(app).post('/api/orders').set(auth).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it('returns 409 for a duplicate reference', async () => {
    db.order.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const res = await request(app).post('/api/orders').set(auth).send({ reference: 'ORD-1042', amountCents: 100 });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/orders', () => {
  it('paginates newest-first and scopes to the business', async () => {
    db.order.count.mockResolvedValue(45);
    db.order.findMany.mockResolvedValue([makeOrder()]);

    const res = await request(app).get('/api/orders').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    const args = db.order.findMany.mock.calls[0]![0];
    expect(args.where.businessId).toBe('biz_1');
    expect(args.take).toBe(20);
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(db.order.count.mock.calls[0]![0].where.businessId).toBe('biz_1');
  });

  it('applies status, search, date and paging filters', async () => {
    db.order.count.mockResolvedValue(0);
    db.order.findMany.mockResolvedValue([]);
    await request(app)
      .get('/api/orders')
      .query({ status: 'unpaid, partial', search: 'ord-10', from: '2026-09-01', page: 3, pageSize: 10 })
      .set(auth);
    const args = db.order.findMany.mock.calls[0]![0];
    expect(args.where.status).toEqual({ in: ['UNPAID', 'PARTIAL'] });
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    expect([args.skip, args.take]).toEqual([20, 10]);
  });

  it.each([
    ['unknown status', { status: 'BOGUS' }],
    ['repeated status param (used to be silently ignored)', 'status=UNPAID&status=PAID'],
    ['pageSize too large', { pageSize: 500 }],
    ['page zero', { page: 0 }],
  ])('rejects %s', async (_label, query) => {
    const res = await request(app).get('/api/orders').query(query).set(auth);
    expect(res.status).toBe(400);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders/:id', () => {
  it('returns the order (with its allocations), looked up by id AND businessId', async () => {
    db.order.findFirst.mockResolvedValue(makeOrder({ allocatedCents: 100000, status: 'PARTIAL', allocations: [] }));
    const res = await request(app).get('/api/orders/ord_1').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.balanceCents).toBe(150000);
    expect(res.body.data.allocations).toEqual([]);
    expect(db.order.findFirst.mock.calls[0]![0].where).toEqual({ id: 'ord_1', businessId: 'biz_1' });
  });

  it("404s (not 403) for another business's order, so ids can't be probed", async () => {
    db.order.findFirst.mockResolvedValue(null);
    expect((await request(app).get('/api/orders/foreign').set(auth)).status).toBe(404);
  });
});
