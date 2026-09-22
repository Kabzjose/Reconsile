import type { Prisma } from '@prisma/client';

/**
 * Money moves through four guarded UPDATE statements and nothing else.
 *
 * Each one increments or decrements an `allocated_cents` counter AND recomputes the status in the
 * same statement, with the safety conditions in the WHERE clause. That makes it atomic under
 * concurrency: if two requests race to allocate the same last KSh 2,500, PostgreSQL serialises the
 * row updates, the second one's WHERE clause no longer matches, and it affects 0 rows. The
 * CHECK constraints in the migration are a second line of defence behind these guards.
 *
 * Every function returns true only if exactly one row was updated.
 */

type Tx = Prisma.TransactionClient;

/** An order can take money only while UNPAID or PARTIAL (not DISPUTED, CANCELLED, or already PAID). */
export async function creditOrder(tx: Tx, businessId: string, orderId: string, amountCents: number) {
  const updated = await tx.$executeRaw`
    UPDATE orders SET
      allocated_cents = allocated_cents + ${amountCents}::int,
      status = CASE WHEN allocated_cents + ${amountCents}::int >= amount_cents
                    THEN 'PAID'::"OrderStatus" ELSE 'PARTIAL'::"OrderStatus" END,
      updated_at = now()
    WHERE id = ${orderId} AND business_id = ${businessId}
      AND status IN ('UNPAID'::"OrderStatus", 'PARTIAL'::"OrderStatus")
      AND allocated_cents + ${amountCents}::int <= amount_cents`;
  return updated === 1;
}

/** A payment can be allocated from unless it's DISPUTED, and never beyond its own amount. */
export async function creditPayment(tx: Tx, businessId: string, paymentId: string, amountCents: number) {
  const updated = await tx.$executeRaw`
    UPDATE payments SET
      allocated_cents = allocated_cents + ${amountCents}::int,
      status = CASE WHEN allocated_cents + ${amountCents}::int >= amount_cents
                    THEN 'MATCHED'::"PaymentStatus" ELSE 'PARTIAL'::"PaymentStatus" END,
      updated_at = now()
    WHERE id = ${paymentId} AND business_id = ${businessId}
      AND status <> 'DISPUTED'::"PaymentStatus"
      AND allocated_cents + ${amountCents}::int <= amount_cents`;
  return updated === 1;
}

/** Reverses a credit (voiding an allocation). A DISPUTED order stays DISPUTED. */
export async function debitOrder(tx: Tx, businessId: string, orderId: string, amountCents: number) {
  const updated = await tx.$executeRaw`
    UPDATE orders SET
      allocated_cents = allocated_cents - ${amountCents}::int,
      status = CASE WHEN status = 'DISPUTED'::"OrderStatus" THEN status
                    WHEN allocated_cents - ${amountCents}::int <= 0 THEN 'UNPAID'::"OrderStatus"
                    ELSE 'PARTIAL'::"OrderStatus" END,
      updated_at = now()
    WHERE id = ${orderId} AND business_id = ${businessId}
      AND allocated_cents - ${amountCents}::int >= 0`;
  return updated === 1;
}

export async function debitPayment(tx: Tx, businessId: string, paymentId: string, amountCents: number) {
  const updated = await tx.$executeRaw`
    UPDATE payments SET
      allocated_cents = allocated_cents - ${amountCents}::int,
      status = CASE WHEN status = 'DISPUTED'::"PaymentStatus" THEN status
                    WHEN allocated_cents - ${amountCents}::int <= 0 THEN 'UNMATCHED'::"PaymentStatus"
                    ELSE 'PARTIAL'::"PaymentStatus" END,
      updated_at = now()
    WHERE id = ${paymentId} AND business_id = ${businessId}
      AND allocated_cents - ${amountCents}::int >= 0`;
  return updated === 1;
}
