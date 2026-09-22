"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Field, inputClass } from "@/components/Field";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Spinner } from "@/components/Spinner";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("demo@reconcile.app");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Is the API running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <p className="font-display text-[22px] italic text-ink">Welcome back</p>
      <p className="mt-1 text-[13.5px] text-ink-soft">Log in to your reconciliation ledger.</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Field label="Email">
          <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <input className={inputClass} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={loading} className="mt-1 w-full py-2">
          {loading ? <Spinner className="h-4 w-4" /> : "Log in"}
        </Button>
      </form>

      <p className="mt-5 text-[13px] text-ink-soft">
        New here?{" "}
        <Link href="/register" className="font-medium text-ink underline underline-offset-2">
          Create a business account
        </Link>
      </p>

      <div className="mt-5 border-t border-line pt-4 text-[12.5px] text-ink-faint">
        Demo login: <span className="tabular text-ink-soft">demo@reconcile.app</span> / <span className="tabular text-ink-soft">demo-password-1234</span>
        <br />
        (run <code className="text-ink-soft">pnpm db:seed</code> in <code className="text-ink-soft">apps/api</code> first)
      </div>
    </AuthLayout>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-[4px] border border-line bg-paper-raised p-7 shadow-[0_1px_0_var(--line)]">{children}</div>
    </div>
  );
}
