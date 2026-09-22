import { referenceKey } from '../../shared/schemas';

/**
 * The matching engine's brain. PURE: no database, no HTTP, no clock. Give it a payment and the
 * open orders; it returns ranked candidates and a decision. That makes every rule below
 * unit-testable, and the whole thing easy to explain.
 *
 * Evidence, in points (a candidate's score is the sum, capped at 100):
 *
 *   Reference the payer typed matches the order's reference exactly ...... 50
 *   ... or is one typo away .............................................. 25
 *   Payment amount equals what the order still owes ...................... 30
 *   ... or is smaller (a plausible part-payment) .......................... 8
 *   Payer's phone belongs to the order's customer ......................... 30
 *   Time between the order being created and the payment being made ...... up to 10
 *
 * Decision:
 *   - Exact reference, and the payment fits the order's balance, and no other order has that
 *     reference                                                     -> AUTO   (source AUTO_REFERENCE)
 *   - Exact reference but the payment doesn't fit (overpayment)    -> SUGGEST (a human decides what to do with the extra)
 *   - No reference: top >= 90 AND leads the runner-up by >= 15     -> AUTO   (source AUTO_SCORE)
 *   - top >= 70                                                    -> SUGGEST
 *   - anything else                                                -> REVIEW
 *
 * Without a reference the best possible score is 70 (amount + phone + time), so a Till payment is
 * never auto-matched on amount alone: three identical orders can never be resolved by guessing.
 */

export const WEIGHTS = {
  referenceExact: 50,
  referenceNear: 25,
  amountExact: 30,
  amountPartial: 8,
  phone: 30,
  timeMax: 10,
} as const;

export const THRESHOLDS = {
  auto: 90,
  suggest: 70,
  margin: 15,
  /** Candidates below this aren't worth showing to a human. */
  minCandidate: 30,
  maxSuggestions: 3,
} as const;

export interface PaymentInput {
  amountCents: number;
  allocatedCents: number;
  billReference: string | null;
  payerPhone: string | null;
  paidAt: Date;
}

export interface OrderInput {
  id: string;
  reference: string;
  amountCents: number;
  allocatedCents: number;
  createdAt: Date;
  customerName: string | null;
  customerPhone: string | null;
}

export interface Candidate {
  orderId: string;
  orderReference: string;
  /** Sum of the evidence, 0-100. */
  score: number;
  /** What we'd show and store as "confidence". Equals score, except exact-reference matches (see below). */
  confidence: number;
  /** How much money this candidate could take from the payment right now. */
  allocatableCents: number;
  /** Does the whole (unallocated) payment fit inside the order's balance? */
  fitsPayment: boolean;
  exactReference: boolean;
  points: { reference: number; amount: number; phone: number; time: number };
  /** Plain-language explanation for the UI ("why this order?"). */
  reasons: string[];
  orderCreatedAt: Date;
}

export type Decision =
  | { action: 'AUTO'; source: 'AUTO_REFERENCE' | 'AUTO_SCORE'; top: Candidate; reason: string }
  | { action: 'SUGGEST'; top: Candidate; reason: string }
  | { action: 'REVIEW'; top: Candidate | null; reason: string };

const MINUTE = 60_000;

