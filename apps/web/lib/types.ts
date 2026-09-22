// Mirrors the shapes the API actually returns (see apps/api's mapper.ts files for each module).
// Money is always integer cents; format with lib/format.ts before displaying it.

export type OrderStatus = "UNPAID" | "PARTIAL" | "PAID" | "DISPUTED" | "CANCELLED";
export type PaymentStatus = "UNMATCHED" | "SUGGESTED" | "PARTIAL" | "MATCHED" | "DISPUTED";
export type AllocationStatus = "SUGGESTED" | "ACTIVE" | "VOIDED";
export type Provider = "MPESA" | "BANK" | "STRIPE" | "MANUAL";

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
}

export interface Order {
  id: string;
  reference: string;
  description: string | null;
  amountCents: number;
  allocatedCents: number;
  balanceCents: number;
  status: OrderStatus;
  disputeNote: string | null;
  customer: Customer | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderAllocationRow {
  id: string;
  paymentId: string;
  paymentReference: string;
  provider: Provider;
  paymentAmountCents: number;
  paidAt: string;
  amountCents: number;
  confidence: number;
  source: string;
  status: AllocationStatus;
  createdAt: string;
  voidReason: string | null;
}

export interface OrderDetail extends Order {
  allocations: OrderAllocationRow[];
}

export interface TopSuggestion {
  allocationId: string;
  orderId: string;
  orderReference: string;
  confidence: number;
  amountCents: number;
}

export interface Payment {
  id: string;
  provider: Provider;
  externalReference: string;
  billReference: string | null;
  amountCents: number;
  allocatedCents: number;
  unallocatedCents: number;
  payerPhone: string | null;
  payerName: string | null;
  status: PaymentStatus;
  disputeNote: string | null;
  paidAt: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  topSuggestion: TopSuggestion | null;
}

export interface PaymentAllocationRow {
  id: string;
  orderId: string;
  orderReference: string;
  orderAmountCents: number | null;
  orderBalanceCents: number | null;
  orderStatus: string | null;
  amountCents: number;
  confidence: number;
  source: string;
  status: AllocationStatus;
  signals: { reasons?: string[]; decision?: string } | null;
  createdAt: string;
  confirmedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PaymentDetail extends Payment {
  allocations: PaymentAllocationRow[];
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DashboardSummary {
  range: string;
  salesCents: number;
  paymentsReceivedCents: number;
  matchedCents: number;
  unmatchedPaymentsCents: number;
  unpaidSalesCents: number;
  disputedCents: number;
  reconciliationRate: number | null;
  needsReviewCount: number;
  recent: {
    id: string;
    provider: Provider;
    externalReference: string;
    amountCents: number;
    status: PaymentStatus;
    paidAt: string;
    matchedOrders: string[];
    suggestedOrder: { reference: string; confidence: number } | null;
  }[];
}

export interface Business {
  id: string;
  name: string;
  webhookSecret: string;
  webhookPath: string;
  simulatorEnabled: boolean;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
  business: { id: string; name: string };
}
