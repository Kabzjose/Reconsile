import type { Tone } from "@/lib/status";

const toneClass: Record<Tone, string> = {
  green: "border-green/30 bg-green-bg text-green",
  amber: "border-amber/30 bg-amber-bg text-amber",
  red: "border-red/30 bg-red-bg text-red",
  slate: "border-line-strong bg-paper-raised text-ink-soft",
};

export function Notice({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return <div className={`rounded-[3px] border px-3 py-2 text-[13px] ${toneClass[tone]}`}>{children}</div>;
}
