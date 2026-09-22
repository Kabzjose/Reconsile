"use client";

import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Field, inputClass } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { money } from "@/lib/format";

const SCENARIOS = [
  { id: "CLEAN", title: "Clean payment", body: "Exact account reference, amount fits — auto-matches instantly." },
  { id: "TILL_AMBIGUOUS", title: "Ambiguous Till payment", body: "No reference, several open orders share the amount — this is the hard case." },
  { id: "UNDERPAY", title: "Underpayment", body: "Less than the order's balance — a part-payment." },
  { id: "OVERPAY", title: "Overpayment", body: "More than the order owes — the excess is left unapplied." },
  { id: "ORPHAN", title: "Orphan payment", body: "Matches nothing at all — lands straight in review." },
  { id: "DUPLICATE", title: "Duplicate delivery", body: "The same transaction, delivered twice — proves idempotency." },
] as const;

interface ReconcileOutcome {
  outcome: string;
  reason: string;
  orderReference?: string;
  confidence?: number;
}
interface ScenarioResult {
  scenario: string;
  description: string;
  sent: { payload: Record<string, unknown>; result: { httpStatus: number; body: { status: string; reconciliation?: ReconcileOutcome | null } } }[];
}

export default function SimulatorPage() {
  const { handleError } = useAuthGuard();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string) {
    setRunningId(id);
    setError(null);
    try {
      const res = await api.post<{ data: ScenarioResult }>(`/api/simulator/scenarios/${id}`);
      setResults((prev) => [res.data, ...prev].slice(0, 8));
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else handleError(err);
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Test payments"
        description="Sends real webhook events through the same pipeline a payment provider would use — nothing here is faked."
      />

      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-[15px] italic text-ink-soft">Scenarios</h2>
          <div className="flex flex-col gap-2">
            {SCENARIOS.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-[4px] border border-line bg-paper-raised px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-medium text-ink">{s.title}</p>
                  <p className="text-[12.5px] text-ink-faint">{s.body}</p>
                </div>
                <Button variant="secondary" disabled={!!runningId} onClick={() => run(s.id)} className="shrink-0 gap-1.5">
                  {runningId === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Send size={13} />}
                  Send
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">
            <Link href="/orders" className="underline underline-offset-2">
              No unpaid orders?
            </Link>{" "}
            Some scenarios need at least one open order to aim at.
          </p>
          <CustomPaymentForm onSent={() => setError(null)} onError={setError} />
        </div>

        <div>
          <h2 className="mb-3 font-display text-[15px] italic text-ink-soft">Results</h2>
          {error && (
            <div className="mb-3">
              <Notice tone="red">{error}</Notice>
            </div>
          )}
          {results.length === 0 ? (
            <div className="rounded-[4px] border border-dashed border-line-strong px-4 py-10 text-center text-[13px] text-ink-faint">
              Send a scenario to see what the engine decided.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {results.map((r, i) => (
                <ResultCard key={i} result={r} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: ScenarioResult }) {
  return (
    <div className="enter rounded-[4px] border border-line bg-paper-raised p-4">
      <p className="text-[13px] font-medium text-ink">{result.description}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {result.sent.map((s, i) => {
          const rec = s.result.body.reconciliation;
          const tone = rec?.outcome === "AUTO_MATCHED" ? "text-green" : rec?.outcome === "SUGGESTED" ? "text-amber" : s.result.body.status === "duplicate" ? "text-slate" : "text-ink-soft";
          return (
            <p key={i} className={`text-[12.5px] ${tone}`}>
              {s.result.body.status === "duplicate"
                ? `Delivery ${i + 1}: recognised as a duplicate — no second payment created`
                : `Delivery ${i + 1}: ${rec ? `${rec.outcome}${rec.confidence ? ` (${rec.confidence}%)` : ""} — ${rec.reason}` : s.result.body.status}`}
            </p>
          );
        })}
      </div>
      <Link href="/payments" className="mt-2 inline-block text-[12px] text-ink-soft underline underline-offset-2">
        View in payments →
      </Link>
    </div>
  );
}

function CustomPaymentForm({ onSent, onError }: { onSent: () => void; onError: (message: string) => void }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountKes = Number(amount);
    if (!amountKes || amountKes <= 0) return onError("Enter an amount greater than zero.");
    setLoading(true);
    setSentNote(null);
    try {
      await api.post("/api/simulator/payments", { amountKes, reference: reference || undefined, phone: phone || undefined });
      setSentNote(`Sent a ${money(amountKes * 100)} payment${reference ? ` for ${reference}` : ""}.`);
      onSent();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not send that payment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-[4px] border border-line bg-paper-raised p-4">
      <h3 className="mb-3 text-[13px] font-medium text-ink">Send a custom payment</h3>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Amount (KSh)">
          <input className={inputClass} type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500" />
        </Field>
        <Field label="Reference (optional)">
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ORD-1003" />
        </Field>
        <Field label="Phone (optional)">
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={loading} className="gap-1.5">
          {loading ? <Spinner className="h-3.5 w-3.5" /> : <Send size={13} />}
          Send payment
        </Button>
        {sentNote && <span className="text-[12.5px] text-green">{sentNote}</span>}
      </div>
    </form>
  );
}
