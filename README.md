# Allo Inventory Reservations

Concurrency-safe checkout reservations for multi-warehouse retail inventory.

Live demo: add the Vercel URL after deployment.

## What this app does

The app models products, warehouses, inventory rows, reservations, and idempotency records. A shopper can reserve a unit at checkout, see a live expiry countdown, confirm payment, or cancel the hold. The API returns visible `409` errors when stock is gone and `410` errors when a hold expires before confirmation.

## Stack

- Next.js App Router with TypeScript
- Prisma with hosted Postgres
- Tailwind CSS
- Zod for API validation
- Vercel Cron for expiry cleanup

## Running locally

```bash
npm install
cp .env.example .env.local
```

Create `.env.local`:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
CRON_SECRET="replace-with-a-random-secret"
```

Then run:

```bash
npx prisma migrate dev
npm run seed
npm run dev
```

Open `http://localhost:3000`.

The database should be hosted Postgres, such as Supabase or Neon. SQLite/local-only storage would not exercise the same locking behavior this take-home is about.

## API

- `GET /api/products` lists products with available stock by warehouse.
- `GET /api/warehouses` lists warehouses.
- `POST /api/reservations` creates a pending reservation. Returns `409` when available stock is insufficient.
- `GET /api/reservations/:id` returns reservation details and lazily releases the hold if it has expired.
- `POST /api/reservations/:id/confirm` confirms a pending reservation. Returns `410` if it expired.
- `POST /api/reservations/:id/release` releases a pending reservation early.
- `GET /api/cron/expire` releases expired pending reservations. Requires `Authorization: Bearer $CRON_SECRET`.

## Concurrency approach

The critical path is in `lib/reservation-service.ts`. Creating a reservation opens a Prisma transaction and locks the inventory row:

```sql
SELECT id, "totalUnits", "reservedUnits"
FROM "Inventory"
WHERE id = $1
FOR UPDATE
```

Available stock is calculated only after that lock is held. If two requests try to reserve the last unit at the same time, one transaction commits first, and the other re-checks the locked row after it wakes up. The second request sees no available stock and gets `409`.

Confirm and release also lock the reservation row with `FOR UPDATE`. That prevents a confirm/release race where payment confirmation and cancellation could both act on the same pending hold.

## Expiry

Each reservation gets `expiresAt = now + 10 minutes`.

Production expiry has two layers:

- Vercel Cron calls `/api/cron/expire` every minute, releasing expired pending reservations.
- Lazy cleanup runs on product reads and reservation reads, so stale holds are cleaned up even if the cron job is between ticks.

The countdown in the UI is not trusted for correctness. The server decides whether a reservation is still valid.

## Idempotency

`POST /api/reservations` and `POST /api/reservations/:id/confirm` support the `Idempotency-Key` header.

Implementation details:

- A request creates an `IdempotencyRecord` before running side effects.
- The record is scoped by endpoint and stores a hash of the request payload.
- A retry with the same key and same payload returns the original stored response.
- A retry with the same key but a different payload returns `409`.
- A simultaneous retry waits briefly for the first request to finish, then returns the stored response instead of repeating the side effect.

## Testing concurrency

Seed data includes one unit of `MKT-002`, which is intentionally tight stock.

```bash
npm run seed
npm run dev
npm run test:concurrency
```

Expected result:

```text
1 success (201)
19 conflicts (409)
```

## Deployment notes

1. Create a hosted Postgres database.
2. Set `DATABASE_URL` and `CRON_SECRET` in Vercel.
3. Run migrations against production:

```bash
npx prisma migrate deploy
npm run seed
```

4. Deploy the Next.js app to Vercel.
5. Confirm `vercel.json` has the cron entry for `/api/cron/expire`.

## Trade-offs

- I used Postgres row locks instead of Redis locks because Postgres owns the stock data. Keeping the lock and write in one system is simpler and avoids split-brain failure modes.
- Expiry cleanup is per-minute plus lazy reads, not exact-to-the-second. For a larger production system I would move expiry events into a queue or scheduled job system.
- Confirmed units remain counted in `reservedUnits`. In this model that field means "not available to shoppers", covering both pending holds and sold units. A fuller system would likely add order tables and separate sold stock from active holds.
- Idempotency records do not currently expire. In production I would add a retention window and scheduled cleanup.
