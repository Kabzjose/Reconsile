import { z } from 'zod';
import { normalizeKenyanPhone } from '../../shared/phone';
import { MAX_AMOUNT_CENTS, normalizeReference } from '../../shared/schemas';

/**
 * The event a payment provider (or our gateway) POSTs to us.
 *
 *   { "event": "payment.completed", "provider": "MPESA", "transactionId": "QWE123",
 *     "amount": 2500, "phone": "254712345678", "reference": "ORD-1042" }
 *
 * `amount` is in Kenyan shillings (2500 or 2500.50), because that's how providers report it.
 * We convert to integer cents at the edge and never touch floats again.
 */
export const webhookPayloadSchema = z.object({
  event: z.string().min(1),
  provider: z.enum(['MPESA', 'BANK', 'STRIPE']),
  transactionId: z.string().trim().min(1).max(200),
  amount: z.number({ error: 'amount must be a number (in KES)' }).positive('amount must be greater than zero'),
  currency: z.literal('KES').optional(),
  phone: z.string().trim().max(40).optional(),
  name: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(100).optional(), // what the payer typed as the account number
  paidAt: z.coerce.date().optional(), // when the payer paid; defaults to when we received the event
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/** KES -> integer cents, rejecting anything with sub-cent precision or outside our limits. */
export function kesToCents(amount: number): number | null {
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-6) return null;
  if (cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/** Turns a validated webhook payload into the shape `processEvent` takes. */
export function toIngestData(businessId: string, payload: WebhookPayload, receivedAt: Date) {
  const amountCents = kesToCents(payload.amount);
  if (amountCents === null) return null;

  // Phones from real statements are often masked ("2547****123"). Keep the raw text as evidence instead of rejecting.
  const payerPhone = payload.phone ? normalizeKenyanPhone(payload.phone) : null;
  const paidAt = payload.paidAt ?? receivedAt;

  return {
    businessId,
    provider: payload.provider,
    externalReference: payload.transactionId,
    billReference: payload.reference ? normalizeReference(payload.reference) || undefined : undefined,
    amountCents,
    payerPhone: payerPhone ?? undefined,
    payerName: payload.name,
    paidAt,
    metadata: payload.phone && !payerPhone ? { payerPhoneRaw: payload.phone } : undefined,
  };
}
