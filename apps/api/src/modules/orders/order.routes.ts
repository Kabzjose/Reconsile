import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateBody, validateQuery } from '../../middleware/validate';
import * as orderController from './order.controller';
import { createOrderSchema, disputeSchema, listOrdersQuerySchema } from './order.schemas';

export const orderRouter = Router();

orderRouter.use(authenticate);
orderRouter.post('/', validateBody(createOrderSchema), orderController.create);
orderRouter.get('/', validateQuery(listOrdersQuerySchema), orderController.list);
orderRouter.get('/:id', orderController.get);
orderRouter.post('/:id/cancel', orderController.cancel);
orderRouter.post('/:id/dispute', validateBody(disputeSchema), orderController.dispute);
orderRouter.post('/:id/resolve-dispute', orderController.resolveDispute);
// There is deliberately no DELETE: financial records are cancelled, never erased.
