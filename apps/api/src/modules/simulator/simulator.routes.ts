import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { validateBody } from '../../middleware/validate';
import { NotFoundError } from '../../shared/errors';
import { SCENARIOS, runScenario, sendSimulatedWebhook, type ScenarioName } from './simulator.service';

export const simulatorRouter = Router();

// Off in a real deployment (ENABLE_SIMULATOR=false): it can inject payments on the owner's behalf.
const requireEnabled: RequestHandler = (_req, _res, next) => {
  if (!env.ENABLE_SIMULATOR) throw new NotFoundError('Route not found');
  next();
};
simulatorRouter.use(requireEnabled, authenticate);

const customPaymentSchema = z.object({
  amountKes: z.number().positive().max(10_000_000),
  reference: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  provider: z.enum(['MPESA', 'BANK', 'STRIPE']).optional(),
  sendTwice: z.boolean().optional(), // deliver the same transaction twice, like a provider retry
});

simulatorRouter.post('/payments', validateBody(customPaymentSchema), async (req, res) => {
  const { businessId } = requireAuth(req);
  const { sendTwice, ...payment } = req.body as z.infer<typeof customPaymentSchema>;
  res.json({ data: { sent: await sendSimulatedWebhook(businessId, payment, sendTwice ? 2 : 1) } });
});

simulatorRouter.post('/scenarios/:name', async (req, res) => {
  const { businessId } = requireAuth(req);
  const name = String(req.params.name).toUpperCase();
  if (!SCENARIOS.includes(name as ScenarioName)) throw new NotFoundError(`Unknown scenario. Try: ${SCENARIOS.join(', ')}`);
  res.json({ data: await runScenario(businessId, name as ScenarioName) });
});
