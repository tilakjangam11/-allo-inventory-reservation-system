# Allo — Inventory Reservations

Concurrency-safe checkout reservations for multi-warehouse retail inventory.

Built with Next.js 16 (App Router), Prisma, Postgres, and Zod.

---

## What this app does

Allo models the **checkout hold** pattern used by e-commerce systems: when a shopper begins checkout, the requested units are temporarily reserved so no one else can claim them during the payment window. The hold expires automatically if the shopper doesn't complete the purchase.

**Core flows:**

1. **Browse** — view all products with per-warehouse stock levels.
2. **Reserve** — hold units for 10 minutes. Stock is decremented from the available pool immediately.
3. **Confirm** — complete the purchase. Units are permanently removed from warehouse stock.
4. **Cancel / Expire** — release the hold. Units return to the available pool for other shoppers.

The UI displays live countdowns, `409 Conflict` when stock runs out, and `410 Gone` when a reservation expires mid-checkout.

---

## Project structure

```
allo-inventory/
├── app/
│   ├── api/
│   │   ├── cron/expire/route.ts    # Vercel Cron — releases expired holds
│   │   ├── products/route.ts       # GET /api/products
│   │   ├── reservations/
│   │   │   ├── route.ts            # POST /api/reservations
│   │   │   └── [id]/
│   │   │       ├── route.ts        # GET /api/reservations/:id
│   │   │       ├── confirm/route.ts
│   │   │       └── release/route.ts
│   │   └── warehouses/route.ts     # GET /api/warehouses
│   ├── reservation/[id]/page.tsx   # Reservation detail + countdown
│   ├── page.tsx                    # Product listing homepage
│   ├── layout.tsx                  # Root layout with theme
│   └── globals.css                 # Design system (vanilla CSS)
├── lib/
│   ├── reservation-service.ts      # Core business logic (concurrency-critical)
│   ├── prisma.ts                   # Singleton Prisma client
│   ├── idempotency.ts              # Idempotency-Key middleware
│   └── validators.ts               # Zod schemas
├── prisma/
│   ├── schema.prisma               # Database schema
│   ├── migrations/                 # Migration history
│   └── seed.ts                     # Test data
├── vercel.json                     # Cron schedule
└── package.json
```

---

## Setup

### Prerequisites

- Node.js 20+
- A hosted Postgres database (Neon, Supabase, or similar)

### Install and run

```bash
git clone <repo-url> && cd allo-inventory
npm install
```

Create `.env.local` from the example:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
CRON_SECRET="replace-with-a-random-secret"
```

Run migrations and seed:

```bash
npx prisma migrate dev
npm run seed
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** Use hosted Postgres, not SQLite. The concurrency guarantees rely on Postgres row-level locking (`SELECT ... FOR UPDATE`), which SQLite doesn't support.

---

## Environment variables

| Variable       | Required | Description                                                         |
| -------------- | -------- | ------------------------------------------------------------------- |
| `DATABASE_URL` | Yes      | Postgres connection string with `?sslmode=require` for hosted DBs   |
| `CRON_SECRET`  | Yes      | Bearer token for the `/api/cron/expire` endpoint (Vercel Cron auth) |

Both variables must be set in Vercel's dashboard for production deployments.

---

## Migration and seed

```bash
# Development — creates migration files and applies them
npx prisma migrate dev

# Production — applies existing migrations without creating new ones
npx prisma migrate deploy

# Seed — populates test data (2 warehouses, 3 products, 5 inventory rows)
npm run seed
```

The seed creates intentionally varied stock levels:

| Product                  | Warehouse               | Units | Purpose                         |
| ------------------------ | ----------------------- | ----- | ------------------------------- |
| Wireless Headphones Pro  | London Fulfilment Centre | 5     | Normal flow                     |
| Wireless Headphones Pro  | Manchester Hub           | 3     | Multi-warehouse demonstration   |
| Mechanical Keyboard TKL  | London Fulfilment Centre | 1     | **Concurrency test target**     |
| USB-C Hub 7-Port         | London Fulfilment Centre | 10    | High stock, no contention       |
| USB-C Hub 7-Port         | Manchester Hub           | 4     | Moderate stock                  |

---

## Data model

```
Product ──< Inventory >── Warehouse
                │
                └──< Reservation
```

| Model              | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| **Product**         | What customers buy (name, SKU, description)                             |
| **Warehouse**       | Physical location that holds stock                                      |
| **Inventory**       | Junction: one row per product-warehouse pair. Tracks `totalUnits` and `reservedUnits` |
| **Reservation**     | A time-limited hold. Lifecycle: `PENDING` → `CONFIRMED` or `RELEASED`   |
| **IdempotencyRecord** | Stores completed API responses for retry-safe operations              |

**Key invariant:** `availableUnits = totalUnits - reservedUnits`. This is always computed, never stored, to prevent drift.

---

## API routes

| Method | Path                                | Description                                 | Status codes         |
| ------ | ----------------------------------- | ------------------------------------------- | -------------------- |
| GET    | `/api/products`                     | List products with per-warehouse stock      | 200                  |
| GET    | `/api/warehouses`                   | List warehouses                             | 200                  |
| POST   | `/api/reservations`                 | Create a pending reservation                | 201, 400, 404, 409   |
| GET    | `/api/reservations/:id`             | Get reservation (lazy expiry cleanup)       | 200, 404             |
| POST   | `/api/reservations/:id/confirm`     | Confirm → units permanently sold            | 200, 400, 404, 410   |
| POST   | `/api/reservations/:id/release`     | Release → units returned to pool            | 200, 400, 404        |
| GET    | `/api/cron/expire`                  | Cron: release all expired holds             | 200, 401             |

