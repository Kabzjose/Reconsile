"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import type { Order, OrderStatus, Paginated } from "@/lib/types";
import { Money } from "@/components/Money";
import { StatusDot } from "@/components/StatusDot";
import { orderStatusMeta } from "@/lib/status";
import { dateOnly } from "@/lib/format";
import { Spinner } from "@/components/Spinner";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { NewOrderDialog } from "./NewOrderDialog";
import { Button } from "@/components/Button";

const STATUS_FILTERS: { label: string; value: OrderStatus[] | null }[] = [
  { label: "All", value: null },
  { label: "Unpaid", value: ["UNPAID", "PARTIAL"] },
  { label: "Paid", value: ["PAID"] },
  { label: "Disputed", value: ["DISPUTED"] },
  { label: "Cancelled", value: ["CANCELLED"] },
];

export default function OrdersPage() {
  const { handleError } = useAuthGuard();
  const router = useRouter();
  const params = useSearchParams();
  const [result, setResult] = useState<Paginated<Order> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [showNew, setShowNew] = useState(false);

  const statusParam = params.get("status");
  const page = Number(params.get("page") ?? "1");
  const activeFilter = STATUS_FILTERS.find((f) => f.value?.join(",") === statusParam) ?? STATUS_FILTERS[0];

  function setParams(next: Record<string, string | undefined>) {
    const usp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) usp.set(k, v);
      else usp.delete(k);
    }
    router.push(`/orders?${usp.toString()}`);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<Order>>("/api/orders", { status: statusParam ?? undefined, search: search || undefined, page, pageSize: 20 })
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
      <PageHeader
        title="Sales"
        description="Every order you've recorded, and how much of it has been paid."
        action={
          <Button variant="primary" onClick={() => setShowNew(true)}>
            New order
          </Button>
        }
      />

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
          placeholder="Search reference or customer…"
          className="w-64 rounded-[3px] border border-line-strong bg-paper-raised px-2.5 py-1.5 text-[13px] outline-none focus:border-ink"
        />
      </div>

      <div className="px-8 py-6">
        {loading && !result ? (
          <div className="flex h-40 items-center justify-center text-ink-faint">
            <Spinner className="h-5 w-5" />
          </div>
        ) : result && result.data.length === 0 ? (
          <EmptyState title="No orders here" body="Try a different filter, or create your first order." />
        ) : (
          <div className="enter overflow-hidden rounded-[4px] border border-line bg-paper-raised">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Reference</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {result?.data.map((order) => (
                  <tr key={order.id} className="border-b border-line last:border-0 hover:bg-paper">
                    <td className="px-4 py-2.5">
                      <Link href={`/orders/${order.id}`} className="tabular font-medium text-ink hover:underline">
                        {order.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{order.customer?.name ?? "Walk-in"}</td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-ink-soft">{order.description ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Money cents={order.amountCents} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money cents={order.balanceCents} muted={order.balanceCents === 0} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusDot tone={orderStatusMeta[order.status].tone} label={orderStatusMeta[order.status].label} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink-faint">{dateOnly(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result && <Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} onPage={(p) => setParams({ page: String(p) })} />}
          </div>
        )}
      </div>

      {showNew && (
        <NewOrderDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            setParams({ page: undefined });
          }}
        />
      )}
    </div>
  );
}
