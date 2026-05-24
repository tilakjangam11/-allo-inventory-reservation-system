// app/api/reservations/[id]/confirm/route.ts
// ═══════════════════════════════════════════════════════
// POST /api/reservations/:id/confirm
//
// Transitions a PENDING reservation to CONFIRMED.
// The service layer checks expiry inside the transaction
// before confirming — if expired, returns 410 Gone.
//
// Returns:
//   200 — reservation confirmed
//   400 — reservation is not PENDING (already confirmed/released)
//   404 — reservation not found
//   410 — reservation has expired (hold released, stock returned)
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { confirmReservation } from '@/lib/reservation-service'
import { getIdempotencyKey, runIdempotent } from '@/lib/idempotency'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const idempotencyKey = getIdempotencyKey(req)

  const result = await runIdempotent(
    {
      key: idempotencyKey,
      scope: `POST /api/reservations/${id}/confirm`,
      payload: {},
    },
    async () => {
      try {
        const reservation = await confirmReservation(id)
        return { statusCode: 200, body: reservation }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error'

        if (message === 'EXPIRED') {
          return {
            statusCode: 410,
            body: { error: 'Reservation has expired' },
          }
        }
        if (message === 'NOT_FOUND') {
          return {
            statusCode: 404,
            body: { error: 'Reservation not found' },
          }
        }
        if (message === 'NOT_PENDING') {
          return {
            statusCode: 400,
            body: { error: 'Reservation is not in PENDING status' },
          }
        }

        console.error('Confirm reservation failed:', e)
        return {
          statusCode: 500,
          body: { error: 'Internal server error' },
        }
      }
    }
  )

  return NextResponse.json(result.body, { status: result.statusCode })
}
