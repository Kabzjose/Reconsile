import type { AllocationSource, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { logger } from '../../infrastructure/logging/logger';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { creditOrder, creditPayment, debitOrder, debitPayment } from './reconciliation.sql';
import { THRESHOLDS, decideMatch, scoreCandidates, type Candidate, type OrderInput } from './reconciliation.scoring';

type Tx = Prisma.TransactionClient;

export type ReconcileOutcome = 'AUTO_MATCHED' | 'SUGGESTED' | 'NEEDS_REVIEW' | 'SKIPPED';

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  reason: string;
  allocationId?: string;
  orderReference?: string;
  confidence?: number;
}

// SECURITY: every query below filters by businessId, which always comes from the verified JWT
// (or, for webhooks, from a signature-verified business).

// ───────────────────────────── helpers ─────────────────────────────

/** Voids suggestions matching `where`; returns the payments that just lost a suggestion. */
async function voidSuggestions(tx: Tx, where: Prisma.AllocationWhereInput, reason: string): Promise<string[]> {
  const affected = await tx.allocation.findMany({ where: { ...where, status: 'SUGGESTED' }, select: { id: true, paymentId: true } });
  if (affected.length === 0) return [];
  await tx.allocation.updateMany({
    where: { id: { in: affected.map((allocation) => allocation.id) } },
    data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
  });
  return [...new Set(affected.map((allocation) => allocation.paymentId))];
}

/**
 * A payment with no money allocated is SUGGESTED if it still has a strong suggestion, else UNMATCHED.
 * Call this after suggestions appear or disappear so the review queue never shows stale states.
 */
async function refreshSuggestedStatus(tx: Tx, businessId: string, paymentIds: string[]) {
  for (const paymentId of new Set(paymentIds)) {
    const strong = await tx.allocation.count({ where: { businessId, paymentId, status: 'SUGGESTED', confidence: { gte: THRESHOLDS.suggest } } });
    await tx.payment.updateMany({
      where: { id: paymentId, businessId, allocatedCents: 0, status: strong > 0 ? 'UNMATCHED' : 'SUGGESTED' },
      data: { status: strong > 0 ? 'SUGGESTED' : 'UNMATCHED' },
    });
  }
}

interface ActivateInput {
  businessId: string;
  paymentId: string;
  orderId: string;
  amountCents: number;
  confidence: number;
  source: AllocationSource;
  signals?: Prisma.InputJsonValue;
  decidedById?: string | null;
  /** Promote an existing suggestion instead of creating a new allocation. */
  suggestionId?: string;
}

/**
 * The only way money gets allocated. Runs inside the caller's transaction, so if either side
 * refuses (disputed, cancelled, already paid, not enough left) the whole thing rolls back.
 */
async function activateAllocation(tx: Tx, input: ActivateInput) {
  const { businessId, paymentId, orderId, amountCents } = input;
  if (amountCents <= 0) throw new ConflictError('Nothing left to allocate');

  if (!(await creditPayment(tx, businessId, paymentId, amountCents))) {
    throw new ConflictError('The payment cannot take this allocation: it is disputed, or does not have enough unallocated money');
  }
  if (!(await creditOrder(tx, businessId, orderId, amountCents))) {
    throw new ConflictError('The order cannot take this allocation: it is closed, disputed, cancelled, or owes less than this');
  }

  const now = new Date();
  const allocation = input.suggestionId
    ? await tx.allocation.update({
        where: { id: input.suggestionId },
        data: { status: 'ACTIVE', amountCents, source: input.source, decidedById: input.decidedById ?? null, confirmedAt: now },
      })
    : await tx.allocation.create({
        data: {
          businessId,
          paymentId,
          orderId,
          amountCents,
          confidence: input.confidence,
          source: input.source,
          status: 'ACTIVE',
          signals: input.signals,
          decidedById: input.decidedById ?? null,
          confirmedAt: now,
        },
      });

  // Tidy up suggestions that this allocation has made pointless.
  const [payment, order] = await Promise.all([
    tx.payment.findFirst({ where: { id: paymentId, businessId }, select: { amountCents: true, allocatedCents: true } }),
    tx.order.findFirst({ where: { id: orderId, businessId }, select: { status: true } }),
  ]);
  const staleOwners: string[] = [];
  if (payment && payment.allocatedCents >= payment.amountCents) {
    await voidSuggestions(tx, { businessId, paymentId }, 'The payment is fully allocated');
  }
  if (order?.status === 'PAID') {
    staleOwners.push(...(await voidSuggestions(tx, { businessId, orderId }, 'The order is fully paid')));
  }
  await refreshSuggestedStatus(tx, businessId, staleOwners.filter((id) => id !== paymentId));

  return allocation;
}

