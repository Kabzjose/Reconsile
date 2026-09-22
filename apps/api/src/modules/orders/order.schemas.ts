import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { amountCentsSchema, normalizeReference } from '../../shared/schemas';

export const orderStatus = z.enum(OrderStatus);

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1).optional(),
  // Stored upper-case so payer-typed references match regardless of case.
  reference: z
    .string()
    .trim()
    .min(1, 'Order reference is required')
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/, 'Use letters, numbers and - _ / . only')
    .transform(normalizeReference),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || undefined)
    .optional(),
  amountCents: amountCentsSchema,
});

export const disputeSchema = z.object({
  note: z.string().trim().min(3, 'Explain the dispute in a few words').max(500),
});

// ?status=UNPAID,PARTIAL  (comma-separated, case-insensitive)
const statusList = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(',')
          .map((part) => part.trim().toUpperCase())
          .filter(Boolean)
      : undefined,
  )
  .pipe(z.array(orderStatus).optional());

export const listOrdersQuerySchema = z.object({
  status: statusList,
  search: z.string().trim().max(50).optional(), // matches reference or customer name
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
