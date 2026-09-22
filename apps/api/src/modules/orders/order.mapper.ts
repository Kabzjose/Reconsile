import type { Prisma } from '@prisma/client';

// Every order query includes the customer so the API always returns the same shape.
export const orderInclude = {
  customer: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.OrderInclude;

// The detail view also shows which payments paid for the order (and the suggestions still pending).
export const orderDetailInclude = {
  ...orderInclude,
  allocations: {
    orderBy: { createdAt: 'asc' },
    include: { payment: { select: { id: true, externalReference: true, provider: true, amountCents: true, paidAt: true } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithCustomer = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** The public shape of an order. Internal fields (businessId) never leave the API. */
export function toOrderDto(order: OrderWithCustomer) {
  return {
    id: order.id,
    reference: order.reference,
    description: order.description,
    amountCents: order.amountCents,
    allocatedCents: order.allocatedCents,
    balanceCents: order.amountCents - order.allocatedCents,
    status: order.status,
    disputeNote: order.disputeNote,
    customer: order.customer,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function toOrderDetailDto(order: Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>) {
  return {
    ...toOrderDto(order),
    allocations: order.allocations.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      paymentReference: allocation.payment.externalReference,
      provider: allocation.payment.provider,
      paymentAmountCents: allocation.payment.amountCents,
      paidAt: allocation.payment.paidAt,
      amountCents: allocation.amountCents,
      confidence: allocation.confidence,
      source: allocation.source,
      status: allocation.status,
      createdAt: allocation.createdAt,
      voidReason: allocation.voidReason,
    })),
  };
}
