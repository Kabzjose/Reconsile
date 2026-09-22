import express, { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { validateBody } from '../../middleware/validate';
import { buildSampleStatement, importPayments } from './import.service';

export const importRouter = Router();

// Authenticate BEFORE parsing a large body, so anonymous callers can't make us buffer megabytes.
importRouter.use(authenticate);

const importSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(5_000_000, 'The file is larger than 5 MB'),
  provider: z.enum(['MPESA', 'BANK']).default('MPESA'),
});

importRouter.post('/payments', express.json({ limit: '6mb' }), validateBody(importSchema), async (req, res) => {
  const { businessId } = requireAuth(req);
  res.json({ data: await importPayments(businessId, req.body.csv, req.body.provider) });
});

importRouter.get('/sample', async (req, res) => {
  const { businessId } = requireAuth(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sample-mpesa-statement.csv"');
  res.send(await buildSampleStatement(businessId));
});
