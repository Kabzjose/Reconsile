import type { AllocationStatus, OrderStatus, PaymentStatus } from "./types";

// One place mapping every status to its meaning-colour and label, so the dot in a table row
// and the badge on a detail page never disagree.

export type Tone = "green" | "amber" | "red" | "slate";

export const orderStatusMeta: Record<OrderStatus, { label: string; tone: Tone }> = {
  UNPAID: { label: "Unpaid", tone: "slate" },
  PARTIAL: { label: "Partially paid", tone: "amber" },
  PAID: { label: "Paid", tone: "green" },
  DISPUTED: { label: "Disputed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
};

export const paymentStatusMeta: Record<PaymentStatus, { label: string; tone: Tone }> = {
  UNMATCHED: { label: "Unmatched", tone: "slate" },
  SUGGESTED: { label: "Needs review", tone: "amber" },
  PARTIAL: { label: "Partially matched", tone: "amber" },
  MATCHED: { label: "Matched", tone: "green" },
  DISPUTED: { label: "Disputed", tone: "red" },
};

export const allocationStatusMeta: Record<AllocationStatus, { label: string; tone: Tone }> = {
  SUGGESTED: { label: "Suggested", tone: "amber" },
  ACTIVE: { label: "Confirmed", tone: "green" },
  VOIDED: { label: "Voided", tone: "slate" },
};

export const providerLabel: Record<string, string> = {
  MPESA: "M-Pesa",
  BANK: "Bank",
  STRIPE: "Card",
  MANUAL: "Cash / manual",
};
