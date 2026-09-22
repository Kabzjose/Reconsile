import type { EventSource, Payment, Prisma, Provider } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/logging/logger';
import { ConflictError } from '../../shared/errors';

/**
 * THE single entry point for turning "a payment arrived" into a Payment row.
 * The manual API, the webhook (Phase 6) and the CSV import (Phase 7) all call this,
 * so idempotency and auditing are implemented exactly once.
 *
 *   1. Store the raw event FIRST, in its own commit. If anything below fails, the event
 *      is still on record (outcome FAILED) and can be replayed.
 *   2. Create the payment and mark the event PROCESSED in ONE transaction.
 *   3. If the unique constraint (businessId, provider, externalReference) rejects the
 *      insert, it's a duplicate: record it and return the original payment.
 *
 * Step 3 relies on the database, not on a check-then-insert: two identical webhooks arriving
 * at the same instant can both pass a "does it exist?" check, but only one can win the INSERT.
 */

export interface IngestPaymentData {
  businessId: string;
  provider: Provider;
  externalReference: string;
  billReference?: string;
  amountCents: number;
  payerPhone?: string;
  payerName?: string;
  paidAt: Date;
  metadata?: Record<string, unknown>;
}

export interface IngestContext {
  source: EventSource;
  /** The payload exactly as received (or as close to it as we have). */
  rawPayload: Prisma.InputJsonValue;
  /** Groups the rows of one CSV import. */
  batchId?: string;
}

export interface IngestResult {
  payment: Payment;
  duplicate: boolean;
}

export interface RecordEventInput {
  businessId: string;
  provider: Provider;
  source: EventSource;
  batchId?: string;
  externalReference?: string;
  rawPayload: Prisma.InputJsonValue;
}

/** Step 1: put the raw event on record, in its own commit, before anything can fail. Returns the event id. */
export async function recordEvent(input: RecordEventInput): Promise<string> {
  const event = await prisma.paymentEvent.create({
    data: {
      businessId: input.businessId,
      provider: input.provider,
      source: input.source,
      batchId: input.batchId,
      externalReference: input.externalReference,
      rawPayload: input.rawPayload,
      outcome: 'RECEIVED',
    },
    select: { id: true },
  });
  return event.id;
}

/** For events that arrived but can't become a payment (bad shape, unsupported type). Kept for debugging. */
export async function markEventInvalid(eventId: string, message: string) {
  await prisma.paymentEvent.update({
    where: { id: eventId },
    data: { outcome: 'INVALID', error: message.slice(0, 500), processedAt: new Date() },
  });
}

/** Steps 2 and 3: create the payment (or recognise the duplicate) for an already-recorded event. */
export async function processEvent(eventId: string, data: IngestPaymentData): Promise<IngestResult> {
  const { businessId, provider, externalReference } = data;

  try {
    // 2. Process atomically.
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          businessId,
          provider,
          externalReference,
          billReference: data.billReference,
          amountCents: data.amountCents,
          payerPhone: data.payerPhone,
          payerName: data.payerName,
          paidAt: data.paidAt,
          metadata: data.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.paymentEvent.update({
        where: { id: eventId },
        data: { paymentId: created.id, outcome: 'PROCESSED', processedAt: new Date() },
      });
      return created;
    });

    // Reconciliation is triggered by the caller AFTER this returns (see payment.receive.ts):
    // receiving a payment and matching it to a sale are deliberately separate steps.
    return { payment, duplicate: false };
  } catch (error) {
    // 3. Duplicate?
    if (error instanceof PrismaNs.PrismaClientKnownRequestError && error.code === 'P2002') {
      return resolveDuplicate(data, eventId);
    }

    await prisma.paymentEvent
      .update({
        where: { id: eventId },
        data: { outcome: 'FAILED', error: errorMessage(error), processedAt: new Date() },
      })
      .catch((updateError) => logger.error({ err: updateError, eventId }, 'Could not mark event as FAILED'));
    throw error;
  }
}

/** Store first, then process. The path used when the payload is already known to be valid. */
export async function ingestPayment(data: IngestPaymentData, context: IngestContext): Promise<IngestResult> {
  const eventId = await recordEvent({
    businessId: data.businessId,
    provider: data.provider,
    source: context.source,
    batchId: context.batchId,
    externalReference: data.externalReference,
    rawPayload: context.rawPayload,
  });
  return processEvent(eventId, data);
}

async function resolveDuplicate(data: IngestPaymentData, eventId: string): Promise<IngestResult> {
  const existing = await prisma.payment.findUnique({
    where: {
      businessId_provider_externalReference: {
        businessId: data.businessId,
        provider: data.provider,
        externalReference: data.externalReference,
      },
    },
  });
  // The unique violation says it exists; if it vanished, something is badly wrong.
  if (!existing) throw new Error('Unique violation reported but the payment could not be found');

  // Same transaction id but a different amount is not a harmless retry: it's a data problem
  // (or fraud). Don't answer "OK, already have it"; flag it.
  const sameAmount = existing.amountCents === data.amountCents;

  await prisma.paymentEvent.update({
    where: { id: eventId },
    data: {
      paymentId: existing.id,
      outcome: 'DUPLICATE',
      processedAt: new Date(),
      error: sameAmount ? null : `Amount mismatch: stored ${existing.amountCents}, received ${data.amountCents}`,
    },
  });

  if (!sameAmount) {
    throw new ConflictError('A payment with this transaction reference already exists with a different amount');
  }
  return { payment: existing, duplicate: true };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
