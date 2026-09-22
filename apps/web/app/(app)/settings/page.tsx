"use client";

import { useEffect, useState } from "react";
import { Copy, RefreshCw, Check } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { api, ApiError, API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import type { Business } from "@/lib/types";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Spinner } from "@/components/Spinner";

export default function SettingsPage() {
  const { handleError } = useAuthGuard();
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: Business }>("/api/business")
      .then((res) => setBusiness(res.data))
      .catch(handleError)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  async function rotate() {
    if (!confirm("Rotating the secret immediately invalidates the old one. Any payment provider already configured will need the new secret. Continue?")) return;
    setRotating(true);
    setError(null);
    try {
      setBusiness(await api.post<{ data: Business }>("/api/business/webhook-secret/rotate").then((r) => r.data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rotate the secret.");
    } finally {
      setRotating(false);
    }
  }

  if (loading || !business) {
    return (
      <div className="flex h-64 items-center justify-center text-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const webhookUrl = `${API_URL}${business.webhookPath}`;

  return (
    <div>
      <PageHeader title="Settings" description="Your business's webhook, for connecting a real payment provider." />

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
        {error && <Notice tone="red">{error}</Notice>}

        <section className="rounded-[4px] border border-line bg-paper-raised p-4">
          <p className="mb-3 text-[12px] uppercase tracking-wide text-ink-faint">Webhook endpoint</p>
          <CopyRow label="url" value={webhookUrl} copied={copied} onCopy={copy} />
          <div className="mt-3">
            <CopyRow label="secret" value={business.webhookSecret} copied={copied} onCopy={copy} mono masked />
          </div>
          <p className="mt-3 text-[12.5px] text-ink-faint">
            Every request must be signed: <code className="text-ink-soft">X-Reconcile-Signature: sha256=&lt;hmac-sha256 of the raw body, using this secret&gt;</code>.
          </p>
          <div className="mt-3">
            <Button variant="danger" disabled={rotating} onClick={rotate} className="gap-1.5">
              {rotating ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw size={13} />}
              Rotate secret
            </Button>
          </div>
        </section>

        <section className="rounded-[4px] border border-line bg-paper-raised p-4">
          <p className="mb-1 text-[12px] uppercase tracking-wide text-ink-faint">Business</p>
          <p className="text-[14px] text-ink">{business.name}</p>
          <p className="tabular text-[12.5px] text-ink-faint">ID: {business.id}</p>
        </section>
      </div>
    </div>
  );
}

function CopyRow({ label, value, copied, onCopy, mono = false, masked = false }: { label: string; value: string; copied: string | null; onCopy: (label: string, value: string) => void; mono?: boolean; masked?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[3px] border border-line-strong bg-paper px-2.5 py-1.5">
      <code className={`flex-1 truncate text-[12.5px] text-ink ${mono ? "tabular" : ""}`}>{masked ? value.slice(0, 8) + "…" + value.slice(-6) : value}</code>
      <button onClick={() => onCopy(label, value)} className="shrink-0 text-ink-faint hover:text-ink">
        {copied === label ? <Check size={14} className="text-green" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
