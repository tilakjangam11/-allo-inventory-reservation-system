# DECISION LOG — Allo Inventory

Every file in this project has a corresponding entry below explaining what it does, why it exists, the key decisions made, and the exact lines that matter most. This log grows with every phase.

---

## [Phase 1] prisma/schema.prisma

### What this file does
Defines the database structure for the entire application. Four tables — Product, Warehouse, Inventory, Reservation — and one enum — ReservationStatus. Prisma reads this file to generate the TypeScript client and run migrations against PostgreSQL.

### Why it exists
Without this file, there is no database. Every API endpoint, every query, and every transaction depends on these table definitions. If the schema is wrong — for example, if `availableUnits` were stored as a column instead of computed — the concurrency guarantee breaks because two sources of truth can drift apart.

### Key decisions made
- Decision: Store `reservedUnits` and compute `availableUnits` as `totalUnits - reservedUnits`
  Alternatives considered: Store `availableUnits` as a column and decrement it directly
  Reason: A single stored counter (`reservedUnits`) is the sole source of truth. If we stored `availableUnits` separately, we'd need to keep two columns in sync atomically, which doubles the surface area for bugs and makes the invariant (`reservedUnits <= totalUnits`) harder to verify from the DB alone.

- Decision: `@@unique([productId, warehouseId])` on Inventory
  Alternatives considered: No unique constraint, enforce in application code
  Reason: Database-level constraint is impossible to violate regardless of application bugs. Without it, a race condition during data import could create two inventory rows for the same product-warehouse pair, making stock counts ambiguous.

- Decision: Use `cuid()` for all IDs
  Alternatives considered: `uuid()`, auto-increment integers
  Reason: CUIDs are URL-safe, sortable by creation time, and collision-resistant in distributed systems. UUIDs are longer and not sortable. Auto-increment integers leak business data (total count) and conflict in multi-region setups.

- Decision: `ReservationStatus` as a Prisma enum (PENDING, CONFIRMED, RELEASED)
  Alternatives considered: String field with application-level validation
  Reason: Database-level enum prevents invalid states (e.g. typos like "COMFIRMED") at the storage layer. The three states map directly to the reservation lifecycle: PENDING is the only mutable state; CONFIRMED and RELEASED are terminal.

### The line(s) that matter most
```prisma
// INVARIANT: reservedUnits <= totalUnits   ALWAYS.
// availableUnits is COMPUTED as (totalUnits - reservedUnits).
// It is never stored as a column.
model Inventory {
  totalUnits     Int
  reservedUnits  Int           @default(0)
  @@unique([productId, warehouseId])
}
```

### What could go wrong
1. If someone adds an `availableUnits` column, the system now has two sources of truth that can desync.
2. If the `@@unique` constraint is removed, duplicate inventory rows can appear, causing double-counted stock.
3. If `reservedUnits` doesn't default to 0, newly created inventory rows start with `null`, which breaks arithmetic.
4. If `expiresAt` on Reservation is made optional, expired-reservation cleanup can't query reliably.

### Interview question this file answers
"Why did you choose to compute available stock instead of storing it?"
Answer: Storing `availableUnits` as a column would create a second source of truth alongside `reservedUnits`. During concurrent transactions, keeping two counters in sync atomically is strictly harder than maintaining one counter and computing the other. With a single `reservedUnits` column, the invariant `reservedUnits <= totalUnits` is trivially verifiable from the database alone, and the `FOR UPDATE` lock only needs to protect one value.

---

## [Phase 1] prisma/seed.ts

### What this file does
Populates the database with test data: 2 warehouses, 3 products, and 5 inventory rows. It creates a realistic but minimal dataset that enables every test scenario in the project — including the critical concurrency test on the 1-unit Mechanical Keyboard.

### Why it exists
Without seed data, the API returns empty arrays, the frontend shows nothing, and the concurrency test has nothing to test. The data isn't random — each stock level is chosen to enable a specific scenario. Removing or changing it breaks the test plan.

### Key decisions made
- Decision: MKT-002 (Mechanical Keyboard) seeded with exactly 1 unit in one warehouse
  Alternatives considered: More units with a test that reserves all of them
  Reason: 1 unit is the simplest and most dramatic test case. 20 simultaneous requests → exactly 1 success, 19 conflicts. Any higher number makes the test less deterministic and harder to reason about.

