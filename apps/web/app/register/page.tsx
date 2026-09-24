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
import { AuthLayout } from "../login/page";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      await register(businessName, email, password);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (Array.isArray(err.details)) {
          setFieldErrors(Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message])));
        }
      } else {
        setError("Could not reach the server. Is the API running?");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <p className="font-display text-[22px] font-bold text-ink">Set up your business</p>
      <p className="mt-1 text-[13.5px] text-ink-soft">One account per business — you can invite your team later.</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Field label="Business name" error={fieldErrors.businessName}>
          <input className={inputClass} required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Mama Njeri Shop" autoFocus />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 8 characters" error={fieldErrors.password}>
          <input className={inputClass} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={loading} className="mt-1 w-full py-2">
          {loading ? <Spinner className="h-4 w-4" /> : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-[13px] text-ink-soft">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent underline underline-offset-2">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
