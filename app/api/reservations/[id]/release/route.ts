// app/api/reservations/[id]/release/route.ts
// ═══════════════════════════════════════════════════════
// POST /api/reservations/:id/release
//
// Transitions a PENDING reservation to RELEASED.
// Decrements reservedUnits on the inventory row,
// returning the held units to the available pool.
//
// Accepts optional { reason } in the body for audit.
//
// Returns:
//   200 — reservation released, stock returned
//   400 — reservation is not PENDING (already confirmed)
//   404 — reservation not found
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { releaseReservation } from '@/lib/reservation-service'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Accept optional reason from client
  let reason = 'manual_cancel'
  try {
    const body = await req.json()
    if (body?.reason && typeof body.reason === 'string') {
      reason = body.reason
    }
  } catch {
    // No body or invalid JSON — use default reason
  }

  try {
    const reservation = await releaseReservation(id, reason)
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