- Decision: Use `createMany` for inventory rows
  Alternatives considered: Individual `create` calls
  Reason: `createMany` is a single SQL INSERT, which is faster and avoids partial-creation states if the seed script is interrupted mid-run.

- Decision: Non-zero exit code on failure (`process.exit(1)`)
  Alternatives considered: Silent catch
  Reason: CI/CD pipelines and deployment scripts need to detect seed failures. A silent catch would make a broken seed invisible, leading to an empty database in production.

### The line(s) that matter most
```typescript
// MKT-002 — THE concurrency test target. 1 unit only.
{ productId: p2.id, warehouseId: wh1.id, totalUnits: 1, reservedUnits: 0 },
```

### What could go wrong
1. Running seed twice without clearing the DB will fail on unique constraints (SKU, productId+warehouseId) — use `npx prisma db seed` which handles this, or reset with `npx prisma migrate reset`.
2. If someone bumps `totalUnits` for MKT-002 above 1, the concurrency test will pass vacuously (multiple requests succeed, but that's correct for >1 unit) and won't prove the lock works.
3. If `reservedUnits` is seeded to a non-zero value, the available stock calculation will be wrong from the start.

### Interview question this file answers
"How did you set up test data for the concurrency test?"
Answer: The seed file creates a Mechanical Keyboard SKU with exactly 1 unit of total stock. This makes the race condition maximally visible — 20 simultaneous reservation requests should produce exactly 1 success (201) and 19 conflicts (409). Any other result means the row lock is broken.

---

## [Phase 1] lib/prisma.ts

### What this file does
Creates a single PrismaClient instance and reuses it across all server-side code. In development, it caches the client on `globalThis` so that Next.js hot-module reloading doesn't spawn a new database connection pool on every file save.

### Why it exists
Without this singleton, every hot-reload in development creates a new `PrismaClient()`, each opening its own connection pool (default 5 connections). After ~10 saves, the database runs out of connections and all queries fail with "too many clients already." In production, module-level scope handles this naturally, but the `globalThis` pattern is a safety net.

### Key decisions made
- Decision: Cache on `globalThis` in development only
  Alternatives considered: Always cache on `globalThis`, use a connection pooler (PgBouncer)
  Reason: In production, module-level variables persist across requests because the server process stays alive. Caching on `globalThis` in production is unnecessary and adds complexity. PgBouncer solves a different problem (multi-process scaling) and is overkill for a single Next.js server.

- Decision: Log only errors (`log: ['error']`)
  Alternatives considered: Log all queries (`log: ['query', 'info', 'warn', 'error']`)
  Reason: Query logging is extremely noisy during development — every seed, every API call generates log lines. Error-only keeps the console readable while still surfacing real problems.

### The line(s) that matter most
```typescript
// Reuse existing client from previous hot-reload, or create new one
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['error'] })

// Only cache in dev — production module scope is sufficient
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
```

### What could go wrong
1. If this file is imported only by some modules and others create their own `new PrismaClient()`, the singleton is bypassed and connection exhaustion returns.
2. If the `globalThis` cast is removed, TypeScript will error on the property access, and the singleton pattern breaks silently.
3. If someone changes the conditional to always cache (removing the `!== 'production'` check), it works but adds unnecessary global state in production.

### Interview question this file answers
"Why do you use a singleton pattern for the database client?"
Answer: Next.js hot-module reloading in development creates new module instances on every file save. Each `new PrismaClient()` opens a connection pool of ~5 connections. Without the singleton, after 10 saves you've opened 50 connections and the database rejects new ones. Caching on `globalThis` ensures all modules share one client and one pool, regardless of how many times the module is re-evaluated.

---

## [Phase 2] lib/validators.ts

### What this file does
Defines Zod schemas that validate incoming API request bodies. The `CreateReservationSchema` ensures `inventoryId` is a valid cuid and `quantity` is a positive integer capped at 100. The TypeScript type `CreateReservationInput` is inferred directly from the schema so the two can never drift apart.

### Why it exists
Without input validation, a malformed request (e.g. `quantity: -5` or `inventoryId: "DROP TABLE"`) would reach the database layer. Zod catches these at the API boundary with structured error messages. If this file is missing, the route handler either crashes on bad input or passes garbage to the service layer.

### Key decisions made
- Decision: Use Zod for validation, not manual if-checks
  Alternatives considered: Manual validation (`if (!body.inventoryId) return 400`), class-validator
  Reason: Zod infers TypeScript types from schemas (`z.infer<typeof Schema>`), so the validation logic and the type system stay in sync automatically. Manual checks require separate type definitions that can drift. class-validator requires decorators and classes, which is heavier than needed.

- Decision: Cap quantity at 100
  Alternatives considered: No cap, configurable per-product cap
  Reason: A hard cap prevents abuse (reserving 999999 units to lock out all stock). 100 is a sensible default. Per-product caps would require a `maxReservationQty` column on Product, which adds schema complexity for a feature not in scope.

- Decision: Validate `inventoryId` as cuid format
  Alternatives considered: Just `z.string()`, or `z.string().min(1)`
  Reason: cuid validation rejects malformed IDs before they hit the database. A plain string check would allow SQL injection payloads or random strings that result in "not found" errors at the DB level — wasteful and noisy.

### The line(s) that matter most
```typescript
export const CreateReservationSchema = z.object({
  inventoryId: z.string().cuid(),                // reject malformed IDs at the API boundary
  quantity: z.number().int().positive().max(100), // positive integer, abuse-capped at 100
})

// Type is derived from schema — single source of truth
export type CreateReservationInput = z.infer<typeof CreateReservationSchema>
```

### What could go wrong
1. If the schema is not used in the route handler (validation skipped), bad input reaches the service layer and causes cryptic Prisma errors instead of clean 400 responses.
2. If `cuid()` validation is removed, any string passes — including empty strings, which cause "not found" errors deep in the transaction.
3. If `max(100)` is removed, a single malicious request can reserve all stock in one call.

### Interview question this file answers
"How do you validate API inputs and keep types in sync?"
Answer: I use Zod schemas that define both the validation rules and the TypeScript types. The `CreateReservationInput` type is inferred from the schema using `z.infer`, so if I add a field to the schema, the type updates automatically. This eliminates the class of bugs where the validation accepts a shape that the downstream code doesn't expect.

---

## [Phase 2] lib/reservation-service.ts

### What this file does
Contains all four business operations for the reservation lifecycle: create, confirm, release, and expire-cleanup. Every operation that touches stock counts or reservation state goes through this file. Route handlers are thin wrappers that call these functions and map errors to HTTP status codes.

### Why it exists
This is where the entire assignment is won or lost. If the concurrency logic is wrong — if two users can both reserve the last unit — the system is fundamentally broken. Centralising all stock-mutation logic in one file makes it auditable, testable, and impossible to accidentally bypass from a route handler.

### Key decisions made
- Decision: Pessimistic locking (SELECT ... FOR UPDATE) instead of optimistic locking (version column + retry)
  Alternatives considered: Optimistic locking with a `version` column, retry on conflict
  Reason: Optimistic locking works best when conflicts are *rare* — most transactions succeed on the first try, and the occasional retry is cheap. In this system, conflicts on the last unit are the *expected* scenario (that's literally what the test checks). Pessimistic locking is a better fit: the second transaction blocks until the first commits, then fails cleanly. No retry loops, no wasted work.

- Decision: ReadCommitted isolation level (not Serializable)
  Alternatives considered: Serializable, RepeatableRead
  Reason: We handle concurrency ourselves via the explicit FOR UPDATE lock. Serializable adds database-level conflict detection on top of our lock, which is redundant and adds overhead (Postgres must track read/write dependencies). ReadCommitted is the lightest isolation level that still gives us consistent reads within our transaction.

- Decision: reservedUnits is NOT decremented on confirm
  Alternatives considered: Decrement on confirm (treat "confirmed" as "shipped, stock consumed")
  Reason: CONFIRMED means the units are permanently claimed — they're sold. RELEASED means the hold was cancelled and units return to the pool. This makes the invariant simple: `reservedUnits` represents units that are unavailable, whether temporarily (PENDING) or permanently (CONFIRMED). Only RELEASED decrements. This is auditable from the database alone — you can verify `reservedUnits = SUM(quantity) WHERE status IN ('PENDING', 'CONFIRMED')`.

- Decision: `.catch(() => {})` on each release in the cron cleanup
  Alternatives considered: Let errors propagate, batch transaction
  Reason: Between `findMany` (which finds expired reservations) and `releaseReservation` (which releases them), a user might confirm or cancel the reservation. `releaseReservation` throws `NOT_PENDING` in that case. That's correct behaviour — the reservation is already in its final state. Without the catch, a double-cron-fire or a user action between find and release would cause Vercel to log uncaught errors, which is noise.

### Concurrency walkthrough (step by step)

**Scenario: Two users try to reserve the last unit of MKT-002 simultaneously.**

Step 1: Thread A enters `createReservation()`. Prisma opens a database transaction.

Step 2: Thread A executes `SELECT ... FOR UPDATE` on the Inventory row for MKT-002. PostgreSQL acquires an exclusive row-level lock. Thread A reads `totalUnits=1, reservedUnits=0`, computes `available=1`.

Step 3: Thread B enters `createReservation()` at the same time. It opens its own transaction and tries to execute `SELECT ... FOR UPDATE` on the *same* row. PostgreSQL sees the lock held by Thread A and **blocks Thread B**. Thread B is now waiting.

Step 4: Thread A passes the stock check (`available >= quantity`), increments `reservedUnits` from 0 to 1, and creates a PENDING reservation. Thread A's transaction commits. The row lock is released.

Step 5: Thread B wakes up. It now acquires the lock and re-reads the row. It sees `totalUnits=1, reservedUnits=1`, computes `available=0`. The stock check fails. Thread B throws `INSUFFICIENT_STOCK`, its transaction rolls back, and the lock is released.

**Result: Thread A gets 201, Thread B gets 409. Exactly one reservation exists. `reservedUnits=1 <= totalUnits=1`. Invariant maintained.**

### What happens without the FOR UPDATE lock

Without the lock, both threads read the row simultaneously:

```
Timeline:
T=0ms  Thread A: SELECT totalUnits=1, reservedUnits=0  → available=1 ✓
T=0ms  Thread B: SELECT totalUnits=1, reservedUnits=0  → available=1 ✓
T=1ms  Thread A: UPDATE reservedUnits = 0+1 = 1, INSERT reservation  → success
T=1ms  Thread B: UPDATE reservedUnits = 1+1 = 2, INSERT reservation  → success ← OVERSOLD!
```

Both threads saw `available=1` because neither held a lock. Both proceeded to reserve. Result: `reservedUnits=2` but `totalUnits=1`. Two reservations exist for one unit. The invariant is violated, and a customer will receive an item that doesn't exist.

### Why stock is checked INSIDE the transaction

This is the TOCTOU (Time-of-Check to Time-of-Use) problem. If stock is checked *before* the transaction:

```typescript
// ❌ BROKEN — TOCTOU race condition
const inv = await prisma.inventory.findUnique({ where: { id } })
const available = inv.totalUnits - inv.reservedUnits  // CHECK
if (available >= quantity) {
  await prisma.$transaction(async (tx) => {
    tx.inventory.update(...)  // USE — but the row may have changed!
  })
}
```

Between the CHECK (line 2) and the USE (line 4), another request can modify the inventory. The check is stale by the time the update runs. Moving the check inside the transaction, after the FOR UPDATE lock, guarantees that the stock value cannot change between reading it and updating it.

### The line(s) that matter most
```typescript
// The concurrency guarantee — these 3 lines are the entire assignment
const rows = await tx.$queryRaw<InventoryRow[]>`
  SELECT id, "totalUnits", "reservedUnits"
  FROM "Inventory"
  WHERE id = ${inventoryId}
  FOR UPDATE                          -- exclusive row lock
`
const available = inv.totalUnits - inv.reservedUnits  // computed INSIDE the lock
if (available < quantity) throw new Error('INSUFFICIENT_STOCK')
```

### What could go wrong
1. If FOR UPDATE is removed from the SQL query, the entire concurrency guarantee disappears. Two threads can oversell.
2. If the stock check is moved outside the transaction, TOCTOU race condition — stale reads lead to overselling.
3. If `.catch(() => {})` is removed from `releaseExpiredReservations`, a double-cron-fire or concurrent user action causes uncaught errors in Vercel logs.
4. If `confirmReservation` doesn't check `expiresAt`, a user can confirm a reservation minutes after it expired, claiming stock that the cron already returned to the pool.
5. If the isolation level is changed to Serializable without removing the FOR UPDATE, you get redundant conflict detection that can cause unexpected serialization failures.

### Interview question this file answers
"Walk me through how `createReservation` prevents two users from reserving the last unit."
Answer: The function opens a Prisma interactive transaction and immediately executes `SELECT ... FOR UPDATE` on the inventory row, which acquires an exclusive row-level lock in PostgreSQL. Any concurrent transaction trying to lock the same row blocks until the first one commits. Inside the lock, we compute available stock and check if there's enough. If so, we atomically increment `reservedUnits` and create the reservation. When the transaction commits, the lock releases, and the blocked thread wakes up to find `available=0` and throws `INSUFFICIENT_STOCK`. This guarantees exactly one success.

---

## [Phase 4] app/layout.tsx

### What this file does
The root layout for the Next.js app. It defines the HTML shell, imports the global Tailwind CSS, and applies the Inter font to all pages.

### Why it exists
Without this file, Next.js can't render the application. It provides the foundational DOM structure and global styling context that all child pages inherit.

### Key decisions made
- Decision: Use `antialiased` class on the body.
  Alternatives considered: Default font rendering.
  Reason: Makes the typography look sharper and more premium on high-resolution displays, fitting the "clean and professional" requirement.

### The line(s) that matter most
```tsx
<body className={`${inter.className} bg-gray-50 text-gray-900 min-h-screen antialiased`}>
  {children}
</body>
```

### What could go wrong
If the global CSS isn't imported here, Tailwind won't work on any page. If the font isn't applied to the body, typography will look inconsistent across browsers.

### Interview question this file answers
"How did you apply global styling to the application?"
Answer: I used the `app/layout.tsx` file to import the global Tailwind CSS and apply the Inter font from `next/font/google` to the `<body>` tag. This ensures consistent styling and typography across all routes in the App Router.

---

## [Phase 4] app/page.tsx

### What this file does
The main product listing page. It fetches products from the API, displays them with their per-warehouse stock, and handles the reservation flow, including the critical 409 conflict scenario.

### Why it exists
This is the main entry point for the user. It allows them to see available stock and attempt to reserve an item. It's also where the result of the concurrency race is presented to the user (success vs "someone just reserved this").

### Key decisions made
- Decision: Handle 409 specifically with an inline error.
  Alternatives considered: Generic error or alert dialog.
  Reason: The 409 conflict is the core scenario of this project. It needs a clear, specific inline message so the user understands they lost the race, without disrupting the overall layout.
- Decision: Disable "Reserve" button immediately on click.
  Alternatives considered: Leave it enabled until response.
  Reason: Prevents double-clicks which would result in two separate reservation requests, potentially creating confusion or unnecessary database load.

### The line(s) that matter most
```tsx
if (res.status === 409) {
  setError('Not enough stock available — someone just reserved this item.')
  return
}
```

### What could go wrong
If the 409 status isn't handled explicitly, the user might see a generic "Something went wrong" message when they lose the race, which makes the app look buggy rather than correctly handling concurrency.

### Interview question this file answers
"How does the frontend handle the race condition?"
Answer: The frontend explicitly checks for a 409 status code when calling the reservation API. If a 409 is returned, it means another user won the race for the last unit. The UI intercepts this and displays a specific inline error message: "Not enough stock available — someone just reserved this item."

---

## [Phase 4] app/reservation/[id]/page.tsx

### What this file does
The reservation detail page. It shows a live countdown timer, allows the user to confirm or cancel their hold, and reflects the current state (PENDING, CONFIRMED, RELEASED).

### Why it exists
This is where the user completes their "purchase." It enforces the 10-minute hold visually and provides the UI to trigger the final state transitions.

### Key decisions made
- Decision: Live countdown is cosmetic; the server is the source of truth.
  Alternatives considered: Frontend tells the server when the timer expires.
  Reason: You can never trust the client. A user could manipulate their local clock to extend the timer indefinitely. The server enforces the expiry; the UI just reflects it.
- Decision: Re-fetch reservation state after actions.
  Alternatives considered: Optimistic UI updates.
  Reason: While optimistic updates are faster, re-fetching ensures the UI exactly matches the database state. This is safer for transactions where the server might reject the action (e.g., confirming an expired reservation).

### The line(s) that matter most
```tsx
if (res.status === 410) {
  setError('Your reservation expired before you could confirm. The item has been released.')
  await fetchReservation() // refresh to show RELEASED status
  return
}
```

### What could go wrong
If the frontend relies entirely on its own timer and doesn't handle the 410 response gracefully, a user might click "Confirm" at 0:01, the server rejects it as expired (because of latency or slight clock drift), and the UI crashes or gets stuck in a pending state.

### Interview question this file answers
"If a user manipulates their computer clock to freeze the countdown, can they keep the reservation forever?"
Answer: No. The frontend countdown is purely cosmetic. The server sets an absolute `expiresAt` timestamp in the database when the reservation is created. The cron job and the lazy check on the confirm endpoint both evaluate expiry based on the server's clock, completely ignoring the client.

---

## [Phase 3] app/api/products/route.ts & app/api/warehouses/route.ts

### What this file does
These GET routes fetch products (with their per-warehouse stock) and warehouses from the database. The `products` route computes the `available` stock (`totalUnits - reservedUnits`) before returning the JSON response.

### Why it exists
The frontend needs to know what products exist and how many units are available to display the product listing page and the stock badges.

### Key decisions made
- Decision: Compute `available` stock in the route handler, not the frontend.
  Alternatives considered: Send `totalUnits` and `reservedUnits` and let the frontend compute it.
  Reason: The frontend shouldn't need to know the internal data model or invariant logic. The API provides a clean, computed contract.
- Decision: Thin wrappers with zero business logic.
  Alternatives considered: Put validation and formatting in service.
  Reason: The route just formats the data for the client; the underlying queries are simple reads.

### The line(s) that matter most
```typescript
// Compute available stock from the invariant fields.
available: inv.totalUnits - inv.reservedUnits,
```

### What could go wrong
If the computation of `available` is removed or done incorrectly, the frontend might show stock that isn't actually available, leading to frustrating 409 errors when the user tries to reserve.

### Interview question this file answers
"Where do you compute available stock for the frontend?"
Answer: Available stock is computed in the `/api/products` route handler as `totalUnits - reservedUnits`. We never store it in the database to avoid multiple sources of truth, and we compute it on the server so the frontend gets a clean, ready-to-use value without needing to understand the underlying data invariant.

---

## [Phase 3] app/api/reservations/route.ts & app/api/reservations/[id]/route.ts

### What this file does
The POST route creates a new reservation, handling Zod validation and returning 409 if stock is insufficient. The GET route fetches a single reservation by ID for the detail page.

### Why it exists
The POST route is the entry point for the concurrency-critical reservation flow. The GET route is required by the frontend reservation page to display the live state (status, quantity, expiry) without full page reloads.

### Key decisions made
- Decision: Map service errors to specific HTTP status codes (e.g. 409 for INSUFFICIENT_STOCK).
  Alternatives considered: Return generic 400s or 500s.
  Reason: The frontend needs to know *why* the reservation failed to show the correct inline error (e.g. "Not enough stock" vs "Invalid input"). 409 Conflict perfectly represents the race condition failure.
- Decision: Thin wrappers.
  Alternatives considered: Put transaction logic in the route.
  Reason: Keeps the API layer strictly separated from the concurrency logic.

### The line(s) that matter most
```typescript
if (message === 'INSUFFICIENT_STOCK') {
  return NextResponse.json({ error: 'Not enough stock available' }, { status: 409 })
}
```

### What could go wrong
If the POST route doesn't validate input with Zod, malformed requests reach the service layer. If it swallows the 409 status, the frontend won't know to show the "out of stock" error to the user who lost the race.

### Interview question this file answers
"How does the client know if it lost the race condition?"
Answer: The route handler catches the `INSUFFICIENT_STOCK` error thrown by the service layer's transaction and maps it to an HTTP 409 Conflict status. The frontend intercepts this 409 and displays a specific "someone just reserved this item" message to the user.

---

## [Phase 3] app/api/reservations/[id]/confirm/route.ts & app/api/reservations/[id]/release/route.ts

### What this file does
These POST routes transition a reservation's state. Confirm transitions it to CONFIRMED (permanently claimed), and Release transitions it to RELEASED (held units returned to pool). Confirm returns 410 if the reservation expired.

### Why it exists
They provide the endpoints for the "Confirm purchase" and "Cancel" buttons on the reservation page.

### Key decisions made
- Decision: Map `EXPIRED` to 410 Gone.
  Alternatives considered: 400 Bad Request.
  Reason: 410 explicitly tells the client that the resource (the reservation hold) is no longer available. This triggers the frontend to show the expiry error.

### The line(s) that matter most
```typescript
if (message === 'EXPIRED') {
  return NextResponse.json({ error: 'Reservation has expired' }, { status: 410 })
}
```

### What could go wrong
If the confirm route doesn't return 410 for expired reservations, the frontend might show a generic error instead of clearly explaining that the user took too long.

### Interview question this file answers
"What happens if a user tries to confirm an expired reservation?"
Answer: The service layer's lazy check throws an `EXPIRED` error, which the route handler maps to an HTTP 410 Gone status. The frontend sees the 410 and displays a message explaining that the reservation expired before they could confirm.

---

## [Phase 3] app/api/cron/expire/route.ts & vercel.json

### What this file does
The `vercel.json` configures a cron job to hit the `/api/cron/expire` endpoint every minute. The route handler checks for a `CRON_SECRET` authorization header and then calls the service to release all expired pending reservations.

### Why it exists
This is the primary mechanism to return held stock to the available pool when users abandon their cart or take longer than 10 minutes. Without it, stock would be permanently locked by abandoned sessions.

### Key decisions made
- Decision: Protect the endpoint with `CRON_SECRET`.
  Alternatives considered: Unprotected endpoint.
  Reason: An unprotected endpoint could be spammed by attackers, causing unnecessary database load.

### The line(s) that matter most
```typescript
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### What could go wrong
If the `CRON_SECRET` is misconfigured or missing in Vercel, the endpoint will return 401 and the cron job will fail to release expired reservations, eventually locking up all stock.

### Interview question this file answers
"How do you ensure abandoned reservations are released?"
Answer: I use a scheduled Vercel Cron job that hits a protected endpoint every minute. This endpoint calls the database to find all PENDING reservations past their 10-minute expiry and releases them, returning the stock to the available pool.

---

## [Phase 5] test-concurrency.ts

### What this file does
An automated integration test that deliberately tries to trigger the race condition. It fetches the inventory ID for the 1-unit Mechanical Keyboard and fires 20 reservation requests simultaneously (`Promise.all`). It then asserts that exactly 1 request succeeded (201) and 19 failed with a conflict (409).

### Why it exists
Concurrency bugs are notoriously hard to reproduce manually. You can't click "Reserve" fast enough in two browsers to guarantee a race condition. This script proves the `SELECT ... FOR UPDATE` lock actually works under load. Without it, the "solution" is just theoretical.

### Key decisions made
- Decision: Use `Promise.all` with `fetch`.
  Alternatives considered: Jest, supertest, artillery load tester.
  Reason: A simple Node script with native `fetch` requires zero extra dependencies and runs instantly. It's the most transparent way to prove the concept to an interviewer without them needing to learn a testing framework's syntax.

### The line(s) that matter most
```typescript
// Fire 20 requests at the exact same time
const requests = Array.from({ length: 20 }, () =>
  fetch('http://localhost:3000/api/reservations', { method: 'POST', ... })
)
const statuses = await Promise.all(requests)
```

### What could go wrong
If the script is run when `MKT-002` has more than 1 unit of stock, multiple requests will legitimately succeed, and the test will fail its strict `successes === 1` assertion. If the server isn't running, it just crashes.

### Interview question this file answers
"How did you verify your concurrency logic actually works?"
Answer: I wrote a script that fires 20 simultaneous reservation requests at an item that only has 1 unit in stock. Using `Promise.all`, they all hit the server at the exact same millisecond. The script verifies that the server returns exactly one HTTP 201 Created and nineteen HTTP 409 Conflicts.

---

## [Phase 5] README.md

### What this file does
Explains the architecture, the concurrency strategy, the expiry mechanism, and the trade-offs made during development.

### Why it exists
The interviewer will read this before looking at a single line of code or joining the debrief call. It frames their understanding of the project and preemptively answers their biggest questions (like "why didn't you use Redis?").

### Key decisions made
- Decision: Explicitly document trade-offs.
  Alternatives considered: Just document how to run it.
  Reason: Senior engineers know there is no perfect system. Acknowledging that the 1-minute cron granularity is a limitation of the Vercel free tier, and that a message queue would be better in production, demonstrates maturity and system design experience.

### The line(s) that matter most
```markdown
**Chose PostgreSQL row locking over Redis distributed locks** — Postgres already 
owns the authoritative stock data. Adding Redis introduces a two-system consistency 
problem (what if Redis and Postgres disagree?).
```

### What could go wrong
If the README doesn't explicitly state that `reservedUnits` is *not* decremented on confirm, the interviewer might look at the database after a test, see `reservedUnits: 1`, and assume the code is broken because the stock didn't "return" or "decrement." Documenting the invariant prevents this misunderstanding.

### Interview question this file answers
"Why did you build it this way, and what would you do differently in a real production environment?"
Answer: I used Postgres row locks because keeping the lock in the same system as the data avoids split-brain issues. However, if I had more time for a true production system, I would add an `idempotencyKey` to the reservation table to handle network retries gracefully, and I'd replace the 1-minute Vercel Cron with a dedicated message queue like BullMQ to process expirations at the exact second they expire.

---

## Master Interview Cheat Sheet

### The one question that decides everything
**Q: "Walk me through how you prevent two users from buying the last unit simultaneously."**

A: "I handle this using a pessimistic row-level lock in PostgreSQL. When a request comes in, I open a transaction and execute `SELECT ... FOR UPDATE` on that specific inventory row. This tells Postgres to grant me an exclusive lock. If a second request arrives at the exact same millisecond, Postgres forces it to wait until the first transaction finishes. I then check the stock *inside* the locked transaction, decrement if available, and commit. By the time the second request gets the lock, it sees the updated stock count, realises the item is gone, and safely aborts. The race condition is eliminated entirely."

### 10 follow-up questions with answers

**Q: Why FOR UPDATE and not optimistic locking?**
A: Optimistic locking (using a version column) is great when conflicts are rare, because you avoid the overhead of locking. But for an inventory system, heavy contention on a popular SKU is the *expected* behavior. With optimistic locking, 19 out of 20 users would fail and have to retry, wasting app server resources. Pessimistic locking makes them queue at the DB level, which is cleaner for high-contention scenarios.

**Q: What is TOCTOU and where does it apply here?**
A: TOCTOU stands for Time-of-Check to Time-of-Use. If I check stock (`findUnique`), see there's enough, and then start a transaction to update it, another request could sneak in between the check and the update. That's why the stock check *must* happen inside the transaction, immediately after acquiring the `FOR UPDATE` lock.

**Q: What happens if the cron job fails?**
A: If the cron misses a beat, the system has a defensive "lazy check". When a user tries to confirm a reservation, the confirm endpoint explicitly checks if `now > expiresAt`. If it is, the confirm is rejected, the hold is released right then and there, and the user gets a 410 Gone error.

**Q: Why is reservedUnits not decremented on confirm?**
A: `CONFIRMED` means the item is sold. The `reservedUnits` counter represents stock that is no longer available in the warehouse — whether it's temporarily held in a cart, or permanently sold. This keeps the invariant simple: `available = totalUnits - reservedUnits`. Only a `RELEASED` status returns units to the pool.

**Q: How the expiry mechanism works end to end**
A: When a reservation is created, it gets a 10-minute TTL timestamp in the DB. A Vercel Cron job runs every minute, queries for all `PENDING` reservations where `expiresAt < now()`, and releases them one by one, decrementing `reservedUnits`. There's also a lazy check on the confirm route as a safety net.

**Q: What the inventory invariant is and how it's enforced**
A: The invariant is `reservedUnits <= totalUnits` at all times. It's enforced by the fact that we never store `availableUnits` as a column, we only compute it on the fly. Because we only mutate one column (`reservedUnits`) inside an exclusive row lock, it's impossible for the two numbers to desync.

**Q: Why no Redis was used**
A: Using Redis for distributed locking introduces a two-system consistency problem. If the app crashes after acquiring the Redis lock but before updating Postgres, you have to handle complex TTL and cleanup logic. Since Postgres owns the authoritative stock data anyway, using its native row locks is much simpler and equally robust for this scale.

**Q: What happens if two confirms fire simultaneously?**
A: The confirm endpoint also runs inside a transaction and checks that the reservation `status === 'PENDING'` before updating it to `CONFIRMED`. If two requests hit it, the first updates the status, and the second request will read the new status and throw a `NOT_PENDING` error.

**Q: How you tested concurrency correctness**
A: I wrote a Node script using `Promise.all` to fire 20 simultaneous `fetch` requests at the API for a SKU that I specifically seeded with only 1 unit of stock. The script asserts that exactly one request returns 201 (Created) and the other 19 return 409 (Conflict).

**Q: What you'd change with more time**
A: Three things: 1) Add an `idempotencyKey` to the reservation table so clients can safely retry network drops without double-reserving. 2) Replace the 1-minute cron with a message queue (like BullMQ) to process expirations at the exact millisecond they expire. 3) Move the database to a connection pooler like PgBouncer to handle higher throughput.
