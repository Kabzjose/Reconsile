import type { PaymentStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NEEDS_REVIEW } from '../payments/payment.status';

export type Range = 'today' | '7d' | '30d' | 'all';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Kenya is UTC+3 all year, no daylight saving

/** Start of the range. "Today" means today in Nairobi, not in UTC. */
export function rangeStart(range: Range, now = new Date()): Date | null {
  if (range === 'all') return null;
  if (range === 'today') {
    const nairobi = new Date(now.getTime() + EAT_OFFSET_MS);
    return new Date(Date.UTC(nairobi.getUTCFullYear(), nairobi.getUTCMonth(), nairobi.getUTCDate()) - EAT_OFFSET_MS);
  }
  const days = range === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

const sum = (value: number | null | undefined) => value ?? 0;

export async function getSummary(businessId: string, range: Range) {
  const since = rangeStart(range);

  const paymentWhere = { businessId, ...(since ? { paidAt: { gte: since } } : {}) };
  const orderWhere = { businessId, ...(since ? { createdAt: { gte: since } } : {}) };

  const [paymentGroups, orderGroups, needsReviewCount, recent] = await Promise.all([
    prisma.payment.groupBy({ by: ['status'], where: paymentWhere, _sum: { amountCents: true, allocatedCents: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ['status'], where: orderWhere, _sum: { amountCents: true, allocatedCents: true }, _count: { _all: true } }),
    // The review queue is everything still waiting, regardless of the date filter.
    prisma.payment.count({ where: { businessId, status: { in: NEEDS_REVIEW } } }),
    prisma.payment.findMany({
      where: paymentWhere,
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      take: 10,
      include: {
        allocations: {
          where: { status: { in: ['ACTIVE', 'SUGGESTED'] } },
          orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
          include: { order: { select: { reference: true } } },
        },
      },
    }),
  ]);

  // Payments
  let paymentsReceivedCents = 0;
  let matchedCents = 0;
  let unmatchedCents = 0; // received money nobody has claimed yet
  let disputedPaymentCents = 0;
  const paymentCounts: Record<string, number> = {};
  for (const group of paymentGroups) {
    const amount = sum(group._sum.amountCents);
    const allocated = sum(group._sum.allocatedCents);
    paymentsReceivedCents += amount;
    matchedCents += allocated;
    paymentCounts[group.status] = group._count._all;
    if (group.status === 'DISPUTED') disputedPaymentCents += amount - allocated;
    else if (NEEDS_REVIEW.includes(group.status as PaymentStatus)) unmatchedCents += amount - allocated;
  }

  // Sales
  let salesCents = 0;
  let unpaidSalesCents = 0; // sold, but nobody has paid for it yet
  let disputedOrderCents = 0;
  const orderCounts: Record<string, number> = {};
  for (const group of orderGroups) {
    const amount = sum(group._sum.amountCents);
    const allocated = sum(group._sum.allocatedCents);
    orderCounts[group.status] = group._count._all;
    if (group.status === 'CANCELLED') continue; // cancelled sales aren't sales
    salesCents += amount;
    if (group.status === 'UNPAID' || group.status === 'PARTIAL') unpaidSalesCents += amount - allocated;
    if (group.status === 'DISPUTED') disputedOrderCents += amount - allocated;
  }

  return {
    range,
    since,
    salesCents,
    paymentsReceivedCents,
    matchedCents,
    unmatchedPaymentsCents: unmatchedCents,
    unpaidSalesCents,
    disputedCents: disputedPaymentCents + disputedOrderCents,
    // Of the money received, how much is tied to a sale? null when nothing was received.
    reconciliationRate: paymentsReceivedCents > 0 ? Math.round((matchedCents / paymentsReceivedCents) * 1000) / 10 : null,
    needsReviewCount,
    paymentCounts,
    orderCounts,
    recent: recent.map((payment) => {
      const active = payment.allocations.filter((allocation) => allocation.status === 'ACTIVE');
      const suggestion = payment.allocations.find((allocation) => allocation.status === 'SUGGESTED');
      return {
        id: payment.id,
        provider: payment.provider,
        externalReference: payment.externalReference,
        amountCents: payment.amountCents,
        status: payment.status,
        paidAt: payment.paidAt,
        matchedOrders: active.map((allocation) => allocation.order.reference),
        suggestedOrder: suggestion ? { reference: suggestion.order.reference, confidence: suggestion.confidence } : null,
      };
    }),
  };
}
