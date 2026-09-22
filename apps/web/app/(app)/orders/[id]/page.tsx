"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import type { OrderDetail } from "@/lib/types";
import { Money } from "@/components/Money";
import { StatusDot } from "@/components/StatusDot";
import { orderStatusMeta, allocationStatusMeta, providerLabel } from "@/lib/status";
import { dateTime, phone } from "@/lib/format";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Modal } from "@/components/Modal";
import { Field, inputClass } from "@/components/Field";

export default function OrderDetailPage() {
  const { handleError } = useAuthGuard();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ data: OrderDetail }>(`/api/orders/${params.id}`)
      .then((res) => setOrder(res.data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else handleError(err);
      })
      .finally(() => setLoading(false));
  }, [params.id, handleError]);

  useEffect(load, [load]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="px-8 py-10">
        <Notice tone="slate">Order not found.</Notice>
      </div>
    );
  }
  if (loading && !order) {
    return (
      <div className="flex h-64 items-center justify-center text-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (!order) return null;

  const meta = orderStatusMeta[order.status];

  return (
    <div>
      <header className="border-b border-line bg-paper-raised px-8 py-6">
        <button onClick={() => router.back()} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="tabular font-display text-[26px] italic text-ink">{order.reference}</h1>
            <p className="mt-1 text-[13.5px] text-ink-soft">{order.description ?? "No description"}</p>
          </div>
          <StatusDot tone={meta.tone} label={meta.label} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section className="rounded-[4px] border border-line bg-paper-raised">
            <div className="border-b border-line px-4 py-2.5 text-[12px] uppercase tracking-wide text-ink-faint">Payments applied</div>
            {order.allocations.filter((a) => a.status !== "VOIDED").length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-ink-faint">No payments applied yet.</p>
            ) : (
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-2 font-medium">Payment</th>
                    <th className="px-4 py-2 font-medium">Provider</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {order.allocations
                    .filter((a) => a.status !== "VOIDED")
                    .map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">
                          <Link href={`/payments/${a.paymentId}`} className="tabular font-medium text-ink hover:underline">
                            {a.paymentReference}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-ink-soft">{providerLabel[a.provider]}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Money cents={a.amountCents} />
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusDot tone={allocationStatusMeta[a.status].tone} label={allocationStatusMeta[a.status].label} />
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-faint">{dateTime(a.paidAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

          {order.disputeNote && (
            <div className="mt-4">
              <Notice tone="red">
                <span className="font-medium">Disputed:</span> {order.disputeNote}
              </Notice>
            </div>
          )}
          {error && (
            <div className="mt-4">
              <Notice tone="red">{error}</Notice>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-[4px] border border-line bg-paper-raised p-4">
            <p className="text-[12px] uppercase tracking-wide text-ink-faint">Amount</p>
            <p className="tabular mt-1 font-display text-[22px] text-ink">
              <Money cents={order.amountCents} />
            </p>
            <div className="mt-3 flex justify-between text-[13px]">
              <span className="text-ink-soft">Paid</span>
              <Money cents={order.allocatedCents} />
            </div>
            <div className="mt-1 flex justify-between text-[13px]">
              <span className="text-ink-soft">Balance</span>
              <Money cents={order.balanceCents} />
            </div>
          </section>

          <section className="rounded-[4px] border border-line bg-paper-raised p-4">
            <p className="text-[12px] uppercase tracking-wide text-ink-faint">Customer</p>
            {order.customer ? (
              <>
                <p className="mt-1 text-[14px] text-ink">{order.customer.name}</p>
                <p className="tabular text-[13px] text-ink-soft">{phone(order.customer.phone)}</p>
              </>
            ) : (
              <p className="mt-1 text-[13.5px] text-ink-faint">Walk-in customer</p>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-[4px] border border-line bg-paper-raised p-4">
            <p className="mb-1 text-[12px] uppercase tracking-wide text-ink-faint">Actions</p>
            {order.status === "DISPUTED" ? (
              <Button disabled={busy} onClick={() => act(() => api.post(`/api/orders/${order.id}/resolve-dispute`))}>
                Resolve dispute
              </Button>
            ) : (
              order.status !== "CANCELLED" && (
                <Button disabled={busy} onClick={() => setDisputing(true)}>
                  Flag as disputed
                </Button>
              )
            )}
            {(order.status === "UNPAID" || order.status === "DISPUTED") && order.allocatedCents === 0 && (
              <Button variant="danger" disabled={busy} onClick={() => act(() => api.post(`/api/orders/${order.id}/cancel`))}>
                Cancel order
              </Button>
            )}
          </section>
        </aside>
      </div>

      {disputing && (
        <DisputeDialog
          onClose={() => setDisputing(false)}
          onSubmit={async (note) => {
            await act(() => api.post(`/api/orders/${order.id}/dispute`, { note }));
            setDisputing(false);
          }}
        />
      )}
    </div>
  );
}

function DisputeDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return (
    <Modal title="Flag as disputed" onClose={onClose}>
      <Field label="What's the issue?">
        <textarea className={`${inputClass} min-h-24 resize-none`} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={note.trim().length < 3 || submitting}
          onClick={async () => {
            setSubmitting(true);
            await onSubmit(note.trim());
            setSubmitting(false);
          }}
        >
          Flag order
        </Button>
      </div>
    </Modal>
  );
}
