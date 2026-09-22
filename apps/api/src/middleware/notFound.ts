import type { RequestHandler } from 'express';
import { NotFoundError } from '../shared/errors';

export const notFound: RequestHandler = (req) => {
  throw new NotFoundError(`Route not found: ${req.method} ${req.path}`);
};
