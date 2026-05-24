// lib/validators.ts
// ═══════════════════════════════════════════════════════
// Zod schemas for request validation.
//
// These schemas run BEFORE any database call. They reject
// malformed input at the API boundary so the service layer
// can trust its inputs are well-typed.
//
// Using Zod (not manual if-checks) because:
// 1. Type inference — schema doubles as a TypeScript type
// 2. Composable — schemas can extend each other
// 3. Detailed errors — Zod gives per-field error messages
// ═══════════════════════════════════════════════════════

import { z } from 'zod'

// ── CreateReservation ──────────────────────────────────
// Validates the POST /api/reservations body.
//
// inventoryId must be a valid cuid — this prevents
// SQL injection via malformed IDs and catches typos early.
//
// quantity is capped at 100 to prevent abuse (someone
// reserving 999999 units to lock out all stock). In a real
// system this would be configurable per-product.
export const CreateReservationSchema = z.object({
  inventoryId: z.string().cuid(),                   // must be a valid cuid format
  quantity: z.number().int().positive().max(100),    // positive integer, max 100 units per reservation
})

// Infer the TypeScript type from the schema.
// This is used as the function parameter type in
// reservation-service.ts so the Zod schema and the
// TypeScript type can never drift apart.
export type CreateReservationInput = z.infer<typeof CreateReservationSchema>
