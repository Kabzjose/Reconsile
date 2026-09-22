"use client";

import { AppShell } from "@/components/AppShell";
import { useAuthGuard } from "@/lib/auth";
import { Spinner } from "@/components/Spinner";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthGuard();

  if (loading || !session) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
