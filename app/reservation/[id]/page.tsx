'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────
type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'RELEASED'

type Reservation = {
  id: string
  status: ReservationStatus
  quantity: number
  expiresAt: string
  confirmedAt: string | null
  releasedAt: string | null
  releaseReason: string | null
  inventory?: {
    product?: { name: string; sku: string; description?: string | null }
    warehouse?: { name: string; location: string }
  }
}

// ── Countdown Timer ───────────────────────────────────
function Countdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string
  onExpired: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  const expiredNotified = useRef(false)

  useEffect(() => {
    expiredNotified.current = false

    const tick = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      )

      setSeconds(diff)

      if (diff === 0 && !expiredNotified.current) {
        expiredNotified.current = true
        onExpired()
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [expiresAt, onExpired])

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const urgent = seconds <= 60
  const critical = seconds <= 30
  const totalDuration = 600 // 10 minutes
  const progressPct = Math.max(3, (seconds / totalDuration) * 100)

  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: urgent
          ? 'var(--danger-light)'
          : 'var(--primary-light)',
        border: `1px solid ${urgent ? 'rgba(225, 29, 72, 0.15)' : 'rgba(15, 118, 110, 0.12)'}`,
        transition: 'background 0.5s ease, border-color 0.5s ease',
      }}
    >
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Hold expires in
      </div>
      <div
        className={`countdown-display mt-3 text-5xl ${critical ? 'animate-pulse-soft' : ''}`}
        style={{
          color: urgent ? 'var(--danger)' : 'var(--text-primary)',
          transition: 'color 0.5s ease',
        }}
      >
        {String(mins).padStart(2, '0')}
        <span style={{ opacity: 0.4 }}>:</span>
        {String(secs).padStart(2, '0')}
      </div>
      <div className="progress-track mt-4" style={{ height: '4px' }}>
        <div
          className="progress-fill"
          style={{
            width: `${progressPct}%`,
            background: urgent ? 'var(--danger)' : 'var(--primary)',
            transition: 'width 1s linear, background 0.5s ease',
          }}
        />
      </div>
      {urgent && (
        <div className="mt-3 text-xs font-medium" style={{ color: 'var(--danger)', opacity: 0.8 }}>
          {critical ? 'Expiring soon — confirm now to secure your units' : 'Less than 1 minute remaining'}
        </div>
      )}
    </div>
  )
}

