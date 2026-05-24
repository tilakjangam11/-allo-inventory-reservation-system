import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Allo Inventory',
  description: 'Concurrency-safe inventory reservation system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          {children}
        </main>
      </body>
    </html>
  )
}
