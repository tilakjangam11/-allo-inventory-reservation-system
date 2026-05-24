import { defineConfig } from 'prisma/config'
import { existsSync, readFileSync } from 'fs'

function loadEnvFile(path: string) {
  if (!existsSync(path)) return

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
    if (!match) continue

    const [, key, rawValue = ''] = match
    if (process.env[key]) continue

    process.env[key] = rawValue
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --experimental-strip-types prisma/seed.ts',
  },
})
