import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { UnauthorizedError } from '../errors';

export interface AuthContext {
  userId: string;
  businessId: string;
}

// Claims we put in the token: sub = user id, bid = business id.
const claimsSchema = z.object({ sub: z.string().min(1), bid: z.string().min(1) });

export function signToken(context: AuthContext): string {
  return jwt.sign({ bid: context.businessId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: context.userId,
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  });
}

export function verifyToken(token: string): AuthContext {
  try {
    // Pin the algorithm so a forged "alg: none" token can never verify.
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const claims = claimsSchema.parse(payload);
    return { userId: claims.sub, businessId: claims.bid };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
  }
}
