import type { PaymentStatus } from '@prisma/client';

/** How much of the payment has been allocated decides its status (DISPUTED is set by people). */
export function derivePaymentStatus(amountCents: number, allocatedCents: number): 'UNMATCHED' | 'PARTIAL' | 'MATCHED' {
  if (allocatedCents <= 0) return 'UNMATCHED';
  if (allocatedCents >= amountCents) return 'MATCHED';
  return 'PARTIAL';
}

export const PAYMENT_DISPUTABLE: PaymentStatus[] = ['UNMATCHED', 'SUGGESTED', 'PARTIAL', 'MATCHED'];

/** Payments that still need a human: nothing matched, a suggestion waiting, or money left over. */
export const NEEDS_REVIEW: PaymentStatus[] = ['UNMATCHED', 'SUGGESTED', 'PARTIAL'];
