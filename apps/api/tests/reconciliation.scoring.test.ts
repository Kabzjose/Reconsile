import { describe, expect, it } from 'vitest';
import { decideMatch, scoreCandidates, THRESHOLDS, WEIGHTS, type Candidate, type OrderInput, type PaymentInput } from '../src/modules/reconciliation/reconciliation.scoring';

const order = (overrides: Partial<OrderInput> = {}): OrderInput => ({
  id: 'ord_1',
  reference: 'ORD-1042',
  amountCents: 250000,
  allocatedCents: 0,
  createdAt: new Date('2026-09-21T10:31:00Z'),
  customerName: 'John',
  customerPhone: '254712345678',
  ...overrides,
});

const payment = (overrides: Partial<PaymentInput> = {}): PaymentInput => ({
  amountCents: 250000,
  allocatedCents: 0,
  billReference: 'ORD-1042',
  payerPhone: '254712345678',
  paidAt: new Date('2026-09-21T10:32:00Z'),
  ...overrides,
});

// For boundary tests on decideMatch itself, build candidates directly rather than reverse-engineering
// a payment/order pair that lands on an exact score (decideMatch doesn't care how a score was reached).
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  orderId: 'ord_1',
  orderReference: 'ORD-1042',
  score: 80,
  confidence: 80,
  allocatableCents: 250000,
  fitsPayment: true,
  exactReference: false,
  points: { reference: 0, amount: 30, phone: 30, time: 20 },
  reasons: [],
  orderCreatedAt: new Date('2026-09-21T10:31:00Z'),
  ...overrides,
});

describe('scoreCandidates: the hackathon example (Order #1042, KSh 2,500, reference + amount + time match)', () => {
  it('scores at or above the worked example\'s 98% (reference 50 + amount 30 + phone 30 + time 10, capped at 100)', () => {
    const [top] = scoreCandidates(payment(), [order()]);
    expect(top!.confidence).toBeGreaterThanOrEqual(98);
    expect(decideMatch([top!])).toMatchObject({ action: 'AUTO', source: 'AUTO_REFERENCE' });
  });
});

describe('the ambiguous case: three identical-amount orders, no reference', () => {
  const orders = [
    order({ id: 'a', reference: 'ORD-A', customerPhone: '254700000001' }),
    order({ id: 'b', reference: 'ORD-B', customerPhone: '254700000002' }),
    order({ id: 'c', reference: 'ORD-C', customerPhone: '254700000003' }),
  ];

  it('amount alone can never auto-match: the best possible score without a reference is 70', () => {
    const candidates = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: null }), orders);
    expect(candidates.every((candidate) => candidate.confidence <= 70)).toBe(true);
    expect(decideMatch(candidates).action).not.toBe('AUTO');
  });

  it('goes to REVIEW when nothing distinguishes the candidates (a real Till-payment scenario)', () => {
    const candidates = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: null }), orders);
    expect(decideMatch(candidates).action).toBe('REVIEW');
  });

  it('the matching phone breaks the tie decisively', () => {
    const candidates = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: '254700000002' }), orders);
    expect(candidates[0]!.orderId).toBe('b');
  });
});

