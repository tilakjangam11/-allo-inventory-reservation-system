// app/api/cron/expire/route.ts
// ═══════════════════════════════════════════════════════
// GET /api/cron/expire
//
// Called by Vercel Cron every minute (configured in vercel.json).
// Finds all PENDING reservations past their expiresAt and
// releases them, returning held units to the stock pool.
//
// Protected by a Bearer token (CRON_SECRET) so only Vercel's
// cron scheduler can trigger it. Without this check, anyone
// could call the endpoint and release all pending reservations.
//
// Returns:
//   200 — cleanup ran successfully, reports count released
//   401 — missing or invalid authorization token
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { releaseExpiredReservations } from '@/lib/reservation-service'

export async function GET(req: Request) {
  // Verify the request is from Vercel's cron scheduler.
  // CRON_SECRET is set as an env var in Vercel's dashboard.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Run the cleanup. Each expired reservation is released
  // independently — failures on individual releases don't
  // block the rest (handled by .catch in the service).
  const released = await releaseExpiredReservations()

  return NextResponse.json({ released })
}
