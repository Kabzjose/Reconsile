import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../shared/errors';
import { verifyToken, type AuthContext } from '../shared/security/jwt';

/** Protects a route. Expects `Authorization: Bearer <token>`. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  req.auth = verifyToken(header.slice('Bearer '.length).trim());
  next();
};

/**
 * Use inside handlers on authenticated routes to get the caller's identity without `!`.
 * Every database query in later phases starts from `requireAuth(req).businessId`.
 */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
