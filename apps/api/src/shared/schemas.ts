import { z } from 'zod';

// Money crosses the API as integer cents (KSh 2,500 = 250000).
// The cap keeps values inside PostgreSQL's 32-bit INT column; without it, a huge number
// would pass validation and then crash the query with a 500.
export const MAX_AMOUNT_CENTS = 1_000_000_000; // KSh 10,000,000

export const amountCentsSchema = z
  .number({ error: 'amountCents must be a number' })
  .int('amountCents must be a whole number of cents')
  .positive('Amount must be greater than zero')
  .max(MAX_AMOUNT_CENTS, 'Amount is too large');

/**
 * Canonical form for storing an account reference: trimmed, single-spaced, upper-case.
 * Orders and payments MUST both go through this, or "ord-1042" will never equal "ORD-1042".
 */
export function normalizeReference(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Loose comparison key for the matching engine (Phase 7): letters and digits only.
 * "ORD-1042", "ord 1042" and "ORD1042" all become "ORD1042", because real payers
 * type account numbers however they like.
 */
export function referenceKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
