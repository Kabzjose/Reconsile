import type { Tone } from "@/lib/status";

const toneClass: Record<Tone, string> = {
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  slate: "bg-slate",
};
const textClass: Record<Tone, string> = {
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  slate: "text-ink-soft",
};

/** A stamped dot + label — the ledger's equivalent of a status badge, without the pill chrome. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${toneClass[tone]}`} aria-hidden />
      <span className={`text-[13px] font-medium ${textClass[tone]}`}>{label}</span>
    </span>
  );
}
