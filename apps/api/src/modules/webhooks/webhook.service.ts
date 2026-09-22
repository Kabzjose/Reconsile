import type { Prisma, Provider } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { UnauthorizedError } from '../../shared/errors';
import { markEventInvalid, recordEvent } from '../payments/payment.ingest';
import { receiveRecordedEvent } from '../payments/payment.receive';
import { verifySignature } from './webhook.signature';
import { toIngestData, webhookPayloadSchema } from './webhook.schemas';

export interface WebhookResult {
  httpStatus: number;
  body: {
    status: 'processed' | 'duplicate' | 'invalid' | 'ignored';
    paymentId?: string;
    reconciliation?: import('../reconciliation/reconciliation.service').ReconcileResult | null;
    errors?: { path: string; message: string }[];
    event?: string;
  };
}

const KNOWN_PROVIDERS: Provider[] = ['MPESA', 'BANK', 'STRIPE', 'MANUAL'];

/**
 * The whole webhook pipeline. Used by the HTTP route AND by the demo simulator, so the simulator
 * exercises exactly the code a real provider would.
 *
 *   authenticate (signature)  ->  store the raw event  ->  validate  ->  process (idempotent)  ->  reconcile
 *
 * Order matters:
 *  - An unauthenticated request is rejected BEFORE anything is stored, so strangers can't fill the log.
 *  - An authenticated request is stored BEFORE it's validated, so malformed payloads are kept for debugging.
 */
export async function processWebhook(input: {
  businessId: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): Promise<WebhookResult> {
  const { businessId, rawBody, signatureHeader } = input;

  // Unknown business and bad signature look identical, so ids can't be probed.
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, webhookSecret: true } });
  if (!business || !verifySignature(business.webhookSecret, rawBody, signatureHeader)) {
    throw new UnauthorizedError('Invalid webhook signature', 'INVALID_SIGNATURE');
  }

  // Store first.
  const text = rawBody.toString('utf8');
  let parsed: unknown;
  let parseFailed = false;
  try {
    parsed = JSON.parse(text);
  } catch {
    parseFailed = true;
  }

  const guess = (parsed ?? {}) as { provider?: unknown; transactionId?: unknown };
  const provider = KNOWN_PROVIDERS.includes(guess.provider as Provider) ? (guess.provider as Provider) : 'MANUAL'; // the column is required; MANUAL marks "unknown"
  const eventId = await recordEvent({
    businessId,
    provider,
    source: 'WEBHOOK',
    externalReference: typeof guess.transactionId === 'string' ? guess.transactionId.slice(0, 200) : undefined,
    rawPayload: (parseFailed ? { unparseable: text.slice(0, 2000) } : parsed) as Prisma.InputJsonValue,
  });

  if (parseFailed) {
    await markEventInvalid(eventId, 'The body is not valid JSON');
    return { httpStatus: 422, body: { status: 'invalid', errors: [{ path: '', message: 'The body is not valid JSON' }] } };
  }

  const result = webhookPayloadSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    await markEventInvalid(eventId, errors.map((error) => `${error.path || 'body'}: ${error.message}`).join('; '));
    return { httpStatus: 422, body: { status: 'invalid', errors } };
  }

  const payload = result.data;
  if (payload.event !== 'payment.completed') {
    // Providers send many event types. Acknowledge (so they don't retry) but don't act.
    await markEventInvalid(eventId, `Ignored event type: ${payload.event}`);
    return { httpStatus: 200, body: { status: 'ignored', event: payload.event } };
  }

  const data = toIngestData(businessId, payload, new Date());
  if (!data) {
    const message = 'amount must be a positive KES value with at most 2 decimals and below KSh 10,000,000';
    await markEventInvalid(eventId, message);
    return { httpStatus: 422, body: { status: 'invalid', errors: [{ path: 'amount', message }] } };
  }

  // Idempotent processing: a retry of the same transaction returns the original payment.
  const received = await receiveRecordedEvent(eventId, data);

  return {
    httpStatus: 200,
    body: {
      status: received.duplicate ? 'duplicate' : 'processed',
      paymentId: received.payment.id,
      reconciliation: received.reconciliation,
    },
  };
}
