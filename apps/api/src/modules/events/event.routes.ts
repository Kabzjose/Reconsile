import { Router } from 'express';
import { z } from 'zod';
import { EventOutcome } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { getValidatedQuery, validateQuery } from '../../middleware/validate';

// The audit trail of everything that arrived: webhooks, imports, manual entries, including
// the ones that were duplicates or malformed.

const querySchema = z.object({
  outcome: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((part) => part.trim().toUpperCase()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(EventOutcome)).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const eventRouter = Router();
eventRouter.use(authenticate);

eventRouter.get('/', validateQuery(querySchema), async (req, res) => {
  const { businessId } = requireAuth(req);
  const { outcome, page, pageSize } = getValidatedQuery<z.infer<typeof querySchema>>(res);
  const where = { businessId, ...(outcome?.length ? { outcome: { in: outcome } } : {}) };

  const [total, rows] = await prisma.$transaction([
    prisma.paymentEvent.count({ where }),
    prisma.paymentEvent.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { payment: { select: { id: true, amountCents: true, status: true } } },
    }),
  ]);

  res.json({
    data: rows.map((event) => ({
      id: event.id,
      provider: event.provider,
      source: event.source,
      outcome: event.outcome,
      externalReference: event.externalReference,
      error: event.error,
      rawPayload: event.rawPayload,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      batchId: event.batchId,
      payment: event.payment,
    })),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});
