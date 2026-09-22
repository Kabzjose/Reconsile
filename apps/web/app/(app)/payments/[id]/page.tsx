"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, X as XIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import type { Order, Paginated, PaymentDetail } from "@/lib/types";
import { Money } from "@/components/Money";
import { StatusDot } from "@/components/StatusDot";
import { paymentStatusMeta, providerLabel } from "@/lib/status";
import { dateTime, phone } from "@/lib/format";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Modal } from "@/components/Modal";
import { Field, inputClass } from "@/components/Field";

export default function PaymentDetailPage() {
  const { handleError } = useAuthGuard();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [manualPicker, setManualPicker] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ data: PaymentDetail }>(`/api/payments/${params.id}`)
      .then((res) => setPayment(res.data))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else handleError(err);
      })
      .finally(() => setLoading(false));
  }, [params.id, handleError]);

  useEffect(load, [load]);

  async function act(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (notFound) {
    return (
      <div className="px-8 py-10">
        <Notice tone="slate">Payment not found.</Notice>
      </div>
    );
  }
  if (loading && !payment) {
    return (
      <div className="flex h-64 items-center justify-center text-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (!payment) return null;

  const meta = paymentStatusMeta[payment.status];
  const suggestions = payment.allocations.filter((a) => a.status === "SUGGESTED");
  const active = payment.allocations.filter((a) => a.status === "ACTIVE");
  const voided = payment.allocations.filter((a) => a.status === "VOIDED");

  return (
    <div>
      <header className="border-b border-line bg-paper-raised px-8 py-6">
        <button onClick={() => router.back()} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="tabular font-display text-[26px] italic text-ink">{payment.externalReference}</h1>
            <p className="mt-1 text-[13.5px] text-ink-soft">
              {providerLabel[payment.provider]} · {payment.payerName ?? phone(payment.payerPhone)} · {dateTime(payment.paidAt)}
            </p>
          </div>
          <StatusDot tone={meta.tone} label={meta.label} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {error && <Notice tone="red">{error}</Notice>}

          {payment.disputeNote && (
            <Notice tone="red">
              <span className="font-medium">Disputed:</span> {payment.disputeNote}
            </Notice>
          )}

          {suggestions.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-[15px] italic text-ink-soft">Possible matches</h2>
              <div className="flex flex-col gap-2">
                {suggestions.map((s) => (
                  <SuggestionCard key={s.id} allocation={s} busy={busyId === s.id} onConfirm={() => act(s.id, () => api.post(`/api/allocations/${s.id}/confirm`))} onVoid={() => act(s.id, () => api.post(`/api/allocations/${s.id}/void`, { reason: "Not the right order" }))} />
                ))}
              </div>
            </section>
          )}

          {active.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-[15px] italic text-ink-soft">Matched to</h2>
              <div className="overflow-hidden rounded-[4px] border border-line bg-paper-raised">
                <table className="w-full text-left text-[13.5px]">
                  <tbody>
                    {active.map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">
                          <Link href={`/orders/${a.orderId}`} className="tabular font-medium text-ink hover:underline">
                            {a.orderReference}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Money cents={a.amountCents} />
                        </td>
                        <td className="px-4 py-2.5 text-ink-faint">{a.source === "MANUAL" ? "Confirmed manually" : `Auto-matched · ${a.confidence}%`}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button variant="ghost" disabled={busyId === a.id} onClick={() => act(a.id, () => api.post(`/api/allocations/${a.id}/void`, {}))}>
                            Undo
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {payment.unallocatedCents > 0 && payment.status !== "DISPUTED" && (
            <Notice tone={suggestions.length > 0 ? "slate" : "amber"}>
              <div className="flex items-center justify-between gap-3">
                <span>
                  <Money cents={payment.unallocatedCents} /> of this payment hasn&apos;t been applied to any sale yet.
                </span>
                <Button variant="secondary" onClick={() => setManualPicker(true)}>
                  Choose an order
                </Button>
              </div>
            </Notice>
          )}

          {voided.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-[15px] italic text-ink-soft">History</h2>
              <div className="overflow-hidden rounded-[4px] border border-line bg-paper-raised">
                <table className="w-full text-left text-[13px] text-ink-faint">
                  <tbody>
                    {voided.map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">{a.orderReference}</td>
                        <td className="px-4 py-2 text-right">
                          <Money cents={a.amountCents} muted />
                        </td>
                        <td className="px-4 py-2">Voided{a.voidReason ? `: ${a.voidReason}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-[4px] border border-line bg-paper-raised p-4">
            <p className="text-[12px] uppercase tracking-wide text-ink-faint">Amount</p>
            <p className="tabular mt-1 font-display text-[22px] text-ink">
              <Money cents={payment.amountCents} />
            </p>
            <div className="mt-3 flex justify-between text-[13px]">
              <span className="text-ink-soft">Applied</span>
              <Money cents={payment.allocatedCents} />
            </div>
            <div className="mt-1 flex justify-between text-[13px]">
              <span className="text-ink-soft">Unapplied</span>
              <Money cents={payment.unallocatedCents} />
            </div>
          </section>

          <section className="rounded-[4px] border border-line bg-paper-raised p-4 text-[13px]">
            <p className="mb-2 text-[12px] uppercase tracking-wide text-ink-faint">Details</p>
            <Row label="Account quoted">{payment.billReference ?? "—"}</Row>
            <Row label="Phone">{phone(payment.payerPhone)}</Row>
            <Row label="Transaction id" mono>
              {payment.externalReference}
            </Row>
          </section>

          {payment.status !== "DISPUTED" ? (
            <Button disabled={!!busyId} onClick={() => setDisputing(true)}>
              Flag as disputed
            </Button>
          ) : (
            <Button disabled={!!busyId} onClick={() => act("resolve", () => api.post(`/api/payments/${payment.id}/resolve-dispute`))}>
              Resolve dispute
            </Button>
          )}
        </aside>
      </div>

      {disputing && (
        <DisputeDialog
          onClose={() => setDisputing(false)}
          onSubmit={async (note) => {
            await act("dispute", () => api.post(`/api/payments/${payment.id}/dispute`, { note }));
            setDisputing(false);
          }}
        />
      )}
      {manualPicker && (
        <ManualAllocateDialog
          paymentId={payment.id}
          onClose={() => setManualPicker(false)}
          onDone={() => {
            setManualPicker(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <span className="text-ink-faint">{label}</span>
      <span className={`text-right text-ink ${mono ? "tabular" : ""}`}>{children}</span>
    </div>
  );
}

function SuggestionCard({
  allocation,
  busy,
  onConfirm,
  onVoid,
}: {
  allocation: PaymentDetail["allocations"][number];
  busy: boolean;
  onConfirm: () => void;
  onVoid: () => void;
}) {
  const strong = allocation.confidence >= 70;
  return (
    <div className={`rounded-[4px] border p-4 ${strong ? "border-amber/30 bg-amber-bg" : "border-line bg-paper-raised"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/orders/${allocation.orderId}`} className="tabular font-display text-[17px] italic text-ink hover:underline">
            {allocation.orderReference}
          </Link>
          <p className="tabular mt-0.5 text-[13px] text-ink-soft">
            <Money cents={allocation.amountCents} /> of this payment would apply
          </p>
        </div>
        <span className={`tabular font-display text-[22px] ${strong ? "text-amber" : "text-ink-soft"}`}>{allocation.confidence}%</span>
      </div>
      {allocation.signals?.reasons && allocation.signals.reasons.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-0.5 text-[12.5px] text-ink-soft">
          {allocation.signals.reasons.map((reason, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-ink-faint">·</span> {reason}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={onConfirm} className="gap-1">
          <Check size={14} /> Confirm
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onVoid} className="gap-1">
          <XIcon size={14} /> Not this one
        </Button>
      </div>
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
          Flag payment
        </Button>
      </div>
    </Modal>
  );
}

function ManualAllocateDialog({ paymentId, onClose, onDone }: { paymentId: string; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Paginated<Order>>("/api/orders", { status: "UNPAID,PARTIAL", search: query || undefined, pageSize: 8 })
      .then((res) => !cancelled && setOrders(res.data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function pick(orderId: string) {
    setSubmittingId(orderId);
    setError(null);
    try {
      await api.post(`/api/payments/${paymentId}/allocations`, { orderId });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not allocate to that order.");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <Modal title="Choose an order" onClose={onClose} wide>
      {error && (
        <div className="mb-3">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search open orders…"
        className={inputClass}
      />
      <div className="mt-3 max-h-80 overflow-y-auto rounded-[4px] border border-line">
        {loading ? (
          <div className="flex justify-center py-8 text-ink-faint">
            <Spinner className="h-4 w-4" />
          </div>
        ) : orders.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-faint">No open orders match.</p>
        ) : (
          orders.map((order) => (
            <button
              key={order.id}
              onClick={() => pick(order.id)}
              disabled={!!submittingId}
              className="flex w-full items-center justify-between border-b border-line px-4 py-2.5 text-left text-[13.5px] last:border-0 hover:bg-paper disabled:opacity-50"
            >
              <span>
                <span className="tabular font-medium text-ink">{order.reference}</span>{" "}
                <span className="text-ink-faint">{order.customer?.name ?? "Walk-in"}</span>
              </span>
              <span className="tabular text-ink-soft">
                {submittingId === order.id ? <Spinner className="h-3.5 w-3.5" /> : <Money cents={order.balanceCents} />}
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
