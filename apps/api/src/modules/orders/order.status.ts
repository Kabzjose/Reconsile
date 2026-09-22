import type { OrderStatus } from '@prisma/client';

/**
 * The payment-driven status of an order. DISPUTED and CANCELLED are set by people, never derived;
 * but when a dispute is resolved, this says where the order goes back to.
 */
export function deriveOrderStatus(amountCents: number, allocatedCents: number): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (allocatedCents <= 0) return 'UNPAID';
  if (allocatedCents >= amountCents) return 'PAID';
  return 'PARTIAL';
}

export const ORDER_DISPUTABLE: OrderStatus[] = ['UNPAID', 'PARTIAL', 'PAID'];
export const ORDER_CANCELLABLE: OrderStatus[] = ['UNPAID', 'DISPUTED'];
