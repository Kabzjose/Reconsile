import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { getValidatedQuery } from '../../middleware/validate';
import type { ListPaymentsQuery } from './payment.schemas';
import * as paymentService from './payment.service';

export async function create(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  const { data, duplicate, reconciliation } = await paymentService.createPayment(businessId, req.body);
  // 201 = newly recorded, 200 = we already had it (idempotent replay).
  res.status(duplicate ? 200 : 201).json({ data, duplicate, reconciliation });
}

export async function list(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json(await paymentService.listPayments(businessId, getValidatedQuery<ListPaymentsQuery>(res)));
}

export async function get(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await paymentService.getPayment(businessId, String(req.params.id)) });
}

export async function dispute(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await paymentService.disputePayment(businessId, String(req.params.id), req.body.note) });
}

export async function resolveDispute(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await paymentService.resolvePaymentDispute(businessId, String(req.params.id)) });
}
