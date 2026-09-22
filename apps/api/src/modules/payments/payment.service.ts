import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { refreshSuggestedStatus } from '../reconciliation/reconciliation.service';
import { paymentDetailInclude, paymentListInclude, toPaymentDetailDto, toPaymentDto } from './payment.mapper';
import { receivePayment } from './payment.receive';
import type { CreatePaymentInput, ListPaymentsQuery } from './payment.schemas';
import { PAYMENT_DISPUTABLE, derivePaymentStatus } from './payment.status';

// SECURITY: every query filters by businessId, which always comes from the verified JWT.

/** Manual entry (cash, or a payment typed in by the owner / the demo simulator). */
export async function createPayment(businessId: string, input: CreatePaymentInput) {
  // Cash has no provider transaction id, so we mint one. The prefix makes it recognisable.
  const externalReference = input.externalReference ?? `CASH-${randomUUID()}`;

  const { payment, duplicate, reconciliation } = await receivePayment(
    {
      businessId,
      provider: input.provider,
      externalReference,
      billReference: input.billReference,
      amountCents: input.amountCents,
      payerPhone: input.payerPhone,
      payerName: input.payerName,
      paidAt: input.paidAt,
      metadata: input.metadata,
    },
    {
      source: 'MANUAL',
      rawPayload: JSON.parse(JSON.stringify({ ...input, externalReference })) as Prisma.InputJsonValue,
    },
  );

  return { data: toPaymentDto(payment), duplicate, reconciliation };
}

export async function listPayments(businessId: string, query: ListPaymentsQuery) {
  const { status, provider, search, from, to, page, pageSize } = query;

  const where: Prisma.PaymentWhereInput = {
    businessId,
    ...(status?.length ? { status: { in: status } } : {}),
    ...(provider?.length ? { provider: { in: provider } } : {}),
    ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(search
      ? {
          OR: [
            { externalReference: { contains: search, mode: 'insensitive' } },
            { billReference: { contains: search, mode: 'insensitive' } },
            { payerPhone: { contains: search } },
            { payerName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: paymentListInclude,
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toPaymentDto),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getPayment(businessId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, businessId }, include: paymentDetailInclude });
  if (!payment) throw new NotFoundError('Payment not found');
  return toPaymentDetailDto(payment);
}

export async function disputePayment(businessId: string, paymentId: string, note: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, businessId }, select: { status: true } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (!PAYMENT_DISPUTABLE.includes(payment.status)) throw new ConflictError(`A ${payment.status.toLowerCase()} payment cannot be disputed`);

  // The status guard makes check-then-write atomic; if it changed in between, nothing matches.
  const result = await prisma.payment.updateMany({
    where: { id: paymentId, businessId, status: { in: PAYMENT_DISPUTABLE } },
    data: { status: 'DISPUTED', disputeNote: note },
  });
  if (result.count === 0) throw new ConflictError('The payment changed. Reload and try again.');
  return getPayment(businessId, paymentId);
}

export async function resolvePaymentDispute(businessId: string, paymentId: string) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { id: paymentId, businessId } });
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.status !== 'DISPUTED') throw new ConflictError('This payment is not disputed');

    // Back to whatever the money says. Guarding on allocatedCents stops a concurrent allocation leaving a stale status.
    const result = await tx.payment.updateMany({
      where: { id: paymentId, businessId, status: 'DISPUTED', allocatedCents: payment.allocatedCents },
      data: { status: derivePaymentStatus(payment.amountCents, payment.allocatedCents), disputeNote: null },
    });
    if (result.count === 0) throw new ConflictError('The payment changed. Reload and try again.');
    await refreshSuggestedStatus(tx, businessId, [paymentId]);
  });
  return getPayment(businessId, paymentId);
}
