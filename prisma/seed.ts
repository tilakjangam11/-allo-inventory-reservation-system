// prisma/seed.ts
// ═══════════════════════════════════════════════════════
// Populates the database with realistic test data.
// The data is carefully chosen to enable specific test
// scenarios — especially the 1-unit MKT-002 keyboard
// that makes the concurrency test meaningful.
// ═══════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.idempotencyRecord.deleteMany()
  await prisma.reservation.deleteMany()
  await prisma.inventory.deleteMany()
  await prisma.product.deleteMany()
  await prisma.warehouse.deleteMany()

  // ── Warehouses ──────────────────────────────────────
  // Two warehouses give us multi-location stock to
  // demonstrate that reservations are per-warehouse,
  // not globally pooled.
  const wh1 = await prisma.warehouse.create({
    data: { name: 'London Fulfilment Centre', location: 'London, UK' }
  })
  const wh2 = await prisma.warehouse.create({
    data: { name: 'Manchester Hub', location: 'Manchester, UK' }
  })

  // ── Products ────────────────────────────────────────
  // Three products with distinct stock levels to test
  // different reservation scenarios.
  const p1 = await prisma.product.create({
    data: {
      name: 'Wireless Headphones Pro',
      sku: 'WHP-001',
      description: 'Premium noise-cancelling wireless headphones with 30-hour battery life'
    }
  })
  const p2 = await prisma.product.create({
    data: {
      name: 'Mechanical Keyboard TKL',
      sku: 'MKT-002',
      description: 'Tenkeyless mechanical keyboard with hot-swappable switches'
    }
  })
  const p3 = await prisma.product.create({
    data: {
      name: 'USB-C Hub 7-Port',
      sku: 'UCH-003',
      description: 'Aluminium USB-C hub with HDMI, USB-A, SD card, and ethernet'
    }
  })

  // ── Inventory ───────────────────────────────────────
  // Stock levels are deliberately chosen:
  //
  // - WHP-001 in London (5 units): comfortable stock, normal flow
  // - WHP-001 in Manchester (3 units): moderate stock
  // - MKT-002 in London (1 unit): THE concurrency test target
  //   → 20 simultaneous requests, exactly 1 succeeds
  // - UCH-003 in London (10 units): high stock, no contention
  // - UCH-003 in Manchester (4 units): moderate stock
  //
  // reservedUnits starts at 0 for all — clean slate.
  await prisma.inventory.createMany({
    data: [
      { productId: p1.id, warehouseId: wh1.id, totalUnits: 5, reservedUnits: 0 },
      { productId: p1.id, warehouseId: wh2.id, totalUnits: 3, reservedUnits: 0 },
      { productId: p2.id, warehouseId: wh1.id, totalUnits: 1, reservedUnits: 0 },  // ← tight stock for concurrency test
      { productId: p3.id, warehouseId: wh1.id, totalUnits: 10, reservedUnits: 0 },
      { productId: p3.id, warehouseId: wh2.id, totalUnits: 4, reservedUnits: 0 },
    ]
  })

  console.log('✓ Seeded: 2 warehouses, 3 products, 5 inventory rows')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)           // non-zero exit so CI pipelines catch failures
  })
  .finally(() => {
    prisma.$disconnect()      // always close the connection pool
  })
