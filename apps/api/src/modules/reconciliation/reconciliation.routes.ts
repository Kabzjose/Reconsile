import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validateBody } from '../../middleware/validate';
import * as controller from './reconciliation.controller';
import { confirmSchema, voidSchema } from './reconciliation.schemas';

/** /api/allocations */
export const allocationRouter = Router();
allocationRouter.use(authenticate);
allocationRouter.post('/:id/confirm', validateBody(confirmSchema), controller.confirm);
allocationRouter.post('/:id/void', validateBody(voidSchema), controller.voidIt);
// There is deliberately no PATCH or DELETE: allocations are never edited or erased.

/** /api/reconciliation */
export const reconciliationRouter = Router();
reconciliationRouter.use(authenticate);
reconciliationRouter.post('/run', controller.runAll);
