# Reconcile

**A small business takes payments through M-Pesa, bank transfer, cards, and cash. Its sales live
in one place and its payments land in another. Reconcile matches them automatically — with a
transparent confidence score — and lets the owner review only the few payments that are genuinely
ambiguous.**

```
Sales   ──┐                              ┌── Matched
          ├──▶ Reconciliation engine ──▶ ├── Suggested (needs a person)
Payments ─┘                              └── Unmatched
```

## What's here

| Piece | What it does |
|---|---|
| `apps/api` | Express + TypeScript + PostgreSQL backend: auth, orders, payments, webhooks, CSV import, the matching engine, and a dashboard API |
| `apps/web` | Next.js frontend: a ledger-styled UI for the dashboard, orders, payments, the review queue, CSV import, and a "test payments" panel for demos |

## Quickstart

Requirements: Node 20+, pnpm, and PostgreSQL (Docker below, or any hosted Postgres).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # then set JWT_SECRET — see the comment inside
cp apps/web/.env.local.example apps/web/.env.local
docker compose up -d                          # local PostgreSQL (skip if using a hosted one)
pnpm db:setup                                 # creates tables + applies the CHECK constraints
pnpm db:seed                                  # optional: one demo business with sample data
pnpm dev                                      # API on :4000, web app on :3000
```

Log in with the seeded account: **demo@reconcile.app / demo-password-1234**. From there:

1. **Sales → New order** — or just use the seeded ones. Two are deliberately left open at the
   same amount (KSh 2,500), because that ambiguity is the whole reason the matching engine can't
   just compare `payment.amount === order.amount`.
2. **Test payments** — sends real signed webhook events through the exact pipeline a payment
   provider would use. Try *Clean payment* (auto-matches), *Ambiguous Till payment* (the
   three-orders case — goes to review, never guessed), and *Duplicate delivery* (proves the same
   transaction can't be double-counted).
3. **Payments** — the review queue. Click into a payment with a suggestion to see the confidence
   score and *why* the engine proposed that order.
4. **Import statement** — download a generated sample M-Pesa statement (or paste your own), and
   watch it reconcile a whole batch at once. Re-importing the same file imports zero new payments.

## The matching engine, in one paragraph

Every open order is scored against a payment on five signals — an exact account reference (50
pts), a close-but-not-exact reference (25), the amount fitting what's owed (30 or 8 for a
plausible part-payment), the payer's phone matching the customer on file (30), and how soon after
the sale the payment arrived (up to 10). Above 90 points with a clear lead over the runner-up (or
an unambiguous exact reference), the payment is matched automatically. Between 70 and 89 it's
suggested for a one-click confirmation. Below that, it waits for a person. **Without any account
reference at all, the maximum possible score is 70** — amount, phone, and timing alone can never
cross the auto-match line, which is what stops three identical KSh 2,500 orders from ever being
guessed at. The engine itself is a pure function (`apps/api/src/modules/reconciliation/reconciliation.scoring.ts`)
with no database or HTTP in it, which is what makes it possible to unit-test every one of these
cases directly.

## Testing

```bash
pnpm test                 # ~155 tests, fully mocked — no database needed, safe for CI
pnpm test:integration     # ~22 tests against a REAL PostgreSQL — see apps/api/tests/integration/README.md
```

The integration suite is the one worth reading if you want to see the hard parts proven, not just
asserted: it fires concurrent requests at the same payment and the same three-identical-orders
situation from the brief, against real row locks, and checks the money never gets double-spent.

## Architecture notes

- **Money is always integer cents.** Never a float, anywhere, on either side of the stack.
- **Idempotency is structural, not a lookup.** A webhook retry hits a unique constraint
  (`businessId, provider, externalReference`), not a "does this exist?" check first — so it
  survives two identical requests arriving at the exact same instant, not just sequential ones.
- **Money moves through four guarded SQL statements**, and nothing else touches the `allocated_cents`
  columns. Each one is a single `UPDATE ... WHERE` that can never move more money than exists,
  so a race is resolved by PostgreSQL's own row locking, not by application logic.
- **Allocations are append-only.** A wrong match is voided and a new one created; nothing is ever
  edited or deleted, so there's always an audit trail of every reconciliation decision.
- **The Prisma client uses the driver-adapter engine** (`@prisma/adapter-pg`), not the native Rust
  binary — one less thing that can fail to download in a constrained environment.

## Deploying

Both apps live in one repo, deployed separately, sharing one Postgres database:

- **`apps/web` → Vercel.** Set the project root to `apps/web` and add `NEXT_PUBLIC_API_URL`
  pointing at the deployed API.
- **`apps/api` → Render / Railway / Fly.io.** Build command: `pnpm --filter @reconcile/api build`.
  Start command: `pnpm --filter @reconcile/api start`. Set `DATABASE_URL`, `JWT_SECRET`, and
  `CORS_ORIGIN` (the deployed frontend's URL) as environment variables, and run
  `pnpm --filter @reconcile/api db:deploy` once against the production database.
- Set `ENABLE_SIMULATOR=false` in production — it's a demo convenience that can inject payments on
  the business's behalf, and has no place outside a hackathon.

## Full documentation

- `apps/api/README.md` — every endpoint, environment variable, and script
- `apps/api/tests/integration/README.md` — how to run the real-database test suite
