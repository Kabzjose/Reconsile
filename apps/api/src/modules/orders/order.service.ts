import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { refreshSuggestedStatus, voidSuggestions } from '../reconciliation/reconciliation.service';
import { orderDetailInclude, orderInclude, toOrderDetailDto, toOrderDto } from './order.mapper';
import type { CreateOrderInput, ListOrdersQuery } from './order.schemas';
import { ORDER_CANCELLABLE, ORDER_DISPUTABLE, deriveOrderStatus } from './order.status';

// SECURITY: every query filters by businessId, which always comes from the verified JWT.

export async function createOrder(businessId: string, input: CreateOrderInput) {
  try {
    if (input.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: input.customerId, businessId } });
      if (!customer) throw new NotFoundError('Customer not found');
    }

    const order = await prisma.order.create({
      data: {
        businessId,
        reference: input.reference,
        description: input.description,
        amountCents: input.amountCents,
        customerId: input.customerId,
      },
      include: orderInclude,
    });
    return toOrderDto(order);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('An order with this reference already exists');
    }
    throw error;
  }
}

export async function listOrders(businessId: string, query: ListOrdersQuery) {
  const { status, search, from, to, page, pageSize } = query;

  const where: Prisma.OrderWhereInput = {
    businessId,
    ...(status?.length ? { status: { in: status } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id breaks ties so pages never overlap
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toOrderDto),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getOrder(businessId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId }, include: orderDetailInclude });
  if (!order) throw new NotFoundError('Order not found');
  return toOrderDetailDto(order);
}

async function findOrder(tx: Prisma.TransactionClient, businessId: string, id: string) {
  const order = await tx.order.findFirst({ where: { id, businessId }, include: orderInclude });
  if (!order) throw new NotFoundError('Order not found');
  return order;
}

export async function cancelOrder(businessId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const order = await findOrder(tx, businessId, id);
    if (order.status === 'CANCELLED') return; // idempotent
    if (order.allocatedCents > 0) {
      throw new ConflictError('This order has payments allocated to it. Void those allocations before cancelling.');
    }

    // The guards make check-then-write atomic: a payment allocated meanwhile leaves zero matching rows.
    const result = await tx.order.updateMany({
      where: { id, businessId, allocatedCents: 0, status: { in: ORDER_CANCELLABLE } },
      data: { status: 'CANCELLED' },
    });
    if (result.count === 0) throw new ConflictError('The order changed while cancelling. Reload and try again.');

    // Proposals pointing at a cancelled order are pointless; free those payments for review.
    const affected = await voidSuggestions(tx, { businessId, orderId: id }, 'The order was cancelled');
    await refreshSuggestedStatus(tx, businessId, affected);
  });
  return getOrder(businessId, id);
}

export async function disputeOrder(businessId: string, id: string, note: string) {
  await prisma.$transaction(async (tx) => {
    const order = await findOrder(tx, businessId, id);
    if (!ORDER_DISPUTABLE.includes(order.status)) throw new ConflictError(`A ${order.status.toLowerCase()} order cannot be disputed`);

    const result = await tx.order.updateMany({
      where: { id, businessId, status: { in: ORDER_DISPUTABLE } },
      data: { status: 'DISPUTED', disputeNote: note },
    });
    if (result.count === 0) throw new ConflictError('The order changed. Reload and try again.');
  });
  return getOrder(businessId, id);
}

export async function resolveOrderDispute(businessId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const order = await findOrder(tx, businessId, id);
    if (order.status !== 'DISPUTED') throw new ConflictError('This order is not disputed');

    const result = await tx.order.updateMany({
      where: { id, businessId, status: 'DISPUTED', allocatedCents: order.allocatedCents },
      data: { status: deriveOrderStatus(order.amountCents, order.allocatedCents), disputeNote: null },
    });
    if (result.count === 0) throw new ConflictError('The order changed. Reload and try again.');
  });
  return getOrder(businessId, id);
}
