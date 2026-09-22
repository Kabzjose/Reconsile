import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { ValidationError } from '../shared/errors';

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Validates req.body against a Zod schema. On success, req.body is replaced with the
 * parsed result (trimmed, lower-cased, coerced, unknown keys stripped), so handlers
 * only ever see clean data.
 */
export const validateBody =
  (schema: z.ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Invalid request body', formatZodIssues(result.error));
    }
    req.body = result.data;
    next();
  };

/**
 * Validates req.query. Express 5 makes req.query read-only, so the parsed result is stored on
 * res.locals.query; read it back with getValidatedQuery<T>(res).
 */
export const validateQuery =
  (schema: z.ZodType): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new ValidationError('Invalid query parameters', formatZodIssues(result.error));
    }
    res.locals.query = result.data;
    next();
  };

export function getValidatedQuery<T>(res: Response): T {
  return res.locals.query as T;
}
