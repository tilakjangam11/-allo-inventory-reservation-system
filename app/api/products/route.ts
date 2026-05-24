// app/api/products/route.ts
// ═══════════════════════════════════════════════════════
// GET /api/products
// Returns all products with per-warehouse stock info.
// availableUnits is computed here, not stored in the DB.
// ═══════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { releaseExpiredReservations } from '@/lib/reservation-service'

export async function GET() {
  await releaseExpiredReservations()

  // Fetch products with their inventory rows, each
  // including the warehouse name for display purposes.
  const products = await prisma.product.findMany({
    include: {
      inventory: {
        include: { warehouse: true },
      },
    },
  })

  // Transform the raw Prisma result into a clean API shape.
  // The frontend shouldn't need to compute availableUnits
  // or navigate nested relations — we do that here.
  const result = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    stock: p.inventory.map((inv) => ({
      inventoryId: inv.id,
      warehouse: inv.warehouse.name,
      warehouseLocation: inv.warehouse.location,
      warehouseId: inv.warehouseId,
      // Compute available stock from the invariant fields.
      // This is the ONLY place availableUnits is calculated
      // for the product listing API.
      available: inv.totalUnits - inv.reservedUnits,
      total: inv.totalUnits,
      reserved: inv.reservedUnits,
    })),
  }))

  return NextResponse.json(result)
}
