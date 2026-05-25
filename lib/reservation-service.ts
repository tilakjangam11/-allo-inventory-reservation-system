// lib/reservation-service.ts
// ═══════════════════════════════════════════════════════
// Core business logic for inventory reservations.
//
// Every mutation runs inside a Postgres transaction with
// row-level locks (SELECT ... FOR UPDATE) to prevent
// overselling. This is the concurrency-critical module.
// ═══════════════════════════════════════════════════════

import { Prisma, ReservationStatus } from '@prisma/client'
import { prisma } from './prisma'

const RESERVATION_TTL_MINUTES = 10

interface InventoryRow {
  id: string
  totalUnits: number
  reservedUnits: number
}

interface ReservationRow {
  id: string
  inventoryId: string
  quantity: number
  status: ReservationStatus
  expiresAt: Date
}

const reservationInclude = {
  inventory: {
    include: {
      product: true,
      warehouse: true,
    },
  },
} satisfies Prisma.ReservationInclude

// ── CREATE ────────────────────────────────────────────
// Locks the inventory row, checks available stock, then
// atomically increments reservedUnits and inserts the
// reservation. Two simultaneous requests for the last
// unit will serialize on the lock — exactly one wins.
export async function createReservation(
  inventoryId: string,
  quantity: number
) {
  return prisma.$transaction(
    async (tx) => {
      // Lock the inventory row to prevent concurrent overselling
      const rows = await tx.$queryRaw<InventoryRow[]>`
        SELECT id, "totalUnits", "reservedUnits"
        FROM "Inventory"
        WHERE id = ${inventoryId}
        FOR UPDATE
      `

      if (rows.length === 0) {
        throw new Error('INVENTORY_NOT_FOUND')
      }

      const inventory = rows[0]
      const available = inventory.totalUnits - inventory.reservedUnits

      if (available < quantity) {
        throw new Error('INSUFFICIENT_STOCK')
      }

      // Increment reserved count — this unit is now held
      await tx.inventory.update({
        where: { id: inventoryId },
        data: { reservedUnits: { increment: quantity } },
      })

      // Create the reservation with a 10-minute TTL
      return tx.reservation.create({
        data: {
          inventoryId,
          quantity,
          status: 'PENDING',
          expiresAt: new Date(
            Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000
          ),
        },
        include: reservationInclude,
      })
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 15000,
      timeout: 20000,
    }
  )
}

// ── READ ──────────────────────────────────────────────
// Returns a reservation with its related data.
// Performs lazy cleanup if the reservation has expired
// but hasn't been released yet (defensive fallback).
export async function getReservation(reservationId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: reservationInclude,
  })

  if (!reservation) {
    return null
  }

  // Lazy expiry cleanup: if the reservation is still PENDING
  // but past its expiresAt, release it now before returning.
  if (reservation.status === 'PENDING' && reservation.expiresAt < new Date()) {
    await releaseReservation(reservationId, 'expired').catch(() => {})
    return prisma.reservation.findUnique({
      where: { id: reservationId },
      include: reservationInclude,
    })
  }

  return reservation
}

// ── CONFIRM ───────────────────────────────────────────
// Transitions PENDING → CONFIRMED.
//
// CRITICAL: On confirmation, units are permanently sold:
// - Decrement reservedUnits (hold is resolved)
// - Decrement totalUnits (units leave the warehouse)
//
// If the reservation has expired, it is released instead
// and the caller receives an EXPIRED error → 410.
export async function confirmReservation(reservationId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      // Lock the reservation row to prevent confirm/release race
      const rows = await tx.$queryRaw<ReservationRow[]>`
        SELECT id, "inventoryId", quantity, status, "expiresAt"
        FROM "Reservation"
        WHERE id = ${reservationId}
        FOR UPDATE
      `

      if (rows.length === 0) {
        throw new Error('NOT_FOUND')
      }

      const reservation = rows[0]

      if (reservation.status !== 'PENDING') {
        throw new Error('NOT_PENDING')
      }

      // Check expiry — if past deadline, release instead of confirming
      if (reservation.expiresAt < new Date()) {
        await tx.inventory.update({
          where: { id: reservation.inventoryId },
          data: { reservedUnits: { decrement: reservation.quantity } },
        })

        await tx.reservation.update({
          where: { id: reservationId },
          data: {
            status: 'RELEASED',
            releasedAt: new Date(),
            releaseReason: 'expired',
          },
        })

        return { outcome: 'EXPIRED' as const }
      }

      // Confirm: units are permanently sold
      // Decrement BOTH reservedUnits and totalUnits
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          reservedUnits: { decrement: reservation.quantity },
          totalUnits: { decrement: reservation.quantity },
        },
      })

      const confirmed = await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
        include: reservationInclude,
      })

      return { outcome: 'CONFIRMED' as const, reservation: confirmed }
    },
    {
      maxWait: 15000,
      timeout: 20000,
    }
  )

  if (result.outcome === 'EXPIRED') {
    throw new Error('EXPIRED')
  }

  return result.reservation
}

// ── RELEASE ───────────────────────────────────────────
// Transitions PENDING → RELEASED.
// Returns held units to the available pool by
// decrementing reservedUnits (totalUnits stays the same).
export async function releaseReservation(
  reservationId: string,
  reason: string = 'manual_cancel'
) {
  return prisma.$transaction(
    async (tx) => {
      // Lock the reservation row
      const rows = await tx.$queryRaw<ReservationRow[]>`
        SELECT id, "inventoryId", quantity, status, "expiresAt"
        FROM "Reservation"
        WHERE id = ${reservationId}
        FOR UPDATE
      `

      if (rows.length === 0) {
        throw new Error('NOT_FOUND')
      }

      const reservation = rows[0]

      // Already released — return current state idempotently
      if (reservation.status === 'RELEASED') {
        return tx.reservation.findUniqueOrThrow({
          where: { id: reservationId },
          include: reservationInclude,
        })
      }

      // Cannot release a confirmed reservation
      if (reservation.status !== 'PENDING') {
        throw new Error('NOT_PENDING')
      }

      // Return held units to the available pool
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: { reservedUnits: { decrement: reservation.quantity } },
      })

      return tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releaseReason: reason,
        },
        include: reservationInclude,
      })
    },
    {
      maxWait: 15000,
      timeout: 20000,
    }
  )
}

// ── EXPIRY CLEANUP ────────────────────────────────────
// Called by Vercel Cron and as lazy fallback on reads.
// Finds all expired PENDING reservations and releases
// them individually in separate transactions.
export async function releaseExpiredReservations() {
  const expired = await prisma.reservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: new Date() },
    },
    select: { id: true },
  })

  let released = 0

  for (const reservation of expired) {
    await releaseReservation(reservation.id, 'expired')
      .then(() => {
        released += 1
      })
      .catch(() => {})
  }

  return released
}
