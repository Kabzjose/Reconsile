-- Reconcile — constraints Prisma can't express.
-- Apply as a custom migration:
--   npx prisma migrate dev --name init                        (creates tables)
--   npx prisma migrate dev --create-only --name constraints   (creates an empty migration)
--   paste this file into that migration.sql, then: npx prisma migrate dev

-- 1. Money sanity ---------------------------------------------------------
ALTER TABLE payments    ADD CONSTRAINT payments_amount_positive    CHECK (amount_cents > 0);
ALTER TABLE orders      ADD CONSTRAINT orders_amount_positive      CHECK (amount_cents > 0);
ALTER TABLE allocations ADD CONSTRAINT allocations_amount_positive CHECK (amount_cents > 0);
ALTER TABLE allocations ADD CONSTRAINT allocations_confidence_range CHECK (confidence BETWEEN 0 AND 100);

-- 2. No over-allocation, enforced by the database -------------------------
-- allocated_cents is a counter the reconciliation transaction increments/decrements.
-- If any code path (or race) tries to allocate more than exists, Postgres rejects it.
ALTER TABLE payments ADD CONSTRAINT payments_allocated_bounds
  CHECK (allocated_cents >= 0 AND allocated_cents <= amount_cents);
ALTER TABLE orders ADD CONSTRAINT orders_allocated_bounds
  CHECK (allocated_cents >= 0 AND allocated_cents <= amount_cents);

-- 3. One live allocation per (payment, order) -----------------------------
-- Voided rows are exempt, so a corrected match can be re-created.
CREATE UNIQUE INDEX allocations_one_live_per_pair
  ON allocations (payment_id, order_id)
  WHERE status <> 'VOIDED';

-- 4. Fast candidate lookup for the matching engine ------------------------
-- The engine only ever looks at orders that can still receive money.
CREATE INDEX orders_open_by_amount
  ON orders (business_id, amount_cents)
  WHERE status IN ('UNPAID', 'PARTIAL');

-- 5. Allocations are append-only ------------------------------------------
CREATE OR REPLACE FUNCTION allocations_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'allocations are append-only: void instead of delete';
  END IF;

  IF NEW.payment_id <> OLD.payment_id OR NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'allocation payment/order cannot change: void and create a new one';
  END IF;

  -- Amount may only change while it is still just a suggestion.
  IF NEW.amount_cents <> OLD.amount_cents AND OLD.status <> 'SUGGESTED' THEN
    RAISE EXCEPTION 'allocation amount is immutable once confirmed';
  END IF;

  IF OLD.status = 'VOIDED' AND NEW.status <> 'VOIDED' THEN
    RAISE EXCEPTION 'a voided allocation cannot be revived';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER allocations_guard_trg
  BEFORE UPDATE OR DELETE ON allocations
  FOR EACH ROW EXECUTE FUNCTION allocations_guard();
