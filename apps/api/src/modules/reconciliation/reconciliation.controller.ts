import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError } from '../../shared/errors';
import * as paymentService from '../payments/payment.service';
import * as reconciliation from './reconciliation.service';

async function paymentIdOfAllocation(businessId: string, allocationId: string) {
  const allocation = await prisma.allocation.findFirst({ where: { id: allocationId, businessId }, select: { paymentId: true } });
  if (!allocation) throw new NotFoundError('Allocation not found');
  return allocation.paymentId;
}

export async function confirm(req: Request, res: Response) {
  const { businessId, userId } = requireAuth(req);
  const allocation = await reconciliation.confirmSuggestion(businessId, userId, String(req.params.id), req.body?.amountCents);
  res.json({ data: await paymentService.getPayment(businessId, allocation.paymentId) });
}

export async function voidIt(req: Request, res: Response) {
  const { businessId, userId } = requireAuth(req);
  const paymentId = await paymentIdOfAllocation(businessId, String(req.params.id));
  await reconciliation.voidAllocation(businessId, userId, String(req.params.id), req.body?.reason);
  res.json({ data: await paymentService.getPayment(businessId, paymentId) });
}

export async function runAll(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await reconciliation.reconcileWaitingPayments(businessId) });
}

// Payment-scoped actions (mounted under /api/payments/:id in payment.routes.ts)

export async function reconcileOne(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  const paymentId = String(req.params.id);
  const result = await reconciliation.reconcilePayment(businessId, paymentId);
  res.json({ data: await paymentService.getPayment(businessId, paymentId), reconciliation: result });
}

export async function allocate(req: Request, res: Response) {
  const { businessId, userId } = requireAuth(req);
  const paymentId = String(req.params.id);
  await reconciliation.allocateManually(businessId, userId, paymentId, req.body.orderId, req.body.amountCents);
  res.status(201).json({ data: await paymentService.getPayment(businessId, paymentId) });
}
