"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import type { Payment, PaymentStatus, Paginated } from "@/lib/types";
import { Money } from "@/components/Money";
import { StatusDot } from "@/components/StatusDot";
import { paymentStatusMeta, providerLabel } from "@/lib/status";
import { dateTime, phone } from "@/lib/format";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";

const STATUS_FILTERS: { label: string; value: PaymentStatus[] | null }[] = [
  { label: "All", value: null },
  { label: "Needs review", value: ["UNMATCHED", "SUGGESTED", "PARTIAL"] },
  { label: "Matched", value: ["MATCHED"] },
  { label: "Disputed", value: ["DISPUTED"] },
];

export default function PaymentsPage() {
  const { handleError } = useAuthGuard();
  const router = useRouter();
  const params = useSearchParams();
  const [result, setResult] = useState<Paginated<Payment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get("search") ?? "");

  const statusParam = params.get("status");
  const page = Number(params.get("page") ?? "1");
  const activeFilter = STATUS_FILTERS.find((f) => f.value?.join(",") === statusParam) ?? STATUS_FILTERS[0];

  function setParams(next: Record<string, string | undefined>) {
    const usp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) usp.set(k, v);
      else usp.delete(k);
    }
    router.push(`/payments?${usp.toString()}`);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<Payment>>("/api/payments", { status: statusParam ?? undefined, search: search || undefined, page, pageSize: 20 })
      .then((res) => !cancelled && setResult(res))
      .catch(handleError)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, search, page]);

  return (
    <div>
      <PageHeader title="Payments" description="Everything that has come in, and what it's been matched to." />

      <div className="flex items-center justify-between gap-4 border-b border-line bg-paper px-8 py-3">
        <div className="flex gap-1 rounded-[4px] border border-line bg-paper-raised p-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setParams({ status: f.value?.join(","), page: undefined })}
              className={`rounded-[3px] px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                f === activeFilter ? "bg-ink text-paper-raised" : "text-ink-soft hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setParams({ search: search || undefined, page: undefined })}
          onBlur={() => setParams({ search: search || undefined, page: undefined })}
          placeholder="Search reference, phone, payer…"
          className="w-64 rounded-[3px] border border-line-strong bg-paper-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-ink"
        />
      </div>

      <div className="px-8 py-6">
        {loading && !result ? (
          <div className="flex h-40 items-center justify-center text-ink-faint">
            <Spinner className="h-5 w-5" />
          </div>
        ) : result && result.data.length === 0 ? (
          <EmptyState title="No payments here" body="Try a different filter, or send a test payment from the Test payments page." />
        ) : (
          <div className="enter overflow-hidden rounded-[4px] border border-line bg-paper-raised">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Reference</th>
                  <th className="px-4 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">From</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Best match</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {result?.data.map((payment) => (
                  <PaymentRow key={payment.id} payment={payment} />
                ))}
              </tbody>
            </table>
            {result && <Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} onPage={(p) => setParams({ page: String(p) })} />}
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  const meta = paymentStatusMeta[payment.status];
  return (
    <tr className="border-b border-line last:border-0 hover:bg-paper">
      <td className="px-4 py-2.5">
        <Link href={`/payments/${payment.id}`} className="tabular font-medium text-ink hover:underline">
          {payment.externalReference}
        </Link>
        {payment.billReference && <span className="tabular ml-1.5 text-[12px] text-ink-faint">→ {payment.billReference}</span>}
      </td>
      <td className="px-4 py-2.5 text-ink-soft">{providerLabel[payment.provider]}</td>
      <td className="px-4 py-2.5 text-ink-soft">{payment.payerName ?? phone(payment.payerPhone)}</td>
      <td className="px-4 py-2.5 text-right">
        <Money cents={payment.amountCents} />
      </td>
      <td className="px-4 py-2.5">
        <StatusDot tone={meta.tone} label={meta.label} />
      </td>
      <td className="px-4 py-2.5">
        {payment.topSuggestion ? (
          <span className="text-ink-soft">
            {payment.topSuggestion.orderReference} <span className="tabular text-ink-faint">({payment.topSuggestion.confidence}%)</span>
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right text-ink-faint">{dateTime(payment.paidAt)}</td>
    </tr>
  );
}
