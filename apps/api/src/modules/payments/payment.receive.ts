import type { Payment } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/logging/logger';
import { reconcilePayment, type ReconcileResult } from '../reconciliation/reconciliation.service';
import { ingestPayment, processEvent, type IngestContext, type IngestPaymentData } from './payment.ingest';

export interface ReceiveResult {
  payment: Payment;
  duplicate: boolean;
  /** null for duplicates (already reconciled the first time). */
  reconciliation: ReconcileResult | null;
}

/**
 * After a payment is safely stored, try to match it. A matching failure must never fail or lose
 * the payment: it just stays in the review queue, and the error is logged.
 */
export async function reconcileAfterIngest(
  businessId: string,
  ingested: { payment: Payment; duplicate: boolean },
): Promise<ReceiveResult> {
  if (ingested.duplicate) return { ...ingested, reconciliation: null };

  let reconciliation: ReconcileResult | null = null;
  try {
    reconciliation = await reconcilePayment(businessId, ingested.payment.id);
  } catch (error) {
    logger.error({ err: error, paymentId: ingested.payment.id }, 'Reconciliation failed; payment left for review');
  }

  // Re-read (scoped by business, like every other query) so the caller sees the status the engine just set.
  const fresh = await prisma.payment.findFirst({ where: { id: ingested.payment.id, businessId } });
  return { payment: fresh ?? ingested.payment, duplicate: false, reconciliation };
}

/** Manual entry, CSV rows: store, then reconcile. */
export async function receivePayment(data: IngestPaymentData, context: IngestContext): Promise<ReceiveResult> {
  return reconcileAfterIngest(data.businessId, await ingestPayment(data, context));
}

/** Webhooks: the event was already recorded (so invalid payloads are kept), now process and reconcile it. */
export async function receiveRecordedEvent(eventId: string, data: IngestPaymentData): Promise<ReceiveResult> {
  return reconcileAfterIngest(data.businessId, await processEvent(eventId, data));
}
