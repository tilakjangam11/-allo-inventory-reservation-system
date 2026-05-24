// test-concurrency.ts
// ═══════════════════════════════════════════════════════
// Automated test for the concurrency race condition.
// Fires 20 simultaneous reservation requests for the 1-unit
// mechanical keyboard SKU. Proves the row lock works.
//
// Run with: npm run test:concurrency
// ═══════════════════════════════════════════════════════

async function testConcurrency() {
  console.log('Fetching products to find MKT-002 inventory ID...')
  const res = await fetch('http://localhost:3000/api/products')
  
  if (!res.ok) {
    console.error('Failed to fetch products. Is the dev server running?')
    process.exit(1)
  }
  
  const products = (await res.json()) as Array<{
    sku: string
    stock?: Array<{ inventoryId: string }>
  }>
  const kbd = products.find((p) => p.sku === 'MKT-002')
  
  if (!kbd || !kbd.stock || kbd.stock.length === 0) {
    console.error('MKT-002 not found. Did you run the seed script?')
    process.exit(1)
  }

  // The seed script puts 1 unit of MKT-002 in London
  const inventoryId = kbd.stock[0].inventoryId

  console.log(`Testing with inventoryId: ${inventoryId}`)
  console.log('Sending 20 simultaneous reservation requests for 1 unit...')

  // Fire 20 requests at the exact same time
  const requests = Array.from({ length: 20 }, () =>
    fetch('http://localhost:3000/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventoryId, quantity: 1 })
    }).then(r => r.status)
  )

  // Wait for all of them to resolve
  const statuses = await Promise.all(requests)
  
  const successes = statuses.filter(s => s === 201).length
  const conflicts = statuses.filter(s => s === 409).length

  console.log(`\nResults:`)
  console.log(`- ${successes} success (201)`)
  console.log(`- ${conflicts} conflict (409)`)

  if (successes === 1 && conflicts === 19) {
    console.log('\n✓ PASS — concurrency is correct. Exactly one reservation succeeded.')
  } else {
    console.log('\n✗ FAIL — overselling occurred or no successes.')
    process.exit(1)
  }
}

testConcurrency()
