// app/api/warehouses/route.ts
// ═══════════════════════════════════════════════════════
// GET /api/warehouses
// Returns all warehouse records.
// Thin wrapper — no business logic.
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const warehouses = await prisma.warehouse.findMany()
  return NextResponse.json(warehouses)
}