// ── Lifecycle Timeline ────────────────────────────────
function LifecycleTimeline({ status, releaseReason }: { status: ReservationStatus; releaseReason: string | null }) {
  const isExpired = status === 'RELEASED' && releaseReason === 'expired'

  const steps = [
    { label: 'Created', active: true },
    { label: 'Pending', active: status === 'PENDING' || status === 'CONFIRMED' || status === 'RELEASED' },
    {
      label: status === 'CONFIRMED' ? 'Confirmed' : isExpired ? 'Expired' : status === 'RELEASED' ? 'Released' : 'Awaiting',
      active: status === 'CONFIRMED' || status === 'RELEASED',
    },
  ]

  function dotStyle(step: typeof steps[0], idx: number): string {
    if (!step.active) return 'timeline-inactive'
    if (idx === 2) {
      if (status === 'CONFIRMED') return 'timeline-success'
      if (isExpired) return 'timeline-danger'
      return 'timeline-neutral'
    }
    return 'timeline-active'
  }

  return (
    <div className="flex items-center gap-0" style={{ padding: '0 4px' }}>
      {steps.map((step, idx) => (
        <div key={step.label} className="flex items-center" style={{ flex: idx < steps.length - 1 ? 1 : undefined }}>
          <div className="flex flex-col items-center gap-1.5">
            <div className={`timeline-dot ${dotStyle(step, idx)}`} />
            <span className="text-[10px] font-medium" style={{ color: step.active ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
              {step.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`timeline-line ${step.active && steps[idx + 1].active ? dotStyle(steps[idx + 1], idx + 1) : 'timeline-inactive'}`}
              style={{ margin: '0 4px', marginBottom: '18px' }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Status Pill ───────────────────────────────────────
function StatusPill({ status, releaseReason }: { status: ReservationStatus; releaseReason: string | null }) {
  const isExpired = status === 'RELEASED' && releaseReason === 'expired'

  if (isExpired) {
    return <span className="status-pill status-expired">Expired</span>
  }

  const styleMap: Record<ReservationStatus, string> = {
    PENDING: 'status-pending',
    CONFIRMED: 'status-confirmed',
    RELEASED: 'status-released',
  }

  return <span className={`status-pill ${styleMap[status]}`}>{status}</span>
}

// ── Main Page ─────────────────────────────────────────
export default function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; type: 'expired' | 'error' } | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const confirmKey = useRef<string | null>(null)

  const fetchReservation = useCallback(async () => {
    const res = await fetch(`/api/reservations/${id}`, { cache: 'no-store' })
    if (res.ok) {
      setReservation(await res.json())
    } else {
      setReservation(null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchReservation()
  }, [fetchReservation])

  async function handleConfirm() {
    setActionLoading(true)
    setError(null)
    setSuccess(null)
    confirmKey.current ??= crypto.randomUUID()

    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': confirmKey.current },
      })

      if (res.status === 410) {
        setError({
          message: 'This reservation expired before payment confirmation. The held units have been automatically returned to available stock.',
          type: 'expired',
        })
        await fetchReservation()
        return
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError({
          message: payload?.error ?? 'Could not confirm the purchase. Please try again.',
          type: 'error',
        })
        return
      }

      confirmKey.current = null
      setSuccess('Purchase confirmed successfully. Units have been permanently deducted from inventory.')
      await fetchReservation()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCancel() {
    setActionLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual_cancel' }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError({
          message: payload?.error ?? 'Could not cancel this reservation.',
          type: 'error',
        })
        return
      }

      setSuccess('Reservation cancelled. The held units have been returned to available stock.')
      await fetchReservation()
    } finally {
      setActionLoading(false)
    }
  }

  // ── Loading State ─────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 animate-fade-in">
        <div className="skeleton" style={{ height: '40px', width: '160px' }} />
        <div className="skeleton" style={{ height: '400px' }} />
      </div>
    )
  }

  // ── Not Found ─────────────────────────────────────
  if (!reservation) {
    return (
      <div className="mx-auto max-w-xl animate-scale-in">
        <div className="card p-10 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Reservation not found
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The hold may have been removed or the URL is incorrect.
          </p>
          <Link href="/" className="btn btn-primary mt-6 inline-flex">
            Browse products
          </Link>
        </div>
      </div>
    )
  }

  const isPending = reservation.status === 'PENDING'
  const isConfirmed = reservation.status === 'CONFIRMED'
  const isReleased = reservation.status === 'RELEASED'
  const isExpired = isReleased && reservation.releaseReason === 'expired'
  const product = reservation.inventory?.product
  const warehouse = reservation.inventory?.warehouse

  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-fade-in">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-semibold transition"
        style={{ color: 'var(--text-secondary)' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 12L6 8L10 4" />
        </svg>
        Back to products
      </Link>

      <section className="card overflow-hidden">
        {/* ── Dark Hero Header ─────────────────────────── */}
        <div
          className="grid gap-5 px-6 py-7 md:grid-cols-[1fr_auto] md:items-start"
          style={{
            background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-glow)' }}>
              Reservation
            </div>
            <h1 className="mt-2 text-3xl font-bold text-white" style={{ letterSpacing: '-0.02em' }}>
              {product?.name ?? 'Product hold'}
            </h1>
            <div className="mt-2 font-mono text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {reservation.id}
            </div>
          </div>
          <StatusPill status={reservation.status} releaseReason={reservation.releaseReason} />
        </div>

        {/* ── Body ─────────────────────────────────────── */}
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_260px]">
          <div className="space-y-5">
            {/* Details grid */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="card-inner p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  SKU
                </div>
                <div className="mt-2 font-mono text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {product?.sku ?? 'Unknown'}
                </div>
              </div>
              <div className="card-inner p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Quantity
                </div>
                <div className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {reservation.quantity} {reservation.quantity === 1 ? 'unit' : 'units'}
                </div>
              </div>
            </div>

            {/* Fulfilment location */}
            <div className="card-inner p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Fulfilment location
              </div>
              <div className="mt-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                {warehouse?.name ?? 'Warehouse'}
              </div>
              <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {warehouse?.location}
              </div>
            </div>

            {/* Lifecycle timeline */}
            <div className="card-inner p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
                Lifecycle
              </div>
              <LifecycleTimeline status={reservation.status} releaseReason={reservation.releaseReason} />
            </div>

            {/* ── Error Banner (410 / generic) ─────────── */}
            {error && (
              <div
                className={`alert animate-scale-in ${error.type === 'expired' ? 'alert-error' : 'alert-error'}`}
                role="alert"
              >
                <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                  {error.type === 'expired' ? (
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                  ) : (
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.06.75.75 0 011.06 1.06zm2.12 0a.75.75 0 10 1.06-1.06.75.75 0 00-1.06 1.06zM10 15a.75.75 0 01-.75-.75v-3.5a.75.75 0 011.5 0v3.5A.75.75 0 0110 15z" clipRule="evenodd" />
                  )}
                </svg>
                <div className="flex-1">
                  <div className="font-semibold" style={{ fontSize: '0.8125rem' }}>
                    {error.type === 'expired' ? 'Reservation expired (410 Gone)' : 'Error'}
                  </div>
                  <div style={{ marginTop: '2px', opacity: 0.9 }}>
                    {error.message}
                  </div>
                  {error.type === 'expired' && (
                    <Link
                      href="/"
                      className="inline-flex items-center gap-1 mt-3 text-xs font-semibold underline underline-offset-2"
                    >
                      Browse products and try again →
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* ── Success Banner ───────────────────────── */}
            {success && (
              <div className="alert alert-success animate-scale-in" role="status">
                <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <div className="font-semibold" style={{ fontSize: '0.8125rem' }}>
                    {isConfirmed ? 'Purchase confirmed' : 'Reservation released'}
                  </div>
                  <div style={{ marginTop: '2px', opacity: 0.9 }}>
                    {success}
                  </div>
                </div>
              </div>
            )}

            {/* ── Confirmed state ──────────────────────── */}
            {isConfirmed && !success && (
              <div className="alert alert-success animate-fade-in">
                <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="font-semibold" style={{ fontSize: '0.8125rem' }}>Purchase confirmed</div>
                  <div style={{ marginTop: '2px', opacity: 0.9 }}>
                    The reservation is now final. Units have been permanently removed from available inventory.
                  </div>
                </div>
              </div>
            )}

            {/* ── Released state ───────────────────────── */}
            {isReleased && !isExpired && !success && (
              <div className="alert alert-neutral animate-fade-in">
                <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 9.25a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="font-semibold" style={{ fontSize: '0.8125rem' }}>Reservation released</div>
                  <div style={{ marginTop: '2px', opacity: 0.9 }}>
                    The held units have been returned to available stock for other shoppers.
                  </div>
                </div>
              </div>
            )}

            {/* ── Expired state ────────────────────────── */}
            {isExpired && !error && (
              <div className="alert alert-error animate-fade-in">
                <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="font-semibold" style={{ fontSize: '0.8125rem' }}>Reservation expired</div>
                  <div style={{ marginTop: '2px', opacity: 0.9 }}>
                    This hold expired before confirmation. The units have been returned to available stock.
                  </div>
                  <Link
                    href="/"
                    className="inline-flex items-center gap-1 mt-3 text-xs font-semibold underline underline-offset-2"
                    style={{ color: 'inherit' }}
                  >
                    Browse products and reserve again →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ── Sidebar Actions ────────────────────────── */}
          <aside className="space-y-4">
            {isPending && (
              <>
                <Countdown expiresAt={reservation.expiresAt} onExpired={fetchReservation} />
                <div className="grid gap-3">
                  <button
                    onClick={handleConfirm}
                    disabled={actionLoading}
                    className="btn btn-primary btn-lg btn-block"
                    id="confirm-purchase"
                  >
                    {actionLoading ? (
                      <>
                        <span className="spinner" />
                        Processing
                      </>
                    ) : (
                      'Confirm purchase'
                    )}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="btn btn-secondary btn-lg btn-block"
                    id="cancel-reservation"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-center" style={{ color: 'var(--text-tertiary)' }}>
                  Units are held until the timer expires.
                  <br />
                  Confirm to complete the purchase.
                </p>
              </>
            )}

            {!isPending && (
              <Link
                href="/"
                className="btn btn-primary btn-lg btn-block"
                id="return-to-inventory"
              >
                Return to inventory
              </Link>
            )}
          </aside>
        </div>
      </section>
    </div>
  )
}
