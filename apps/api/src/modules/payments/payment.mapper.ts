import type { Allocation, Payment, Prisma } from '@prisma/client';

// What the list and detail queries pull in alongside a payment.
export const paymentListInclude = {
  // Only the single best suggestion, so the review queue can show "probably ORD-1042 (94%)".
  allocations: {
    where: { status: 'SUGGESTED' },
    orderBy: { confidence: 'desc' },
    take: 1,
    include: { order: { select: { id: true, reference: true } } },
  },
} satisfies Prisma.PaymentInclude;

export const paymentDetailInclude = {
  allocations: {
    orderBy: { createdAt: 'asc' },
    include: { order: { select: { id: true, reference: true, amountCents: true, allocatedCents: true, status: true } } },
  },
} satisfies Prisma.PaymentInclude;

type AllocationWithOrder = Allocation & {
  order: { id: string; reference: string; amountCents?: number; allocatedCents?: number; status?: string };
};

export function toAllocationDto(allocation: AllocationWithOrder) {
  return {
    id: allocation.id,
    orderId: allocation.orderId,
    orderReference: allocation.order.reference,
    orderAmountCents: allocation.order.amountCents ?? null,
    orderBalanceCents:
      allocation.order.amountCents !== undefined && allocation.order.allocatedCents !== undefined
        ? allocation.order.amountCents - allocation.order.allocatedCents
        : null,
    orderStatus: allocation.order.status ?? null,
    amountCents: allocation.amountCents,
    confidence: allocation.confidence,
    source: allocation.source,
    status: allocation.status,
    signals: allocation.signals,
    createdAt: allocation.createdAt,
    confirmedAt: allocation.confirmedAt,
    voidedAt: allocation.voidedAt,
    voidReason: allocation.voidReason,
  };
}

/** The public shape of a payment. Internal fields (businessId) never leave the API. */
export function toPaymentDto(payment: Payment & { allocations?: AllocationWithOrder[] }) {
  const suggestion = payment.allocations?.find((allocation) => allocation.status === 'SUGGESTED');
  return {
    id: payment.id,
    provider: payment.provider,
    externalReference: payment.externalReference,
    billReference: payment.billReference,
    amountCents: payment.amountCents,
    allocatedCents: payment.allocatedCents,
    unallocatedCents: payment.amountCents - payment.allocatedCents,
    payerPhone: payment.payerPhone,
    payerName: payment.payerName,
    status: payment.status,
    disputeNote: payment.disputeNote,
    paidAt: payment.paidAt,
    metadata: payment.metadata,
    createdAt: payment.createdAt,
    topSuggestion: suggestion
      ? {
          allocationId: suggestion.id,
          orderId: suggestion.orderId,
          orderReference: suggestion.order.reference,
          confidence: suggestion.confidence,
          amountCents: suggestion.amountCents,
        }
      : null,
  };
}

export function toPaymentDetailDto(payment: Payment & { allocations: AllocationWithOrder[] }) {
  return { ...toPaymentDto(payment), allocations: payment.allocations.map(toAllocationDto) };
}
