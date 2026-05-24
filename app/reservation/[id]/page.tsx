'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Reservation = {
  id: string
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED'
  quantity: number
  expiresAt: string
  inventory?: {
    product?: { name: string; sku: string; description?: string | null }
    warehouse?: { name: string; location: string }
  }
}

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

  return (
    <div className={`rounded-lg border p-5 ${urgent ? 'border-rose-200 bg-rose-50' : 'border-cyan-200 bg-cyan-50'}`}>
      <div className="text-sm font-semibold text-slate-600">Hold expires in</div>
      <div className={`mt-2 font-mono text-5xl font-semibold ${urgent ? 'text-rose-700' : 'text-slate-950'}`}>
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-md bg-white">
        <div
          className={`h-full rounded-md ${urgent ? 'bg-rose-500' : 'bg-cyan-600'}`}
          style={{ width: `${Math.max(3, (seconds / 600) * 100)}%` }}
        />
      </div>
    </div>
  )
}

export default function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReservation()
  }, [fetchReservation])

  async function handleConfirm() {
    setActionLoading(true)
    setError(null)
    confirmKey.current ??= crypto.randomUUID()

    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: { 'Idempotency-Key': confirmKey.current },
      })

      if (res.status === 410) {
        setError('Reservation expired before payment confirmation. The unit has been released.')
        await fetchReservation()
        return
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError(payload?.error ?? 'Could not confirm the purchase. Please try again.')
        return
      }

      confirmKey.current = null
      await fetchReservation()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCancel() {
    setActionLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/reservations/${id}/release`, { method: 'POST' })

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError(payload?.error ?? 'Could not cancel this reservation.')
        return
      }

      await fetchReservation()
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="h-10 w-40 animate-pulse rounded-md bg-slate-200" />
        <div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>
    )
  }

  if (!reservation) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Reservation not found</h1>
        <p className="mt-2 text-sm text-slate-600">The hold may have been removed or the URL is incorrect.</p>
        <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white">
          Browse products
        </Link>
      </div>
    )
  }

  const isPending = reservation.status === 'PENDING'
  const isConfirmed = reservation.status === 'CONFIRMED'
  const product = reservation.inventory?.product
  const warehouse = reservation.inventory?.warehouse

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/" className="inline-flex text-sm font-semibold text-slate-600 hover:text-slate-950">
        Back to products
      </Link>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-5 border-b border-slate-200 bg-slate-950 px-6 py-6 text-white md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <div className="text-sm font-medium text-cyan-200">Reservation</div>
            <h1 className="mt-2 text-3xl font-semibold">{product?.name ?? 'Product hold'}</h1>
            <div className="mt-2 font-mono text-sm text-slate-300">{reservation.id}</div>
          </div>
          <span className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold ${
            isPending
              ? 'bg-amber-300 text-amber-950'
              : isConfirmed
                ? 'bg-emerald-300 text-emerald-950'
                : 'bg-slate-200 text-slate-800'
          }`}>
            {reservation.status}
          </span>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[1fr_240px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">SKU</div>
                <div className="mt-2 font-mono text-lg text-slate-950">{product?.sku ?? 'Unknown'}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">Quantity</div>
                <div className="mt-2 text-lg font-semibold text-slate-950">{reservation.quantity} unit</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">Fulfilment location</div>
              <div className="mt-2 font-semibold text-slate-950">{warehouse?.name ?? 'Warehouse'}</div>
              <div className="mt-1 text-sm text-slate-600">{warehouse?.location}</div>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                {error}
              </div>
            )}

            {isConfirmed && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
                <h2 className="text-lg font-semibold text-emerald-950">Purchase confirmed</h2>
                <p className="mt-2 text-sm leading-6 text-emerald-800">
                  The reservation is now final and the units remain removed from available inventory.
                </p>
              </div>
            )}

            {reservation.status === 'RELEASED' && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <h2 className="text-lg font-semibold text-slate-950">Reservation released</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  The held unit has returned to available stock for other shoppers.
                </p>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            {isPending && (
              <>
                <Countdown expiresAt={reservation.expiresAt} onExpired={fetchReservation} />
                <div className="grid gap-3">
                  <button
                    onClick={handleConfirm}
                    disabled={actionLoading}
                    className="h-12 rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    {actionLoading ? 'Processing...' : 'Confirm purchase'}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="h-12 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {!isPending && (
              <Link
                href="/"
                className="inline-flex h-12 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-cyan-700"
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
