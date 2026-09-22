import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../infrastructure/logging/logger';
import { AppError } from '../shared/errors';
import { formatZodIssues } from './validate';

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

function normalize(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof ZodError) {
    return { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Validation failed', details: formatZodIssues(err) };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': // unique constraint violated
        return { statusCode: 409, code: 'CONFLICT', message: 'Resource already exists' };
      case 'P2025': // record required but not found
        return { statusCode: 404, code: 'NOT_FOUND', message: 'Resource not found' };
      case 'P2003': // foreign key violated
        return { statusCode: 409, code: 'CONFLICT', message: 'Related resource is missing or in use' };
    }
  }

  // Errors raised by Express itself (bad JSON, body too large, ...) carry an HTTP status.
  const http = err as HttpLikeError;
  const status = http?.status ?? http?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500 && http.expose) {
    if (http.type === 'entity.parse.failed') {
      return { statusCode: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
    }
    if (http.type === 'entity.too.large') {
      return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    }
    return { statusCode: status, code: 'BAD_REQUEST', message: 'Bad request' };
  }

  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

// Express recognises an error handler by its 4 parameters — keep `_next` even though it's unused.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const normalized = normalize(err);

  if (normalized.statusCode >= 500) {
    // Only unexpected failures get a stack trace in the logs. The client never sees it.
    (req.log ?? logger).error({ err }, 'Unhandled error');
  }

  res.status(normalized.statusCode).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      requestId: req.id,
    },
  });
};
