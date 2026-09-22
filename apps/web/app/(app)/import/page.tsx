"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { api, ApiError, API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/auth";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Spinner } from "@/components/Spinner";

interface ImportSummary {
  batchId: string;
  rowsRead: number;
  imported: number;
  duplicates: number;
  autoMatched: number;
  suggested: number;
  needsReview: number;
  skippedRows: number;
  invalidRows: number;
  failed: number;
  errors: { line: number; message: string }[];
}

export default function ImportPage() {
  const { session, handleError } = useAuthGuard();
  const fileInput = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<"MPESA" | "BANK">("MPESA");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setError(null);
    setSummary(null);
    setLoading(true);
    try {
      const csv = await file.text();
      const res = await api.post<{ data: ImportSummary }>("/api/imports/payments", { csv, provider });
      setSummary(res.data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else handleError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="Import a statement" description="Upload an M-Pesa or bank statement CSV. Every payment is matched automatically, the same as a live payment." />

      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-5 flex items-center justify-between rounded-[4px] border border-line bg-paper-raised px-4 py-3">
          <div>
            <p className="text-[13.5px] font-medium text-ink">No statement handy?</p>
            <p className="text-[12.5px] text-ink-faint">Download a realistic sample built from your current open orders.</p>
          </div>
          <a
            href={`${API_URL}/api/imports/sample`}
            onClick={(e) => {
              // The endpoint needs the bearer token, which a plain link can't send — fetch it and download client-side instead.
              e.preventDefault();
              fetch(`${API_URL}/api/imports/sample`, { headers: { Authorization: `Bearer ${session?.token}` } })
                .then((r) => r.blob())
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "sample-mpesa-statement.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                });
            }}
          >
            <Button variant="secondary" className="gap-1.5">
              <Download size={14} /> Download sample
            </Button>
          </a>
        </div>

        <div className="mb-4 flex gap-1 rounded-[4px] border border-line bg-paper-raised p-0.5 w-fit">
          {(["MPESA", "BANK"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`rounded-[3px] px-3 py-1 text-[12.5px] font-medium transition-colors ${
                provider === p ? "bg-ink text-paper-raised" : "text-ink-soft hover:text-ink"
              }`}
            >
              {p === "MPESA" ? "M-Pesa" : "Bank"}
            </button>
          ))}
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onClick={() => fileInput.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-line-strong bg-paper-raised px-6 py-14 text-center transition-colors hover:border-ink"
        >
          <Upload size={22} className="text-ink-faint" />
          <p className="text-[14px] font-medium text-ink">{fileName ?? "Drop a CSV here, or click to choose one"}</p>
          <p className="text-[12.5px] text-ink-faint">Works with M-Pesa&apos;s own export format, and most bank CSVs</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        {loading && (
          <div className="mt-5 flex items-center gap-2 text-ink-soft">
            <Spinner className="h-4 w-4" /> Reading and matching…
          </div>
        )}
        {error && (
          <div className="mt-5">
            <Notice tone="red">{error}</Notice>
          </div>
        )}
        {summary && <ImportResult summary={summary} />}
      </div>
    </div>
  );
}

function ImportResult({ summary }: { summary: ImportSummary }) {
  const tiles = [
    { label: "Rows read", value: summary.rowsRead },
    { label: "Imported", value: summary.imported },
    { label: "Auto-matched", value: summary.autoMatched, tone: "green" as const },
    { label: "Needs review", value: summary.suggested + summary.needsReview, tone: "amber" as const },
    { label: "Duplicates skipped", value: summary.duplicates },
    { label: "Not a payment (withdrawals etc.)", value: summary.skippedRows },
  ];
  return (
    <div className="enter mt-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="bg-paper-raised px-4 py-3">
            <p className="text-[11.5px] text-ink-faint">{t.label}</p>
            <p className={`tabular mt-0.5 font-display text-[20px] ${t.tone === "green" ? "text-green" : t.tone === "amber" ? "text-amber" : "text-ink"}`}>{t.value}</p>
          </div>
        ))}
      </div>
      {summary.errors.length > 0 && (
        <div className="mt-4">
          <Notice tone="amber">
            <p className="mb-1 font-medium">{summary.errors.length} row(s) needed a closer look:</p>
            <ul className="flex flex-col gap-0.5">
              {summary.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
      <p className="mt-4 text-[13px] text-ink-soft">
        Check the <Link href="/payments?status=UNMATCHED,SUGGESTED" className="underline underline-offset-2">payments needing review</Link> to confirm or correct any matches.
      </p>
    </div>
  );
}
