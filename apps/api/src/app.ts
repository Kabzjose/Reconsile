import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { requestLogger } from './middleware/requestLogger';
import { authRouter } from './modules/auth/auth.routes';
import { businessRouter } from './modules/business/business.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { eventRouter } from './modules/events/event.routes';
import { healthRouter } from './modules/health/health.routes';
import { importRouter } from './modules/imports/import.routes';
import { orderRouter } from './modules/orders/order.routes';
import { paymentRouter } from './modules/payments/payment.routes';
import { allocationRouter, reconciliationRouter } from './modules/reconciliation/reconciliation.routes';
import { simulatorRouter } from './modules/simulator/simulator.routes';
import { webhookRouter } from './modules/webhooks/webhook.routes';

// Built by a function (not a module-level singleton) so tests can create fresh apps.
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind Render/Railway/Fly there is one proxy in front of us; needed for correct client IPs later.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

  // Order matters: log first, then security headers, CORS, body parsing, routes, and errors last.
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));

  // These two parse their own bodies (raw bytes for signature checking; a larger limit for CSV
  // uploads), so they are mounted before the global JSON parser.
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/imports', importRouter);

  app.use(express.json({ limit: '1mb' }));

  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/business', businessRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/allocations', allocationRouter);
  app.use('/api/reconciliation', reconciliationRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/events', eventRouter);
  app.use('/api/simulator', simulatorRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