**Error semantics:**

- `400` — reservation is not in `PENDING` state (already confirmed or released)
- `404` — reservation or inventory not found
- `409` — insufficient stock (concurrency conflict)
- `410` — reservation expired before confirmation (hold auto-released)

---

## Concurrency strategy

The critical path is in `lib/reservation-service.ts`. Every mutation runs inside a Postgres transaction with row-level locking.

### Reserve flow

```sql
-- 1. Lock the inventory row
SELECT id, "totalUnits", "reservedUnits"
FROM "Inventory"
WHERE id = $1
FOR UPDATE

-- 2. Check: totalUnits - reservedUnits >= requested quantity
-- 3. If sufficient: INCREMENT reservedUnits
-- 4. Create PENDING reservation with expiresAt = now + 10 min
```

If two requests try to reserve the last unit simultaneously, one transaction commits first. The second re-checks the locked row after the lock releases, sees `available = 0`, and receives `409`.

### Confirm flow

```sql
-- 1. Lock the reservation row
SELECT id, "inventoryId", quantity, status, "expiresAt"
FROM "Reservation"
WHERE id = $1
FOR UPDATE

-- 2. Verify status = PENDING and not expired
-- 3. DECREMENT both reservedUnits AND totalUnits (units are sold)
-- 4. Set status = CONFIRMED, confirmedAt = now
```

### Release flow

Same lock pattern. Decrements `reservedUnits` only (units return to pool). `totalUnits` is unchanged.

### Stock accounting summary

| Action      | `totalUnits`   | `reservedUnits` | `available` (computed) |
| ----------- | -------------- | --------------- | ---------------------- |
| **Reserve** | unchanged      | +quantity        | decreases              |
| **Confirm** | −quantity       | −quantity        | unchanged              |
| **Release** | unchanged      | −quantity        | increases              |

---

## Expiry strategy

Each reservation gets `expiresAt = now + 10 minutes`. Expiry is enforced at two layers:

### 1. Vercel Cron (active cleanup)

`vercel.json` schedules `GET /api/cron/expire` every minute. The endpoint:
1. Queries all `PENDING` reservations where `expiresAt < now`
2. Releases each one individually (decrementing `reservedUnits`)
3. Returns the count of released reservations

Protected by `Authorization: Bearer $CRON_SECRET`.

### 2. Lazy cleanup (defensive fallback)

- `GET /api/products` calls `releaseExpiredReservations()` before returning data.
- `GET /api/reservations/:id` checks expiry on read and releases inline.

### 3. Confirm-time check

If a shopper tries to confirm an expired reservation:
1. The transaction checks `expiresAt < now`
2. Releases the hold inside the same transaction
3. Returns `410 Gone` to the client

The UI countdown is purely cosmetic. The server is the authority on expiry.

---

## Idempotency

`POST /api/reservations` and `POST /api/reservations/:id/confirm` support the `Idempotency-Key` header.

**How it works:**

1. Before running side effects, the handler creates an `IdempotencyRecord` keyed by `(key, scope)`.
2. The record stores a hash of the request payload and the final HTTP response.
3. A retry with the same key and payload returns the stored response without re-executing side effects.
4. A retry with the same key but different payload returns `409` (payload mismatch).
5. Concurrent retries wait briefly for the first request to finish, then return the stored response.

This makes `POST` requests safe to retry after network timeouts without risking double-reservations or double-confirmations.

---

## Testing

### Concurrency test

Sends 20 simultaneous reservation requests for a 1-unit inventory row. Exactly 1 should succeed (201) and the rest should get 409.

```bash
npm run seed
npm run dev     # in another terminal
npm run test:concurrency
```

Expected output:

```
1 success (201)
19 conflicts (409)
```

---

## Deployment

### Vercel

1. Create a hosted Postgres database (Neon recommended).
2. Set `DATABASE_URL` and `CRON_SECRET` in Vercel's environment variables.
3. Run migrations against production:

```bash
npx prisma migrate deploy
npm run seed    # optional — only for demo/staging
```

4. Deploy the Next.js app to Vercel.
5. Verify `vercel.json` has the cron entry. Vercel will automatically call `/api/cron/expire` every minute.

### `.env.example`

A template is included at `.env.example` with placeholder values. Real secrets are never committed.

---

## Trade-offs and future improvements

### Current trade-offs

- **Postgres locks over Redis:** The lock and write live in the same system, avoiding split-brain failures. Redis would add throughput but also complexity and a failure mode where Redis says "available" but Postgres disagrees.

- **Per-minute cron + lazy cleanup:** Expiry is accurate to ~1 minute, not to the second. For higher precision, a queue-based system (e.g., Postgres `LISTEN/NOTIFY`, SQS delay queues, or BullMQ) would fire at exact expiry times.

- **Idempotency records don't expire:** In production, a scheduled cleanup job should purge records older than 24–48 hours.

- **No order model:** Confirmed reservations deduct stock permanently. A production system would create an Order record on confirm and link reservations to orders for audit/fulfilment.

- **Single-region database:** For a global product, read replicas and connection pooling (e.g., PgBouncer) would reduce latency. The `FOR UPDATE` locks require the primary.

### Future improvements

- Add WebSocket or SSE for real-time stock updates across browser tabs
- Add rate limiting per IP/session on the reserve endpoint
- Add a `/api/admin/stock` endpoint for manual stock adjustments
- Add configurable TTL per product category
- Add retry queue for failed cron cleanup batches
- Add OpenTelemetry tracing for transaction latency monitoring