describe('reference handling', () => {
  it('an exact reference on a fitting amount auto-matches even with nothing else', () => {
    const decision = decideMatch(scoreCandidates(payment({ payerPhone: null, paidAt: new Date('2026-10-01T00:00:00Z') }), [order({ customerPhone: null })]));
    expect(decision).toMatchObject({ action: 'AUTO', source: 'AUTO_REFERENCE' });
  });

  it('is case- and punctuation-insensitive ("ord 1042" == "ORD-1042")', () => {
    const decision = decideMatch(scoreCandidates(payment({ billReference: 'ord 1042' }), [order()]));
    expect(decision.action).toBe('AUTO');
  });

  it('a one-character typo scores as a near match, not an exact one', () => {
    const [top] = scoreCandidates(payment({ billReference: 'ORD-1043' }), [order()]);
    expect(top!.points.reference).toBe(WEIGHTS.referenceNear);
    expect(top!.exactReference).toBe(false);
  });

  it('the same reference on TWO open orders is suggested, not auto-matched (ambiguous, needs a person)', () => {
    const decision = decideMatch(
      scoreCandidates(payment(), [order({ id: 'x', reference: 'ORD-1042' }), order({ id: 'y', reference: 'ORD-1042' })]),
    );
    expect(decision.action).toBe('SUGGEST');
  });

  it('exact reference but the payment is MORE than the order owes is suggested (a person decides what to do with the excess)', () => {
    const decision = decideMatch(scoreCandidates(payment({ amountCents: 300000 }), [order()]));
    expect(decision).toMatchObject({ action: 'SUGGEST' });
    expect(decision.top!.fitsPayment).toBe(false);
  });
});

describe('amount handling', () => {
  it('a part-payment (less than the balance) scores partial credit, not full', () => {
    const [top] = scoreCandidates(payment({ amountCents: 100000, billReference: undefined as unknown as null }), [order({ customerPhone: null })]);
    expect(top!.points.amount).toBe(WEIGHTS.amountPartial);
  });

  it('a payment smaller than a much larger order balance still gets partial-payment credit, never full credit', () => {
    const [top] = scoreCandidates(payment({ amountCents: 100000, billReference: undefined as unknown as null }), [
      order({ amountCents: 500000, customerPhone: null }),
    ]);
    expect(top!.points.amount).toBe(WEIGHTS.amountPartial);
    expect(top!.fitsPayment).toBe(true); // it COULD be a part-payment; a human should still confirm which order
  });

  it('a payment larger than the order balance (overpayment) gets no amount credit and does not fit', () => {
    const [top] = scoreCandidates(payment({ amountCents: 500000, billReference: undefined as unknown as null }), [
      order({ amountCents: 100000, customerPhone: null }),
    ]);
    expect(top!.points.amount).toBe(0);
    expect(top!.fitsPayment).toBe(false);
  });

  it('an order that is already fully allocated is never offered as a candidate', () => {
    const candidates = scoreCandidates(payment(), [order({ allocatedCents: 250000 })]);
    expect(candidates).toHaveLength(0);
  });

  it('a payment with nothing left unallocated produces no candidates', () => {
    const candidates = scoreCandidates(payment({ allocatedCents: 250000 }), [order()]);
    expect(candidates).toHaveLength(0);
  });

  it('allocatableCents is the smaller of what the payment has left and what the order still owes (split payment)', () => {
    const [top] = scoreCandidates(payment({ amountCents: 500000 }), [order({ amountCents: 250000 })]);
    expect(top!.allocatableCents).toBe(250000);
  });
});

describe('phone handling', () => {
  it('a matching phone contributes even with no reference', () => {
    const [top] = scoreCandidates(payment({ billReference: undefined as unknown as null }), [order()]);
    expect(top!.points.phone).toBe(WEIGHTS.phone);
  });
  it('a non-matching phone contributes nothing', () => {
    const [top] = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: '254799999999' }), [order()]);
    expect(top!.points.phone).toBe(0);
  });
});

describe('time handling', () => {
  it('paid soon after the order was created scores full time credit', () => {
    const [top] = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: null, paidAt: new Date('2026-09-21T10:41:00Z') }), [order({ customerPhone: null })]);
    expect(top!.points.time).toBe(WEIGHTS.timeMax);
  });
  it('paid a week later scores no time credit', () => {
    const [top] = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: null, paidAt: new Date('2026-09-30T10:41:00Z') }), [order({ customerPhone: null })]);
    expect(top!.points.time).toBe(0);
  });
  it('paid a few minutes BEFORE the order (clock skew) still gets time credit', () => {
    const [top] = scoreCandidates(payment({ billReference: undefined as unknown as null, payerPhone: null, paidAt: new Date('2026-09-21T10:29:00Z') }), [order({ customerPhone: null })]);
    expect(top!.points.time).toBeGreaterThan(0);
  });
});

