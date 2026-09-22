"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import type { DashboardSummary } from "@/lib/types";
import { money, moneyCompact, dateTime } from "@/lib/format";
import { providerLabel } from "@/lib/status";
import { StatusDot } from "@/components/StatusDot";
import { paymentStatusMeta } from "@/lib/status";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
] as const;

export default function DashboardPage() {
  const { handleError } = useAuthGuard();
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("7d");
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<{ data: DashboardSummary }>("/api/dashboard/summary", { range })
      .then((res) => !cancelled && setData(res.data))
      .catch(handleError)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, handleError]);

  return (
    <div>
      <PageHeader
        title="Today's reconciliation"
        description="Sales, payments, and how much of that money is actually tied together."
        action={
          <div className="flex gap-1 rounded-[4px] border border-line bg-paper p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`rounded-[3px] px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                  range === r.value ? "bg-ink text-paper-raised" : "text-ink-soft hover:text-ink"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-8 py-6">
        {loading && !data ? (
          <div className="flex h-40 items-center justify-center text-ink-faint">
            <Spinner className="h-5 w-5" />
          </div>
        ) : data ? (
          <div className="enter flex flex-col gap-8">
            <StatTiles data={data} />

            {data.needsReviewCount > 0 && (
              <Link
                href="/payments?status=UNMATCHED,SUGGESTED"
                className="flex items-center justify-between rounded-[4px] border border-amber/30 bg-amber-bg px-4 py-3 text-amber transition-colors hover:border-amber/60"
              >
                <span className="text-[14px] font-medium">
                  {data.needsReviewCount} payment{data.needsReviewCount === 1 ? "" : "s"} waiting for review
                </span>
                <span className="text-[13px] underline underline-offset-2">Review now →</span>
              </Link>
            )}

            <section>
              <h2 className="mb-3 font-display text-[15px] italic text-ink-soft">Recent transactions</h2>
              {data.recent.length === 0 ? (
                <EmptyState title="Nothing yet" body="Payments will show up here as they arrive." />
              ) : (
                <div className="overflow-hidden rounded-[4px] border border-line bg-paper-raised">
                  <table className="w-full text-left text-[13.5px]">
                    <thead>
                      <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-faint">
                        <th className="px-4 py-2.5 font-medium">Reference</th>
                        <th className="px-4 py-2.5 font-medium">Provider</th>
                        <th className="px-4 py-2.5 font-medium">Order</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 text-right font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((row) => (
                        <tr key={row.id} className="border-b border-line last:border-0 hover:bg-paper">
                          <td className="px-4 py-2.5">
                            <Link href={`/payments/${row.id}`} className="tabular font-medium text-ink hover:underline">
                              {row.externalReference}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-ink-soft">{providerLabel[row.provider]}</td>
                          <td className="px-4 py-2.5 text-ink-soft">
                            {row.matchedOrders.length > 0
                              ? row.matchedOrders.join(", ")
                              : row.suggestedOrder
                                ? `${row.suggestedOrder.reference} (${row.suggestedOrder.confidence}%)`
                                : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="tabular">{money(row.amountCents)}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusDot tone={paymentStatusMeta[row.status].tone} label={paymentStatusMeta[row.status].label} />
                          </td>
                          <td className="px-4 py-2.5 text-right text-ink-faint">{dateTime(row.paidAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatTiles({ data }: { data: DashboardSummary }) {
  const tiles = [
    { label: "Sales", value: data.salesCents, hint: "Total sold in this period" },
    { label: "Payments received", value: data.paymentsReceivedCents, hint: "Money that has come in" },
    { label: "Matched", value: data.matchedCents, hint: "Tied to a specific sale" },
    { label: "Unmatched payments", value: data.unmatchedPaymentsCents, hint: "Received, not yet claimed", warn: data.unmatchedPaymentsCents > 0 },
    { label: "Unpaid sales", value: data.unpaidSalesCents, hint: "Sold, not yet paid for", warn: data.unpaidSalesCents > 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-paper-raised px-4 py-4">
          <p className="text-[12px] text-ink-faint">{tile.label}</p>
          <p className={`tabular mt-1 font-display text-[22px] ${tile.warn ? "text-amber" : "text-ink"}`}>{moneyCompact(tile.value)}</p>
        </div>
      ))}
      <div className="bg-paper-raised px-4 py-4">
        <p className="text-[12px] text-ink-faint">Reconciliation rate</p>
        <p className="tabular mt-1 font-display text-[22px] text-ink">
          {data.reconciliationRate === null ? "—" : `${data.reconciliationRate}%`}
        </p>
      </div>
    </div>
  );
}
