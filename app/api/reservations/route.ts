// app/api/reservations/route.ts
// ═══════════════════════════════════════════════════════
// POST /api/reservations
//
// Creates a new reservation. This is the entry point for
// the concurrency-critical path. The route handler is a
// thin wrapper: validate with Zod → call service → map
// error to HTTP status.
//
// Returns:
//   201 — reservation created successfully
//   400 — invalid input (Zod validation failure)
//   404 — inventory row not found
//   409 — not enough stock available (concurrency conflict)
//   500 — unexpected error
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { CreateReservationSchema } from '@/lib/validators'
import { createReservation } from '@/lib/reservation-service'
import { getIdempotencyKey, runIdempotent } from '@/lib/idempotency'

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null)
  const idempotencyKey = getIdempotencyKey(req)

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      scope: 'POST /api/reservations',
      payload: body,
    },
    async () => {
      const parsed = CreateReservationSchema.safeParse(body)

      if (!parsed.success) {
        return {
          statusCode: 400,
          body: { error: 'Invalid input', details: parsed.error.flatten() },
        }
      }

      try {
        const reservation = await createReservation(
          parsed.data.inventoryId,
          parsed.data.quantity
        )
        return { statusCode: 201, body: reservation }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error'

        if (message === 'INSUFFICIENT_STOCK') {
          return {
            statusCode: 409,
            body: { error: 'Not enough stock available' },
          }
        }
        if (message === 'INVENTORY_NOT_FOUND') {
          return {
            statusCode: 404,
            body: { error: 'Inventory not found' },
          }
        }

        console.error('Reservation creation failed:', e)
        return {
          statusCode: 500,
          body: { error: 'Internal server error' },
        }
      }
    }
  )

  return NextResponse.json(result.body, { status: result.statusCode })
}