// ───────────────────────────── the engine ─────────────────────────────

/** Scores the payment against open orders, then auto-matches, suggests, or leaves it for review. */
export async function reconcilePayment(businessId: string, paymentId: string): Promise<ReconcileResult> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { id: paymentId, businessId } });
    if (!payment) throw new NotFoundError('Payment not found');

    if (payment.status === 'DISPUTED') return { outcome: 'SKIPPED', reason: 'The payment is disputed' };
    if (payment.amountCents - payment.allocatedCents <= 0) return { outcome: 'SKIPPED', reason: 'The payment is fully allocated' };

    // A re-run replaces earlier proposals.
    await voidSuggestions(tx, { businessId, paymentId }, 'Superseded by a new matching run');

    const alreadyAllocated = await tx.allocation.findMany({ where: { businessId, paymentId, status: 'ACTIVE' }, select: { orderId: true } });
    const orders = await tx.order.findMany({
      where: {
        businessId,
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(alreadyAllocated.length ? { id: { notIn: alreadyAllocated.map((allocation) => allocation.orderId) } } : {}),
      },
      include: { customer: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500, // plenty for a small business; the engine is not meant to scan a warehouse
    });

    const orderInputs: OrderInput[] = orders.map((order) => ({
      id: order.id,
      reference: order.reference,
      amountCents: order.amountCents,
      allocatedCents: order.allocatedCents,
      createdAt: order.createdAt,
      customerName: order.customer?.name ?? null,
      customerPhone: order.customer?.phone ?? null,
    }));

    const candidates = scoreCandidates(payment, orderInputs);
    const decision = decideMatch(candidates);

    if (decision.action === 'AUTO') {
      const top = decision.top;
      const allocation = await activateAllocation(tx, {
        businessId,
        paymentId,
        orderId: top.orderId,
        amountCents: top.allocatableCents,
        confidence: top.confidence,
        source: decision.source,
        signals: signalsOf(top, decision.reason),
      });
      return {
        outcome: 'AUTO_MATCHED',
        reason: decision.reason,
        allocationId: allocation.id,
        orderReference: top.orderReference,
        confidence: top.confidence,
      };
    }

    // Keep the best few candidates so the review screen can show them.
    const worthShowing = candidates.filter((candidate) => candidate.confidence >= THRESHOLDS.minCandidate).slice(0, THRESHOLDS.maxSuggestions);
    if (worthShowing.length > 0) {
      await tx.allocation.createMany({
        data: worthShowing.map((candidate) => ({
          businessId,
          paymentId,
          orderId: candidate.orderId,
          amountCents: candidate.allocatableCents,
          confidence: candidate.confidence,
          source: 'AUTO_SCORE' as const,
          status: 'SUGGESTED' as const,
          signals: signalsOf(candidate, decision.reason),
        })),
      });
    }
    await refreshSuggestedStatus(tx, businessId, [paymentId]);

    return {
      outcome: decision.action === 'SUGGEST' ? 'SUGGESTED' : 'NEEDS_REVIEW',
      reason: decision.reason,
      orderReference: decision.top?.orderReference,
      confidence: decision.top?.confidence,
    };
  });
}

function signalsOf(candidate: Candidate, decisionReason: string): Prisma.InputJsonValue {
  return { points: candidate.points, score: candidate.score, reasons: candidate.reasons, decision: decisionReason };
}

/** Re-runs the engine over everything still waiting (e.g. after the owner records a late sale). */
export async function reconcileWaitingPayments(businessId: string) {
  const waiting = await prisma.payment.findMany({
    where: { businessId, status: { in: ['UNMATCHED', 'SUGGESTED', 'PARTIAL'] } },
    orderBy: { paidAt: 'asc' },
    take: 200,
    select: { id: true },
  });

  const tally = { checked: waiting.length, autoMatched: 0, suggested: 0, needsReview: 0, skipped: 0, failed: 0 };
  for (const { id } of waiting) {
    try {
      const result = await reconcilePayment(businessId, id);
      if (result.outcome === 'AUTO_MATCHED') tally.autoMatched++;
      else if (result.outcome === 'SUGGESTED') tally.suggested++;
      else if (result.outcome === 'NEEDS_REVIEW') tally.needsReview++;
      else tally.skipped++;
    } catch (error) {
      tally.failed++;
      logger.error({ err: error, paymentId: id }, 'Reconciliation failed for a payment');
    }
  }
  return tally;
}