describe('the 70-point ceiling without any reference', () => {
  it('amount(30) + phone(30) + time(10) tops out at 70: a payment can never auto-match on evidence alone if it carries no account reference at all', () => {
    const [top] = scoreCandidates(payment({ billReference: undefined as unknown as null, paidAt: new Date('2026-09-21T10:41:00Z') }), [order()]);
    expect(top!.confidence).toBe(70);
    expect(decideMatch([top!]).action).toBe('SUGGEST'); // exactly at the suggest line, never AUTO
  });
});

describe('decideMatch thresholds', () => {
  it('no candidates -> REVIEW with a null top', () => {
    expect(decideMatch([])).toMatchObject({ action: 'REVIEW', top: null });
  });

  it('score >= 90 with a clear margin over the runner-up auto-matches (reachable via a near-reference plus other evidence)', () => {
    const [top] = scoreCandidates(payment({ billReference: 'ORD-1043' }), [order({ reference: 'ORD-1042' })]); // one-char typo: referenceNear(25)+amount(30)+phone(30)+time(10) = 95
    expect(top!.confidence).toBeGreaterThanOrEqual(THRESHOLDS.auto);
    expect(decideMatch([top!])).toMatchObject({ action: 'AUTO', source: 'AUTO_SCORE' });
  });

  it('a high score WITHOUT a clear margin over the runner-up is only suggested, even past 90', () => {
    const decision = decideMatch([candidate({ orderId: 'a', confidence: 94 }), candidate({ orderId: 'b', confidence: 82 })]);
    expect(94 - 82).toBeLessThan(THRESHOLDS.margin);
    expect(decision).toMatchObject({ action: 'SUGGEST' });
  });

  it('score exactly at the auto threshold WITH a clear margin auto-matches', () => {
    const decision = decideMatch([candidate({ confidence: THRESHOLDS.auto }), candidate({ orderId: 'b', confidence: THRESHOLDS.auto - THRESHOLDS.margin })]);
    expect(decision.action).toBe('AUTO');
  });

  it('one point below the auto threshold is only suggested, even with a huge margin', () => {
    const decision = decideMatch([candidate({ confidence: THRESHOLDS.auto - 1 })]);
    expect(decision.action).toBe('SUGGEST');
  });

  it('a middling score (70-89) is suggested', () => {
    const decision = decideMatch([candidate({ confidence: 75 })]);
    expect(decision.action).toBe('SUGGEST');
  });

  it('score exactly at the suggest threshold is suggested; one below goes to review', () => {
    expect(decideMatch([candidate({ confidence: THRESHOLDS.suggest })]).action).toBe('SUGGEST');
    expect(decideMatch([candidate({ confidence: THRESHOLDS.suggest - 1 })]).action).toBe('REVIEW');
  });

  it('a weak score goes to REVIEW, not SUGGEST', () => {
    const decision = decideMatch([candidate({ confidence: 40 })]);
    expect(decision.action).toBe('REVIEW');
  });
});

describe('determinism', () => {
  it('candidates are sorted best-first, ties broken by the older order, so results never depend on input order', () => {
    const a = order({ id: 'a', createdAt: new Date('2026-09-20T00:00:00Z'), reference: 'ORD-X', customerPhone: null });
    const b = order({ id: 'b', createdAt: new Date('2026-09-21T00:00:00Z'), reference: 'ORD-X', customerPhone: null });
    const forward = scoreCandidates(payment({ billReference: 'ORD-X' }), [a, b]);
    const reversed = scoreCandidates(payment({ billReference: 'ORD-X' }), [b, a]);
    expect(forward.map((c) => c.orderId)).toEqual(['a', 'b']);
    expect(reversed.map((c) => c.orderId)).toEqual(['a', 'b']);
  });
});
