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

export async function createReservation(
  inventoryId: string,
  quantity: number
) {
  return prisma.$transaction(
    async (tx) => {
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

      await tx.inventory.update({
        where: { id: inventoryId },
        data: { reservedUnits: { increment: quantity } },
      })

      return tx.reservation.create({
        data: {
          inventoryId,
          quantity,
          status: 'PENDING',
          expiresAt: new Date(
            Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000
          ),
        },
      })
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 15000,
      timeout: 20000,
    }
  )
}

export async function getReservation(reservationId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: reservationInclude,
  })

  if (!reservation) {
    return null
  }

  if (reservation.status === 'PENDING' && reservation.expiresAt < new Date()) {
    await releaseReservation(reservationId).catch(() => {})
    return prisma.reservation.findUnique({
      where: { id: reservationId },
      include: reservationInclude,
    })
  }

  return reservation
}

export async function confirmReservation(reservationId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
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

      if (reservation.expiresAt < new Date()) {
        await tx.inventory.update({
          where: { id: reservation.inventoryId },
          data: { reservedUnits: { decrement: reservation.quantity } },
        })

        const released = await tx.reservation.update({
          where: { id: reservationId },
          data: { status: 'RELEASED' },
        })

        return { outcome: 'EXPIRED' as const, reservation: released }
      }

      const confirmed = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CONFIRMED' },
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

export async function releaseReservation(reservationId: string) {
  return prisma.$transaction(
    async (tx) => {
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

      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: { reservedUnits: { decrement: reservation.quantity } },
      })

      return tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'RELEASED' },
      })
    },
    {
      maxWait: 15000,
      timeout: 20000,
    }
  )
}

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
    await releaseReservation(reservation.id)
      .then(() => {
        released += 1
      })
      .catch(() => {})
  }

  return released
}
