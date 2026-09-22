# apps/api

Express + TypeScript + Prisma + PostgreSQL backend for Reconcile.

## Setup

```bash
pnpm install                      # from the repo root; also runs `prisma generate`
cp .env.example .env              # then set JWT_SECRET — see the comment inside
docker compose up -d              # from the repo root: local PostgreSQL
pnpm db:setup                     # creates tables + applies prisma/constraints.sql
pnpm db:seed                      # optional: one demo business with sample data
pnpm dev                          # http://localhost:4000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run with auto-reload and pretty logs |
| `pnpm build` / `pnpm start` | Compile to `dist/` / run the compiled server |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm test` | ~155 tests, fully mocked — no database needed |
| `pnpm test:integration` | ~22 tests against a real PostgreSQL — see `tests/integration/README.md` |
| `pnpm db:setup` | First-time database setup |
| `pnpm db:migrate` | Create/apply a migration after editing `schema.prisma` |
| `pnpm db:deploy` | Apply existing migrations (production) |
| `pnpm db:seed` | Load one demo business (idempotent — safe to re-run) |
| `pnpm db:studio` | Browse the database in a web UI |

## Environment variables

See `.env.example` for the full list with defaults. The one worth calling out:
**`ENABLE_SIMULATOR`** (default `true`) turns on `/api/simulator/*`, which can inject payments on a
business's behalf for demos. Set it to `false` in any real deployment.

## Endpoints

All routes except `/health`, `/api/auth/*`, and `/api/webhooks/*` require `Authorization: Bearer <token>`.
Every query is scoped to the business encoded in that token.

**Auth** — `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`

**Business** — `GET /api/business`, `POST /api/business/webhook-secret/rotate`

**Orders** — `POST /api/orders`, `GET /api/orders` (filters: `status`, `search`, `from`, `to`, `page`, `pageSize`),
`GET /api/orders/:id`, `POST /api/orders/:id/cancel`, `POST /api/orders/:id/dispute`,
`POST /api/orders/:id/resolve-dispute`

**Payments** — `POST /api/payments` (manual/cash entry), `GET /api/payments` (same filters as orders,
plus `provider`), `GET /api/payments/:id`, `POST /api/payments/:id/reconcile` (re-run the engine),
`POST /api/payments/:id/allocations` (manual match), `POST /api/payments/:id/dispute`,
`POST /api/payments/:id/resolve-dispute`

**Allocations** — `POST /api/allocations/:id/confirm` (accept a suggestion), `POST /api/allocations/:id/void`
(reverse a match, with an optional reason). There is no edit or delete: allocations are append-only.

**Webhooks (public, HMAC-signed)** — `POST /api/webhooks/payments/:businessId`. See "Connecting a real
provider" below.

**Import** — `POST /api/imports/payments` (`{ csv, provider }`), `GET /api/imports/sample` (a
generated statement built from the business's own open orders — always importable, always partly
ambiguous, good for a demo)

**Dashboard** — `GET /api/dashboard/summary?range=today|7d|30d|all`

**Events** — `GET /api/events` — the full audit trail (every webhook, import row, and manual entry,
including the ones that were rejected, invalid, or duplicates)

**Simulator** (disabled when `ENABLE_SIMULATOR=false`) — `POST /api/simulator/payments` (a custom
test payment), `POST /api/simulator/scenarios/:name` where `name` is one of `CLEAN`, `UNDERPAY`,
`OVERPAY`, `TILL_AMBIGUOUS`, `ORPHAN`, `DUPLICATE`

Errors always look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [], "requestId": "..." } }
```

## Connecting a real payment provider

Every webhook must be signed. Compute `HMAC-SHA256` of the **raw** request body using the
business's webhook secret (find it under Settings in the app, or `GET /api/business`), and send it
as `X-Reconcile-Signature: sha256=<hex>`. The expected JSON body:

```json
{ "event": "payment.completed", "provider": "MPESA", "transactionId": "QWE123",
  "amount": 2500, "phone": "254712345678", "reference": "ORD-1042" }
```

`amount` is in KES (not cents — the API converts and validates at the edge). Daraja's own
callbacks aren't signed this way; in production you'd put a small gateway in front that verifies
Daraja's source and re-signs the event for this endpoint.

## Testing

`pnpm test` mocks Prisma entirely — safe for CI, no database needed. `pnpm test:integration` runs
against a real PostgreSQL and is where the properties that actually matter are proven: concurrent
allocation races never double-spend money, webhook retries delivered simultaneously never create
two payments, and the append-only trigger really blocks editing an allocation. See
`tests/integration/README.md` to run it.

## Troubleshooting

- **`ERR_PNPM_IGNORED_BUILDS`**: run `pnpm approve-builds`. Approved packages are listed in the
  root `pnpm-workspace.yaml`.
- **`Invalid environment configuration`** on start: a variable in `.env` is missing or invalid; the
  message names it.
- **`P1000: Authentication failed`** or **`P1001: Can't reach database server`**: usually a port
  clash with a system-installed Postgres. Change the port in `docker-compose.yml` and `DATABASE_URL`
  together (e.g. `5433:5432`), or confirm Docker is running with `docker compose ps`.
