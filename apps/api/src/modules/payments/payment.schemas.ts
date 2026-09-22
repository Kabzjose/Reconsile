import { PaymentStatus, Provider } from '@prisma/client';
import { z } from 'zod';
import { phoneSchema } from '../../shared/phone';
import { amountCentsSchema, normalizeReference } from '../../shared/schemas';

export const provider = z.enum(Provider);
export const paymentStatus = z.enum(PaymentStatus);

// When the PAYER paid. Allow a little clock skew, but reject nonsense (the future, or 1970 from a null).
const paidAt = z.coerce
  .date()
  .refine((date) => date.getTime() <= Date.now() + 5 * 60_000, 'paidAt cannot be in the future')
  .refine((date) => date.getFullYear() >= 2000, 'paidAt is not a plausible date');

export const createPaymentSchema = z
  .object({
    provider,
    // Required for MPESA/BANK/STRIPE (the provider's transaction id). Cash (MANUAL) may omit it: we generate one.
    externalReference: z.string().trim().min(1).max(200).optional(),
    // What the payer typed as the account number. Same canonical form as Order.reference.
    billReference: z
      .string()
      .trim()
      .max(100)
      .transform((value) => normalizeReference(value) || undefined)
      .optional(),
    amountCents: amountCentsSchema,
    payerPhone: phoneSchema.optional(), // normalised to 2547XXXXXXXX
    payerName: z.string().trim().max(200).optional(),
    paidAt,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider !== 'MANUAL' && !value.externalReference) {
      ctx.addIssue({
        code: 'custom',
        path: ['externalReference'],
        message: "externalReference (the provider's transaction id) is required",
      });
    }
  });

// ?status=UNMATCHED,SUGGESTED  (comma-separated, case-insensitive)
const csv = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((part) => part.trim().toUpperCase())
          .filter(Boolean)
      : undefined,
  );

export const listPaymentsQuerySchema = z.object({
  status: csv.pipe(z.array(paymentStatus).optional()), // ?status=UNMATCHED,SUGGESTED is the "needs review" queue
  provider: csv.pipe(z.array(provider).optional()),
  search: z.string().trim().max(50).optional(), // transaction id, account reference, phone or payer name
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const disputeSchema = z.object({
  note: z.string().trim().min(3, 'Explain the dispute in a few words').max(500),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
