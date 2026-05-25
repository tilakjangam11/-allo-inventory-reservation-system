import './globals.css'
import type { Metadata } from 'next'
import { ThemeProvider } from './theme-provider'

export const metadata: Metadata = {
  title: 'Allo Inventory — Checkout-Safe Reservations',
  description: 'Concurrency-safe inventory reservation system with real-time stock management, row-level locking, and automatic expiry cleanup.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>
          {/* Animated background orbs */}
          <div className="bg-orbs" aria-hidden="true">
            <div className="bg-orb-3" />
          </div>
          <div className="bg-noise" aria-hidden="true" />

          {/* App content */}
          <div style={{ position: 'relative', zIndex: 2 }}>
            <AppHeader />
            <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}

function AppHeader() {
  return (
    <header className="app-header">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--primary)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 5V11L8 15L2 11V5L8 1Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" fill="white"/>
            </svg>
          </div>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Allo
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* System badge */}
          <div
            className="hidden items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium sm:inline-flex"
            style={{
              background: 'var(--success-light)',
              color: 'var(--success)',
              border: '1px solid rgba(22, 163, 74, 0.15)',
            }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse-soft" style={{ background: 'var(--success)' }} />
            Auto-release active
          </div>

          {/* Theme toggle */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

function ThemeToggle() {
  return (
    <button
      className="theme-toggle"
      id="theme-toggle"
      aria-label="Toggle dark mode"
      suppressHydrationWarning
    >
      {/* Sun icon (shown in dark mode) */}
      <svg className="hidden dark:block" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="3"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
      </svg>
      {/* Moon icon (shown in light mode) */}
      <svg className="block dark:hidden" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M13.5 8.5a5.5 5.5 0 01-7-7A5.5 5.5 0 108 14a5.5 5.5 0 005.5-5.5z"/>
      </svg>
    </button>
  )
}
