export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-red">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-[3px] border border-line-strong bg-paper-raised px-2.5 py-1.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-ink outline-none";
