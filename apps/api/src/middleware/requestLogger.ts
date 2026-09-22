import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../infrastructure/logging/logger';

// Logs one line per request and attaches `req.log` (a logger that already carries the request id).
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 100 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Health checks fire constantly; keep them out of the logs.
  autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
});
