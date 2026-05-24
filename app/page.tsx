'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

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

function stockTone(available: number) {
  if (available === 0) return 'bg-rose-100 text-rose-800 border-rose-200'
  if (available <= 2) return 'bg-amber-100 text-amber-900 border-amber-200'
  return 'bg-emerald-100 text-emerald-900 border-emerald-200'
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [reserving, setReserving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const loadProducts = useCallback(async () => {
    const res = await fetch('/api/products', { cache: 'no-store' })
    if (!res.ok) throw new Error('LOAD_FAILED')
    setProducts(await res.json())
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProducts()
      .catch(() => setError('Failed to load inventory. Check the database connection and try again.'))
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
        setError('Not enough stock available. Another checkout won the race for that unit.')
        await loadProducts()
        return
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError(payload?.error ?? 'Could not create the reservation. Please try again.')
        return
      }

      const reservation = await res.json()
      router.push(`/reservation/${reservation.id}`)
    } finally {
      setReserving(null)
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
        <div className="space-y-4">
          <div className="inline-flex rounded-md border border-slate-200 bg-white/80 px-3 py-1 text-sm font-medium text-slate-700 shadow-sm">
            Checkout-safe inventory holds
          </div>
          <div className="space-y-3">
            <h1 className="max-w-3xl text-4xl font-semibold text-slate-950 sm:text-5xl">
              Reserve stock for the payment window.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-600">
              Products stay available until checkout begins. Once a shopper reserves a unit, Postgres row locks make sure the last item can only be claimed once.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          {[
            ['SKUs', totals.skus],
            ['Warehouses', totals.warehouses],
            ['Available', totals.available],
            ['Held or sold', totals.held],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold text-slate-950">{value}</div>
              <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-44 animate-pulse rounded-lg border border-slate-200 bg-white shadow-sm" />
          ))}
        </div>
      ) : (
        <section className="grid gap-5">
          {products.map((product) => {
            const totalAvailable = product.stock.reduce((sum, row) => sum + row.available, 0)
            const totalUnits = product.stock.reduce((sum, row) => sum + row.total, 0)
            const availablePct = totalUnits === 0 ? 0 : Math.round((totalAvailable / totalUnits) * 100)

            return (
              <article key={product.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="grid gap-5 border-b border-slate-200 bg-slate-50 px-5 py-5 md:grid-cols-[1fr_180px] md:items-center">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-950">{product.name}</h2>
                      <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-600">
                        {product.sku}
                      </span>
                    </div>
                    <p className="max-w-2xl text-sm leading-6 text-slate-600">{product.description}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                      <span>Available</span>
                      <span>{availablePct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-md bg-slate-200">
                      <div
                        className="h-full rounded-md bg-gradient-to-r from-cyan-500 via-emerald-500 to-lime-500"
                        style={{ width: `${availablePct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {product.stock.map((stock) => {
                    const isOutOfStock = stock.available === 0
                    const stockPct = stock.total === 0 ? 0 : Math.round((stock.available / stock.total) * 100)

                    return (
                      <div key={stock.inventoryId} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_180px_120px] md:items-center">
                        <div>
                          <div className="font-medium text-slate-950">{stock.warehouse}</div>
                          <div className="mt-1 text-sm text-slate-500">{stock.warehouseLocation}</div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${stockTone(stock.available)}`}>
                              {isOutOfStock ? 'Out of stock' : `${stock.available} available`}
                            </span>
                            <span className="text-slate-500">{stock.reserved}/{stock.total} held</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-md bg-slate-100">
                            <div
                              className="h-full rounded-md bg-slate-900"
                              style={{ width: `${stockPct}%` }}
                            />
                          </div>
                        </div>

                        <button
                          onClick={() => handleReserve(stock.inventoryId)}
                          disabled={isOutOfStock || reserving === stock.inventoryId}
                          className="h-11 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                        >
                          {reserving === stock.inventoryId ? 'Reserving...' : 'Reserve'}
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
