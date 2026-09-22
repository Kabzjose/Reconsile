"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ReceiptText, Wallet, Upload, FlaskConical, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/payments", label: "Payments", icon: Wallet },
  { href: "/orders", label: "Sales", icon: ReceiptText },
  { href: "/import", label: "Import statement", icon: Upload },
  { href: "/simulator", label: "Test payments", icon: FlaskConical },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, logout } = useAuth();

  return (
    <div className="flex min-h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-paper-raised">
        <div className="border-b border-line px-5 py-5">
          <p className="font-display text-[20px] italic leading-tight text-ink">Reconcile</p>
          <p className="mt-0.5 truncate text-[12px] text-ink-faint">{session?.business.name}</p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13.5px] font-medium transition-colors ${
                  active ? "bg-ink text-paper-raised" : "text-ink-soft hover:bg-paper hover:text-ink"
                }`}
              >
                <Icon size={16} strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line px-2 py-3">
          <Link
            href="/settings"
            className={`flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13.5px] font-medium transition-colors ${
              pathname === "/settings" ? "bg-ink text-paper-raised" : "text-ink-soft hover:bg-paper hover:text-ink"
            }`}
          >
            <Settings size={16} />
            Settings
          </Link>
          <div className="mt-2 flex items-center gap-2.5 rounded-[3px] px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-line text-[11px] font-semibold text-ink-soft">
              {initials(session?.user.email ?? "?")}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{session?.user.email}</span>
            <button
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="shrink-0 text-ink-faint hover:text-red"
              title="Log out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line bg-paper-raised px-8 py-6">
      <div>
        <h1 className="font-display text-[26px] italic leading-none text-ink">{title}</h1>
        {description ? <p className="mt-1.5 text-[13.5px] text-ink-soft">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
