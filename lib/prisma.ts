// lib/prisma.ts
// ═══════════════════════════════════════════════════════
// Singleton Prisma client.
//
// In development, Next.js hot-reloads modules on every
// save. Without this singleton pattern, each reload
// creates a new PrismaClient, exhausting the database
// connection pool within minutes.
//
// In production, module-level state persists across
// requests naturally, so the singleton is a no-op safeguard.
// ═══════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'

// Extend globalThis type to store the client without
// TypeScript complaining about unknown properties.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient
}

// Reuse existing client if it's already been created
// (dev hot-reload scenario), otherwise create a new one.
// Only log errors — query logging is too noisy in dev.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

// Cache the client on globalThis, but only in dev.
// In production, module scope is sufficient.
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
