import { randomBytes, randomInt } from 'node:crypto';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { processWebhook, type WebhookResult } from '../webhooks/webhook.service';
import { signBody } from '../webhooks/webhook.signature';

/**
 * Sends test payments through the REAL webhook pipeline: builds the JSON a provider would send,
 * signs it with the business's secret, and hands it to processWebhook(). Nothing is faked
 * downstream of that call, so what you see in the demo is what a real provider would trigger.
 */

export interface SimulatedPayment {
  provider?: 'MPESA' | 'BANK' | 'STRIPE';
  transactionId?: string;
  amountKes: number;
  phone?: string;
  name?: string;
  reference?: string;
}

export interface SimulationResult {
  payload: Record<string, unknown>;
  result: WebhookResult;
}

const newTransactionId = () => `SIM${randomBytes(5).toString('hex').toUpperCase()}`;

export async function sendSimulatedWebhook(businessId: string, input: SimulatedPayment, times = 1): Promise<SimulationResult[]> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { webhookSecret: true } });
  if (!business) throw new NotFoundError('Business not found');

  const payload = {
    event: 'payment.completed',
    provider: input.provider ?? 'MPESA',
    transactionId: input.transactionId ?? newTransactionId(),
    amount: input.amountKes,
    currency: 'KES',
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = signBody(business.webhookSecret, rawBody);

  // Sequential on purpose: the second delivery of a retry arrives after the first.
  const results: SimulationResult[] = [];
  for (let i = 0; i < times; i++) {
    results.push({ payload, result: await processWebhook({ businessId, rawBody, signatureHeader: signature }) });
  }
  return results;
}

export const SCENARIOS = ['CLEAN', 'UNDERPAY', 'OVERPAY', 'TILL_AMBIGUOUS', 'ORPHAN', 'DUPLICATE'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

const kes = (cents: number) => cents / 100;

export async function runScenario(businessId: string, name: ScenarioName) {
  if (name === 'ORPHAN') {
    const amountKes = randomInt(1, 50) * 100 + 50 * randomInt(0, 2);
    const sent = await sendSimulatedWebhook(businessId, { amountKes, phone: `2547${randomInt(10_000_000, 99_999_999)}` });
    return { scenario: name, description: `A KSh ${amountKes} payment with no account reference that matches nothing`, sent };
  }

  const openOrders = await prisma.order.findMany({
    where: { businessId, status: 'UNPAID' },
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  if (openOrders.length === 0) {
    throw new ConflictError('There are no unpaid orders to simulate a payment against. Create an order first (or load the demo data).');
  }

  if (name === 'TILL_AMBIGUOUS') {
    // Find an amount that several open orders share: exactly the situation that defeats "amount == amount" matching.
    const byAmount = new Map<number, typeof openOrders>();
    for (const order of openOrders) byAmount.set(order.amountCents, [...(byAmount.get(order.amountCents) ?? []), order]);
    const shared = [...byAmount.values()].sort((a, b) => b.length - a.length)[0]!;
    const withPhone = shared.find((order) => order.customer?.phone);
    const sent = await sendSimulatedWebhook(businessId, {
      amountKes: kes(shared[0]!.amountCents),
      phone: withPhone?.customer?.phone ?? undefined,
      name: withPhone?.customer?.name ?? undefined,
    });
    return {
      scenario: name,
      description: `A Till payment of KSh ${kes(shared[0]!.amountCents)} with no reference, while ${shared.length} open order(s) owe that amount${
        withPhone ? ` (the payer's phone matches ${withPhone.customer?.name})` : ''
      }`,
      sent,
    };
  }

  const order = openOrders[0]!;
  const balance = order.amountCents - order.allocatedCents;

  if (name === 'CLEAN' || name === 'DUPLICATE') {
    const sent = await sendSimulatedWebhook(
      businessId,
      { amountKes: kes(balance), reference: order.reference, phone: order.customer?.phone ?? undefined },
      name === 'DUPLICATE' ? 2 : 1,
    );
    return {
      scenario: name,
      description:
        name === 'DUPLICATE'
          ? `The same KSh ${kes(balance)} payment for ${order.reference} delivered twice, like a provider retry`
          : `A KSh ${kes(balance)} payment quoting ${order.reference}`,
      sent,
    };
  }

  if (name === 'UNDERPAY') {
    const half = Math.max(100, Math.floor(balance / 2 / 100) * 100);
    const sent = await sendSimulatedWebhook(businessId, { amountKes: kes(half), reference: order.reference });
    return { scenario: name, description: `Only KSh ${kes(half)} of the KSh ${kes(balance)} owed on ${order.reference}`, sent };
  }

  // OVERPAY
  const sent = await sendSimulatedWebhook(businessId, { amountKes: kes(balance) + 500, reference: order.reference });
  return { scenario: name, description: `KSh ${kes(balance) + 500} paid against ${order.reference}, which owes KSh ${kes(balance)}`, sent };
}
