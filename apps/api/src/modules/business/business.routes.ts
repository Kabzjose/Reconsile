import { Router } from 'express';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import * as businessService from './business.service';

export const businessRouter = Router();
businessRouter.use(authenticate);

businessRouter.get('/', async (req, res) => {
  res.json({ data: await businessService.getBusiness(requireAuth(req).businessId) });
});

businessRouter.post('/webhook-secret/rotate', async (req, res) => {
  res.json({ data: await businessService.rotateWebhookSecret(requireAuth(req).businessId) });
});
