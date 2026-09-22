import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { getValidatedQuery, validateQuery } from '../../middleware/validate';
import { getSummary } from './dashboard.service';

const querySchema = z.object({ range: z.enum(['today', '7d', '30d', 'all']).default('7d') });

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/summary', validateQuery(querySchema), async (req, res) => {
  const { businessId } = requireAuth(req);
  res.json({ data: await getSummary(businessId, getValidatedQuery<z.infer<typeof querySchema>>(res).range) });
});
