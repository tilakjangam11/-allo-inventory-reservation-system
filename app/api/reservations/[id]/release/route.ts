// app/api/reservations/[id]/release/route.ts
// ═══════════════════════════════════════════════════════
// POST /api/reservations/:id/release
//
// Transitions a PENDING reservation to RELEASED.
// Decrements reservedUnits on the inventory row,
// returning the held units to the available pool.
//
// Returns:
//   200 — reservation released, stock returned
//   400 — reservation is not PENDING
//   404 — reservation not found
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { releaseReservation } from '@/lib/reservation-service'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const reservation = await releaseReservation(id)
    return NextResponse.json(reservation)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'

    if (message === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'Reservation not found' },
        { status: 404 }
      )
    }
    if (message === 'NOT_PENDING') {
      // Attempting to release a CONFIRMED or already-RELEASED
      // reservation. Return 400 to signal the client.
      return NextResponse.json(
        { error: 'Reservation is not in PENDING status' },
        { status: 400 }
      )
    }
    console.error('Release reservation failed:', e)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
