import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/infrastructure/database/prisma';
import { hashPassword } from '../src/shared/security/password';
import { signToken, verifyToken } from '../src/shared/security/jwt';

// The database is replaced by stubs: these tests check HTTP behaviour (validation, auth,
// status codes, error shape) without needing PostgreSQL running.
vi.mock('../src/infrastructure/database/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    business: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const db = {
  findUser: prisma.user.findUnique as unknown as Mock,
  createBusiness: prisma.business.create as unknown as Mock,
  queryRaw: prisma.$queryRaw as unknown as Mock,
};

const app = createApp();

beforeEach(() => {
  vi.resetAllMocks();
});

describe('HTTP foundation', () => {
  it('GET /health returns ok and an X-Request-Id header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('echoes a client-supplied X-Request-Id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('unknown routes return a JSON 404 in the standard error shape', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /api/auth/register validation', () => {
  it('rejects a bad body with per-field details', async () => {
    const res = await request(app).post('/api/auth/register').send({ businessName: 'A', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['businessName', 'email', 'password']);
  });

  it('rejects an empty request', async () => {
    const res = await request(app).post('/api/auth/register');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects passwords over 72 characters (bcrypt limit)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ businessName: 'Mama Njeri Shop', email: 'a@b.co', password: 'x'.repeat(73) });
    expect(res.status).toBe(400);
  });
});

describe('authentication guard', () => {
  it('GET /api/auth/me without a token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('POST /api/auth/register', () => {
  const body = { businessName: 'Mama Njeri Shop', email: '  Njeri@Shop.CO.KE ', password: 'a-good-password' };

  it('creates the account, normalises the email and returns a token (no secrets leaked)', async () => {
    db.createBusiness.mockResolvedValue({
      id: 'biz_1',
      name: 'Mama Njeri Shop',
      webhookSecret: 'super-secret',
      users: [{ id: 'user_1', email: 'njeri@shop.co.ke', passwordHash: 'hash' }],
    });

    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(201);
    expect(verifyToken(res.body.token)).toEqual({ userId: 'user_1', businessId: 'biz_1' });
    expect(res.body.user).toEqual({ id: 'user_1', email: 'njeri@shop.co.ke' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|webhookSecret|super-secret/);

    // The email reaching the database was trimmed + lower-cased, and the password was hashed.
    const data = db.createBusiness.mock.calls[0]![0].data;
    expect(data.users.create.email).toBe('njeri@shop.co.ke');
    expect(data.users.create.passwordHash).not.toBe('a-good-password');
  });

  it('returns 409 when the email is already registered', async () => {
    db.createBusiness.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for correct credentials', async () => {
    db.findUser.mockResolvedValue({
      id: 'user_1',
      email: 'njeri@shop.co.ke',
      businessId: 'biz_1',
      passwordHash: await hashPassword('a-good-password'),
      business: { id: 'biz_1', name: 'Mama Njeri Shop' },
    });
    const res = await request(app).post('/api/auth/login').send({ email: 'njeri@shop.co.ke', password: 'a-good-password' });
    expect(res.status).toBe(200);
    expect(verifyToken(res.body.token).businessId).toBe('biz_1');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('gives the SAME error for a wrong password and an unknown email', async () => {
    db.findUser.mockResolvedValueOnce({
      id: 'user_1',
      email: 'njeri@shop.co.ke',
      businessId: 'biz_1',
      passwordHash: await hashPassword('a-good-password'),
      business: { id: 'biz_1', name: 'x' },
    });
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'njeri@shop.co.ke', password: 'not-the-password' });

    db.findUser.mockResolvedValueOnce(null);
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'ghost@shop.co.ke', password: 'whatever-password' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid email or password');
    }
  });
});

describe('GET /api/auth/me', () => {
  it('returns the profile for a valid token', async () => {
    db.findUser.mockResolvedValue({ id: 'user_1', email: 'njeri@shop.co.ke', business: { id: 'biz_1', name: 'Mama Njeri Shop' } });
    const token = signToken({ userId: 'user_1', businessId: 'biz_1' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.business.name).toBe('Mama Njeri Shop');
  });

  it('returns 401 when the token is valid but the account no longer exists', async () => {
    db.findUser.mockResolvedValue(null);
    const token = signToken({ userId: 'deleted', businessId: 'biz_1' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('failure handling', () => {
  it('hides internal error details from the client', async () => {
    db.findUser.mockRejectedValue(new Error('connection refused at 10.0.0.5:5432 password=hunter2'));
    const token = signToken({ userId: 'user_1', businessId: 'biz_1' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|10\.0\.0\.5/);
  });

  it('GET /health/ready returns 503 when the database is unreachable', async () => {
    db.queryRaw.mockRejectedValue(new Error('down'));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
  });

  it('GET /health/ready returns 200 when the database answers', async () => {
    db.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
  });
});
