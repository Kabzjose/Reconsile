import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../src/shared/errors';
import { signToken, verifyToken } from '../src/shared/security/jwt';
import { hashPassword, verifyPassword } from '../src/shared/security/password';

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('salts: hashing the same password twice gives different hashes', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'));
  });
});

describe('JWT', () => {
  it('round-trips user and business ids', () => {
    const token = signToken({ userId: 'user_1', businessId: 'biz_1' });
    expect(verifyToken(token)).toEqual({ userId: 'user_1', businessId: 'biz_1' });
  });

  it('rejects a tampered token', () => {
    const token = signToken({ userId: 'user_1', businessId: 'biz_1' });
    expect(() => verifyToken(token.slice(0, -2) + 'xx')).toThrow(UnauthorizedError);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ bid: 'biz_1' }, 'some-other-secret-some-other-secret-00', { subject: 'user_1' });
    expect(() => verifyToken(forged)).toThrow(UnauthorizedError);
  });

  it('rejects an unsigned (alg: none) token', () => {
    const unsigned = jwt.sign({ bid: 'biz_1' }, '', { algorithm: 'none', subject: 'user_1' });
    expect(() => verifyToken(unsigned)).toThrow(UnauthorizedError);
  });

  it('reports expiry with a distinct code', () => {
    const expired = jwt.sign({ bid: 'biz_1' }, process.env.JWT_SECRET!, { subject: 'user_1', expiresIn: -10 });
    try {
      verifyToken(expired);
      expect.unreachable();
    } catch (error) {
      expect((error as UnauthorizedError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects a valid signature with missing claims', () => {
    const noBusiness = jwt.sign({}, process.env.JWT_SECRET!, { subject: 'user_1' });
    expect(() => verifyToken(noBusiness)).toThrow(UnauthorizedError);
  });
});
