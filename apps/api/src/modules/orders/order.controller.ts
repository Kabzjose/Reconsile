import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { getValidatedQuery } from '../../middleware/validate';
import type { ListOrdersQuery } from './order.schemas';
import * as orderService from './order.service';

export async function create(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.status(201).json({ data: await orderService.createOrder(businessId, req.body) });
}

export async function list(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json(await orderService.listOrders(businessId, getValidatedQuery<ListOrdersQuery>(res)));
}

export async function get(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await orderService.getOrder(businessId, String(req.params.id)) });
}

export async function cancel(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await orderService.cancelOrder(businessId, String(req.params.id)) });
}

export async function dispute(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await orderService.disputeOrder(businessId, String(req.params.id), req.body.note) });
}

export async function resolveDispute(req: Request, res: Response) {
  const { businessId } = requireAuth(req);
  res.json({ data: await orderService.resolveOrderDispute(businessId, String(req.params.id)) });
}