// ───────────────────────────── human decisions ─────────────────────────────

/** The owner confirms a suggested match. */
export async function confirmSuggestion(businessId: string, userId: string, allocationId: string, requestedCents?: number) {
  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.allocation.findFirst({ where: { id: allocationId, businessId } });
    if (!suggestion) throw new NotFoundError('Allocation not found');
    if (suggestion.status !== 'SUGGESTED') throw new ConflictError(`This allocation is already ${suggestion.status.toLowerCase()}`);

    const amountCents = await resolveAmount(tx, businessId, suggestion.paymentId, suggestion.orderId, requestedCents);
    return activateAllocation(tx, {
      businessId,
      paymentId: suggestion.paymentId,
      orderId: suggestion.orderId,
      amountCents,
      confidence: suggestion.confidence,
      source: 'MANUAL',
      decidedById: userId,
      suggestionId: suggestion.id,
    });
  });
}

/** The owner allocates a payment to any open order, suggested or not (also how one payment covers several orders). */
export async function allocateManually(businessId: string, userId: string, paymentId: string, orderId: string, requestedCents?: number) {
  return prisma.$transaction(async (tx) => {
    const [payment, order] = await Promise.all([
      tx.payment.findFirst({ where: { id: paymentId, businessId }, select: { id: true } }),
      tx.order.findFirst({ where: { id: orderId, businessId }, select: { id: true } }),
    ]);
    if (!payment) throw new NotFoundError('Payment not found');
    if (!order) throw new NotFoundError('Order not found');

    const amountCents = await resolveAmount(tx, businessId, paymentId, orderId, requestedCents);
    const existing = await tx.allocation.findFirst({ where: { businessId, paymentId, orderId, status: { in: ['SUGGESTED', 'ACTIVE'] } } });
    if (existing?.status === 'ACTIVE') throw new ConflictError('This payment is already allocated to that order');

    return activateAllocation(tx, {
      businessId,
      paymentId,
      orderId,
      amountCents,
      confidence: existing?.confidence ?? 100,
      source: 'MANUAL',
      decidedById: userId,
      suggestionId: existing?.id,
    });
  });
}

/** The most that can move right now is what the payment has left and what the order still owes. */
async function resolveAmount(tx: Tx, businessId: string, paymentId: string, orderId: string, requestedCents?: number) {
  const [payment, order] = await Promise.all([
    tx.payment.findFirst({ where: { id: paymentId, businessId }, select: { amountCents: true, allocatedCents: true } }),
    tx.order.findFirst({ where: { id: orderId, businessId }, select: { amountCents: true, allocatedCents: true } }),
  ]);
  if (!payment || !order) throw new NotFoundError('Payment or order not found');

  const available = Math.min(payment.amountCents - payment.allocatedCents, order.amountCents - order.allocatedCents);
  if (available <= 0) throw new ConflictError('There is nothing left to allocate between this payment and this order');
  if (requestedCents !== undefined && requestedCents > available) {
    throw new ConflictError(`At most ${available} cents can be allocated here (the smaller of what the payment has left and what the order owes)`);
  }
  return requestedCents ?? available;
}

/**
 * Corrects a wrong match. Allocations are never edited or deleted: voiding one reverses its
 * effect on both balances and keeps the row forever as the audit trail.
 */
export async function voidAllocation(businessId: string, userId: string, allocationId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const allocation = await tx.allocation.findFirst({ where: { id: allocationId, businessId } });
    if (!allocation) throw new NotFoundError('Allocation not found');
    if (allocation.status === 'VOIDED') return allocation; // idempotent

    if (allocation.status === 'ACTIVE') {
      const ok =
        (await debitPayment(tx, businessId, allocation.paymentId, allocation.amountCents)) &&
        (await debitOrder(tx, businessId, allocation.orderId, allocation.amountCents));
      if (!ok) throw new ConflictError('The balances changed while voiding. Reload and try again.');
    }

    const voided = await tx.allocation.update({
      where: { id: allocation.id },
      data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason ?? 'Voided by the owner', decidedById: userId },
    });
    await refreshSuggestedStatus(tx, businessId, [allocation.paymentId]);
    return voided;
  });
}

// Used by order cancellation, which lives in the orders module.
export { refreshSuggestedStatus, voidSuggestions };
