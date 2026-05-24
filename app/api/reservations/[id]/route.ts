// app/api/reservations/[id]/route.ts
// ═══════════════════════════════════════════════════════
// GET /api/reservations/:id
//
// Returns a single reservation with its related inventory,
// product, and warehouse data. The reservation detail page
// fetches this on load and after every confirm/cancel action
// to reflect the current state without a full page refresh.
//
// Without this route, the reservation page gets 404s.
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { getReservation } from '@/lib/reservation-service'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const reservation = await getReservation(id)

  if (!reservation) {
    return NextResponse.json(
      { error: 'Reservation not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(reservation)
}
