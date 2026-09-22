import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateBody, validateQuery } from '../../middleware/validate';
import * as paymentController from './payment.controller';
import { allocateSchema } from '../reconciliation/reconciliation.schemas';
import * as reconciliationController from '../reconciliation/reconciliation.controller';
import { createPaymentSchema, disputeSchema, listPaymentsQuerySchema } from './payment.schemas';

export const paymentRouter = Router();

paymentRouter.use(authenticate);
paymentRouter.post('/', validateBody(createPaymentSchema), paymentController.create);
paymentRouter.get('/', validateQuery(listPaymentsQuerySchema), paymentController.list);
paymentRouter.get('/:id', paymentController.get);
paymentRouter.post('/:id/reconcile', reconciliationController.reconcileOne);
paymentRouter.post('/:id/allocations', validateBody(allocateSchema), reconciliationController.allocate);
paymentRouter.post('/:id/dispute', validateBody(disputeSchema), paymentController.dispute);
paymentRouter.post('/:id/resolve-dispute', paymentController.resolveDispute);
