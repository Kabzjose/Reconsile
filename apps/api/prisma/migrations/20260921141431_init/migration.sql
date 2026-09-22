-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('MPESA', 'BANK', 'STRIPE', 'MANUAL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'PARTIAL', 'MATCHED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('SUGGESTED', 'ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "AllocationSource" AS ENUM ('AUTO_REFERENCE', 'AUTO_SCORE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('WEBHOOK', 'CSV_IMPORT', 'SIMULATOR', 'MANUAL');

-- CreateEnum
CREATE TYPE "EventOutcome" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'INVALID', 'FAILED');

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "allocated_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'UNPAID',
    "dispute_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "external_reference" TEXT NOT NULL,
    "bill_reference" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "allocated_cents" INTEGER NOT NULL DEFAULT 0,
    "payer_phone" TEXT,
    "payer_name" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNMATCHED',
    "dispute_note" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "provider" "Provider" NOT NULL,
    "source" "EventSource" NOT NULL,
    "batch_id" TEXT,
    "external_reference" TEXT,
    "raw_payload" JSONB NOT NULL,
    "outcome" "EventOutcome" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "source" "AllocationSource" NOT NULL,
    "status" "AllocationStatus" NOT NULL,
    "signals" JSONB,
    "decided_by_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_business_id_idx" ON "users"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_business_id_key" ON "customers"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_phone_key" ON "customers"("business_id", "phone");

-- CreateIndex
CREATE INDEX "orders_business_id_status_created_at_idx" ON "orders"("business_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_reference_key" ON "orders"("business_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_business_id_key" ON "orders"("id", "business_id");

-- CreateIndex
CREATE INDEX "payments_business_id_status_idx" ON "payments"("business_id", "status");

-- CreateIndex
CREATE INDEX "payments_business_id_paid_at_idx" ON "payments"("business_id", "paid_at" DESC);

-- CreateIndex
CREATE INDEX "payments_business_id_bill_reference_idx" ON "payments"("business_id", "bill_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_business_id_provider_external_reference_key" ON "payments"("business_id", "provider", "external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_business_id_key" ON "payments"("id", "business_id");

-- CreateIndex
CREATE INDEX "payment_events_business_id_received_at_idx" ON "payment_events"("business_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "payment_events_business_id_outcome_idx" ON "payment_events"("business_id", "outcome");

-- CreateIndex
CREATE INDEX "payment_events_batch_id_idx" ON "payment_events"("batch_id");

-- CreateIndex
CREATE INDEX "allocations_payment_id_idx" ON "allocations"("payment_id");

-- CreateIndex
CREATE INDEX "allocations_order_id_idx" ON "allocations"("order_id");

-- CreateIndex
CREATE INDEX "allocations_business_id_status_idx" ON "allocations"("business_id", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_business_id_fkey" FOREIGN KEY ("customer_id", "business_id") REFERENCES "customers"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_business_id_fkey" FOREIGN KEY ("payment_id", "business_id") REFERENCES "payments"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_payment_id_business_id_fkey" FOREIGN KEY ("payment_id", "business_id") REFERENCES "payments"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_id_business_id_fkey" FOREIGN KEY ("order_id", "business_id") REFERENCES "orders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
