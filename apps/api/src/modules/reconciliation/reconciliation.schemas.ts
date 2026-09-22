import { z } from 'zod';
import { amountCentsSchema } from '../../shared/schemas';

// Bodies for these endpoints are optional, so an empty POST is valid.
export const allocateSchema = z.object({
  orderId: z.string().trim().min(1, 'orderId is required'),
  amountCents: amountCentsSchema.optional(), // default: as much as fits
});

export const confirmSchema = z
  .object({ amountCents: amountCentsSchema.optional() })
  .optional()
  .default({});

export const voidSchema = z
  .object({ reason: z.string().trim().max(200).optional() })
  .optional()
  .default({});
