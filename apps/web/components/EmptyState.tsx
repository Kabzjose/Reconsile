export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="font-display text-lg italic text-ink-soft">{title}</p>
      {body ? <p className="max-w-sm text-[13px] text-ink-faint">{body}</p> : null}
    </div>
  );
}
