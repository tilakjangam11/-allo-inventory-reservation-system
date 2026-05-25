'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────
type StockEntry = {
  inventoryId: string
  warehouse: string
  warehouseLocation: string
  available: number
  reserved: number
  total: number
}

type Product = {
  id: string
  name: string
  sku: string
  description: string | null
  stock: StockEntry[]
}

// ── Animated Number ───────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)

  useEffect(() => {
    if (prevRef.current === value) return
    const start = prevRef.current
    const diff = value - start
    const duration = 400
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + diff * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
    prevRef.current = value
  }, [value])

  return <>{display}</>
}

// ── Stock Tone Helper ─────────────────────────────────
function getStockStyle(available: number): { className: string; label: string } {
  if (available === 0) return { className: 'stock-out', label: 'Out of stock' }
  if (available <= 2) return { className: 'stock-low', label: `${available} available` }
  return { className: 'stock-available', label: `${available} available` }
}

// ── Main Page ─────────────────────────────────────────
export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [reserving, setReserving] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; type: 'conflict' | 'expired' | 'error' } | null>(null)
  const router = useRouter()

  const loadProducts = useCallback(async () => {
    const res = await fetch('/api/products', { cache: 'no-store' })
    if (!res.ok) throw new Error('LOAD_FAILED')
    setProducts(await res.json())
  }, [])

  useEffect(() => {
    loadProducts()
      .catch(() => setError({
        message: 'Failed to load inventory. Check the database connection and try again.',
        type: 'error',
      }))
      .finally(() => setLoading(false))
  }, [loadProducts])

  const totals = useMemo(() => {
    const rows = products.flatMap((product) => product.stock)
    return {
      skus: products.length,
      warehouses: new Set(rows.map((row) => row.warehouse)).size,
      available: rows.reduce((sum, row) => sum + row.available, 0),
      held: rows.reduce((sum, row) => sum + row.reserved, 0),
    }
  }, [products])

  async function handleReserve(inventoryId: string) {
    setReserving(inventoryId)
    setError(null)

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ inventoryId, quantity: 1 }),
      })

      if (res.status === 409) {
        setError({
          message: 'Not enough stock available. Another checkout claimed the last unit before yours.',
          type: 'conflict',
        })
        await loadProducts()
        return
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError({
          message: payload?.error ?? 'Could not create the reservation. Please try again.',
          type: 'error',
        })
        return
      }

      const reservation = await res.json()
      router.push(`/reservation/${reservation.id}`)
    } finally {
      setReserving(null)
    }
  }

  function dismissError() {
    setError(null)
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── Hero Section ─────────────────────────────── */}
      <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div className="space-y-5">
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
            style={{
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              border: '1px solid rgba(15, 118, 110, 0.12)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1L11 4V8L6 11L1 8V4L6 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
            </svg>
            Checkout-safe inventory holds
          </div>
          <div className="space-y-3">
            <h1
              className="max-w-3xl text-4xl font-extrabold sm:text-5xl"
              style={{ color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: '1.1' }}
            >
              Reserve stock for the payment window.
            </h1>
            <p
              className="max-w-2xl text-base leading-7"
              style={{ color: 'var(--text-secondary)' }}
            >
              Products stay available until checkout begins. Once a shopper reserves a unit,
              Postgres row locks make sure the last item can only be claimed once.
            </p>
          </div>
        </div>

        {/* ── KPI Cards ────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 stagger">
          {([
            ['SKUs', totals.skus, '📦'],
            ['Warehouses', totals.warehouses, '🏭'],
            ['Available', totals.available, '✅'],
            ['Held or sold', totals.held, '🔒'],
          ] as const).map(([label, value, icon]) => (
            <div key={label} className="kpi-card animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="text-lg">{icon}</span>
              </div>
              <div className="kpi-value mt-2">
                <AnimatedNumber value={value as number} />
              </div>
              <div className="kpi-label">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Error Banner ───────────────────────────────── */}
      {error && (
        <div
          className={`alert animate-scale-in ${
            error.type === 'conflict' ? 'alert-warning' : error.type === 'expired' ? 'alert-error' : 'alert-error'
          }`}
          role="alert"
        >
          <svg className="alert-icon" viewBox="0 0 20 20" fill="currentColor">
            {error.type === 'conflict' ? (
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            ) : (
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.06-1.06 .75.75 0 011.06 1.06zm2.12 0a.75.75 0 10 1.06-1.06.75.75 0 00-1.06 1.06zM10 15a.75.75 0 01-.75-.75v-3.5a.75.75 0 011.5 0v3.5A.75.75 0 0110 15z" clipRule="evenodd" />
            )}
          </svg>
          <div className="flex-1">
            <div className="font-semibold" style={{ fontSize: '0.8125rem' }}>
              {error.type === 'conflict' ? 'Stock conflict (409)' : 'Error'}
            </div>
            <div style={{ marginTop: '2px', opacity: 0.9 }}>
              {error.message}
            </div>
            {error.type === 'conflict' && (
              <div style={{ marginTop: '8px', fontSize: '0.8125rem', opacity: 0.8 }}>
                Try reserving from a different warehouse, or wait for holds to expire.
              </div>
            )}
          </div>
          <button
            onClick={dismissError}
            className="flex-shrink-0 p-1 rounded-md transition hover:opacity-70"
            aria-label="Dismiss"
            style={{ marginTop: '-2px' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Product List ───────────────────────────────── */}
      {loading ? (
        <div className="grid gap-5 stagger">
          {[1, 2, 3].map((item) => (
            <div key={item} className="skeleton animate-fade-in" style={{ height: '180px' }} />
          ))}
        </div>
      ) : (
        <section className="grid gap-5 stagger">
          {products.map((product) => {
            const totalAvailable = product.stock.reduce((sum, row) => sum + row.available, 0)
            const totalUnits = product.stock.reduce((sum, row) => sum + row.total, 0)
            const availablePct = totalUnits === 0 ? 0 : Math.round((totalAvailable / totalUnits) * 100)

            return (
              <article key={product.id} className="card animate-fade-in overflow-hidden">
                {/* Product header */}
                <div
                  className="grid gap-5 px-6 py-5 md:grid-cols-[1fr_180px] md:items-center"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2
                        className="text-xl font-bold"
                        style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
                      >
                        {product.name}
                      </h2>
                      <span
                        className="font-mono text-xs font-medium px-2 py-1 rounded-md"
                        style={{
                          background: 'var(--bg)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {product.sku}
                      </span>
                    </div>
                    <p className="max-w-2xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                      {product.description}
                    </p>
                  </div>

                  {/* Availability bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span style={{ color: 'var(--text-secondary)' }}>Available</span>
                      <span style={{ color: availablePct > 50 ? 'var(--success)' : availablePct > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                        {availablePct}%
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill progress-primary"
                        style={{ width: `${availablePct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Warehouse rows */}
                <div>
                  {product.stock.map((stock, idx) => {
                    const isOutOfStock = stock.available === 0
                    const stockPct = stock.total === 0 ? 0 : Math.round((stock.available / stock.total) * 100)
                    const stockStyle = getStockStyle(stock.available)

                    return (
                      <div
                        key={stock.inventoryId}
                        className="grid gap-4 px-6 py-4 md:grid-cols-[1fr_200px_130px] md:items-center transition-colors"
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--border)' : undefined,
                        }}
                      >
                        {/* Warehouse info */}
                        <div>
                          <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                            {stock.warehouse}
                          </div>
                          <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            {stock.warehouseLocation}
                          </div>
                        </div>

                        {/* Stock metrics */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className={`stock-chip ${stockStyle.className}`}>
                              {stockStyle.label}
                            </span>
                            <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                              {stock.reserved}/{stock.total} held
                            </span>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-fill progress-dark"
                              style={{ width: `${stockPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Reserve button */}
                        <button
                          onClick={() => handleReserve(stock.inventoryId)}
                          disabled={isOutOfStock || reserving === stock.inventoryId}
                          className="btn btn-primary"
                          id={`reserve-${stock.inventoryId}`}
                        >
                          {reserving === stock.inventoryId ? (
                            <>
                              <span className="spinner" />
                              Reserving
                            </>
                          ) : (
                            'Reserve'
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
