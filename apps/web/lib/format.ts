// Money is integer cents everywhere it crosses the API; every screen formats through here so a
// "* 100" or "/ 100" mistake can't happen in twelve different components.

export function money(cents: number): string {
  return "KSh " + (cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact form for space-constrained spots (stat tiles): KSh 84.5K instead of KSh 84,500.00. */
export function moneyCompact(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) < 1000) return money(cents);
  const units: [number, string][] = [
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [threshold, suffix] of units) {
    if (Math.abs(value) >= threshold) {
      return "KSh " + (value / threshold).toLocaleString("en-KE", { maximumFractionDigits: 1 }) + suffix;
    }
  }
  return money(cents);
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dateOnly(iso);
}

export function phone(value: string | null): string {
  if (!value) return "—";
  // 254712345678 -> 0712 345 678
  const match = value.match(/^254(\d{3})(\d{3})(\d{3})$/);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : value;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
