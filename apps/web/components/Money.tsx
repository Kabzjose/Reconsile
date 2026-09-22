import { money } from "@/lib/format";

export function Money({ cents, muted = false }: { cents: number; muted?: boolean }) {
  return <span className={`tabular ${muted ? "text-ink-faint" : ""}`}>{money(cents)}</span>;
}