/** True when two strings differ by exactly one insertion, deletion or substitution. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function timePoints(deltaMinutes: number): number {
  if (deltaMinutes < -5) return 0; // paid before the sale existed (allow a little clock skew)
  if (deltaMinutes <= 30) return WEIGHTS.timeMax;
  if (deltaMinutes <= 120) return 7;
  if (deltaMinutes <= 24 * 60) return 4;
  if (deltaMinutes <= 7 * 24 * 60) return 2;
  return 0;
}

function describeGap(deltaMinutes: number): string {
  if (deltaMinutes < 1) return 'moments after';
  if (deltaMinutes < 60) return `${Math.round(deltaMinutes)} min after`;
  if (deltaMinutes < 24 * 60) return `${Math.round(deltaMinutes / 60)} h after`;
  return `${Math.round(deltaMinutes / (24 * 60))} days after`;
}

export function scoreCandidates(payment: PaymentInput, orders: OrderInput[]): Candidate[] {
  const unallocated = payment.amountCents - payment.allocatedCents;
  const paymentKey = payment.billReference ? referenceKey(payment.billReference) : '';

  const candidates: Candidate[] = [];

  for (const order of orders) {
    const balance = order.amountCents - order.allocatedCents;
    if (balance <= 0 || unallocated <= 0) continue;

    const reasons: string[] = [];
    const points = { reference: 0, amount: 0, phone: 0, time: 0 };

    // Reference
    const orderKey = referenceKey(order.reference);
    let exactReference = false;
    if (paymentKey && orderKey) {
      if (paymentKey === orderKey) {
        points.reference = WEIGHTS.referenceExact;
        exactReference = true;
        reasons.push(`Account reference ${payment.billReference} matches ${order.reference}`);
      } else if (paymentKey.length >= 5 && orderKey.length >= 5 && withinOneEdit(paymentKey, orderKey)) {
        points.reference = WEIGHTS.referenceNear;
        reasons.push(`Account reference ${payment.billReference} is one character off ${order.reference}`);
      }
    }

    // Amount
    if (unallocated === balance) {
      points.amount = WEIGHTS.amountExact;
      reasons.push('Amount equals what the order still owes');
    } else if (unallocated < balance) {
      points.amount = WEIGHTS.amountPartial;
      reasons.push('Amount is less than the balance, so it could be a part-payment');
    } else {
      reasons.push('Amount is more than the order still owes (overpayment)');
    }

    // Phone
    if (payment.payerPhone && order.customerPhone && payment.payerPhone === order.customerPhone) {
      points.phone = WEIGHTS.phone;
      reasons.push(`Payer's phone matches customer ${order.customerName ?? 'on the order'}`);
    }

    // Time
    const deltaMinutes = (payment.paidAt.getTime() - order.createdAt.getTime()) / MINUTE;
    points.time = timePoints(deltaMinutes);
    if (points.time > 0) reasons.push(`Paid ${describeGap(deltaMinutes)} the order was created`);

    const score = Math.min(100, points.reference + points.amount + points.phone + points.time);
    const fitsPayment = unallocated <= balance;

    // An exact reference is close to proof, so its confidence shouldn't be dragged down by a
    // missing phone or a slow payment. It still reflects how well the amount fits.
    let confidence = score;
    if (exactReference) {
      const floor = fitsPayment ? (unallocated === balance ? 95 : 85) : 80;
      confidence = Math.max(score, floor);
    }

    candidates.push({
      orderId: order.id,
      orderReference: order.reference,
      score,
      confidence,
      allocatableCents: Math.min(unallocated, balance),
      fitsPayment,
      exactReference,
      points,
      reasons,
      orderCreatedAt: order.createdAt,
    });
  }

  // Best first. Ties go to the older order, so the ordering is deterministic.
  return candidates.sort(
    (a, b) => b.confidence - a.confidence || a.orderCreatedAt.getTime() - b.orderCreatedAt.getTime(),
  );
}

export function decideMatch(candidates: Candidate[]): Decision {
  const [top, second] = candidates;
  if (!top) return { action: 'REVIEW', top: null, reason: 'No open order could take this payment' };

  if (top.exactReference) {
    const exactCount = candidates.filter((candidate) => candidate.exactReference).length;
    if (exactCount === 1 && top.fitsPayment) {
      return { action: 'AUTO', source: 'AUTO_REFERENCE', top, reason: 'Exact account reference and the amount fits' };
    }
    return {
      action: 'SUGGEST',
      top,
      reason: top.fitsPayment
        ? 'More than one order has this reference'
        : 'Exact account reference, but the payment is more than the order owes',
    };
  }

  const margin = second ? top.confidence - second.confidence : Infinity;
  if (top.confidence >= THRESHOLDS.auto && margin >= THRESHOLDS.margin) {
    return { action: 'AUTO', source: 'AUTO_SCORE', top, reason: 'Strong evidence and a clear lead over the next order' };
  }
  if (top.confidence >= THRESHOLDS.suggest) {
    return { action: 'SUGGEST', top, reason: 'Likely match, but a person should confirm it' };
  }
  return {
    action: 'REVIEW',
    top,
    reason: second && top.confidence - second.confidence < THRESHOLDS.margin
      ? 'Several orders look equally likely; no clear winner'
      : 'Not enough evidence to suggest an order',
  };
}
