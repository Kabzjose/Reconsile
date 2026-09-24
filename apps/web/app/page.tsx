"use client";

import Link from "next/link";
import { ArrowRight, Check, Command, Search, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/Button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";

export default function Root() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) window.location.replace("/dashboard");
  }, [loading, session]);

  return (
    <main className="min-h-full bg-paper text-ink">
      <nav className="fixed inset-x-0 top-0 z-20 border-b border-line bg-paper/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-5 px-5 sm:px-8">
          <Link href="/" className="font-display text-xl font-bold text-accent hover:text-accent-hover">Reconcile</Link>
          <div className="hidden min-w-0 flex-1 sm:block">
            <div className="mx-auto flex max-w-xs items-center gap-2 rounded-full border border-line bg-paper-raised px-3 py-2 text-xs text-ink-faint">
              <Search size={14} />
              <span className="flex-1">Search documentation</span>
              <span className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px]"><Command size={10} /> K</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm text-ink-soft">
            <a href="#how-it-works" className="hidden md:inline">How it works</a>
            <Link href="/login" className="hidden sm:inline">Log in</Link>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-5 pb-24 pt-36 sm:px-8 sm:pt-44">
        <div className="max-w-4xl">
          <p className="mb-5 flex items-center gap-2 text-sm font-medium text-accent"><Sparkles size={15} /> Payment reconciliation, without the spreadsheet archaeology.</p>
          <h1 className="font-display text-5xl font-bold leading-[0.98] tracking-tight sm:text-7xl lg:text-8xl">
            Your payments.<br /><span className="text-accent">One clear ledger.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-8 text-ink-soft sm:text-xl">Reconcile brings M-Pesa, bank, card, and cash payments together with your sales, then matches the obvious ones automatically so your team can focus on the exceptions.</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/register"><Button variant="primary" className="px-5 py-3">Get started free <ArrowRight size={16} /></Button></Link>
            <a href="#how-it-works"><Button variant="secondary" className="px-5 py-3">See how it works</Button></a>
          </div>
        </div>
        <div className="mt-20 grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
          {["M-Pesa", "Bank", "Cards", "Cash"].map((source) => <div key={source} className="bg-paper-raised px-5 py-5 text-sm text-ink-soft"><span className="mb-3 block h-1 w-8 rounded-full bg-accent" />{source}</div>)}
        </div>
      </section>

      <section id="how-it-works" className="border-y border-line bg-paper-raised px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-accent">How it works</p>
          <div className="mt-4 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><h2 className="max-w-2xl font-display text-3xl font-bold sm:text-5xl">From scattered payments to a confident close.</h2><p className="max-w-sm text-sm leading-6 text-ink-soft">Sales live in one place. Payments land in another. Reconcile connects the two and tells you how sure it is.</p></div>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {[{ n: "01", title: "Sale recorded", body: "Import orders from your shop or system with the details your team already uses." }, { n: "02", title: "Payment arrives", body: "Bring in M-Pesa and bank statements, plus card or cash transactions." }, { n: "03", title: "Matched automatically", body: "A confidence score weighs amount, reference, payer, and timing." }, { n: "04", title: "Exceptions reviewed", body: "People only step in where the evidence is genuinely ambiguous." }].map((step) => (
              <article key={step.n} className="rounded-2xl border border-line bg-paper px-5 py-6"><span className="font-display text-3xl font-bold text-accent">{step.n}</span><h3 className="mt-8 font-display text-xl font-bold">{step.title}</h3><p className="mt-3 text-sm leading-6 text-ink-soft">{step.body}</p><Check className="mt-8 text-accent" size={17} /></article>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl items-center justify-between px-5 py-8 text-xs text-ink-faint sm:px-8"><span>Reconcile</span><Link href="/login" className="text-accent">Open the workspace <ArrowRight className="ml-1 inline" size={13} /></Link></footer>
    </main>
  );
}
