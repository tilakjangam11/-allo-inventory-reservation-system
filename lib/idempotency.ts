import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

type StoredResponse = {
  statusCode: number
  body: unknown
}

type IdempotencyInput = {
  key: string | null
  scope: string
  payload: unknown
}

const MAX_WAIT_MS = 5000
const WAIT_STEP_MS = 100

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function requestHash(scope: string, payload: unknown) {
  return createHash('sha256')
    .update(stableStringify({ scope, payload }))
    .digest('hex')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isUniqueConstraint(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

async function waitForStoredResponse(
  key: string,
  scope: string,
  hash: string
): Promise<StoredResponse> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const record = await prisma.idempotencyRecord.findUnique({
      where: { key_scope: { key, scope } },
    })

    if (!record) {
      await sleep(WAIT_STEP_MS)
      continue
    }

    if (record.requestHash !== hash) {
      return {
        statusCode: 409,
        body: {
          error:
            'Idempotency-Key was already used for a different request payload',
        },
      }
    }

    if (record.statusCode !== null && record.responseBody !== null) {
      return {
        statusCode: record.statusCode,
        body: record.responseBody,
      }
    }

    await sleep(WAIT_STEP_MS)
  }

  return {
    statusCode: 409,
    body: {
      error:
        'A request with this Idempotency-Key is still being processed. Retry shortly.',
    },
  }
}

export async function runIdempotent(
  input: IdempotencyInput,
  operation: () => Promise<StoredResponse>
): Promise<StoredResponse> {
  if (!input.key) {
    const response = await operation()
    return { ...response, body: jsonSafe(response.body) }
  }

  const hash = requestHash(input.scope, input.payload)

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: input.key,
        scope: input.scope,
        requestHash: hash,
      },
    })
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return waitForStoredResponse(input.key, input.scope, hash)
    }
    throw error
  }

  const response = await operation()
  const safeBody = jsonSafe(response.body)

  await prisma.idempotencyRecord.update({
    where: { key_scope: { key: input.key, scope: input.scope } },
    data: {
      statusCode: response.statusCode,
      responseBody: safeBody as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  })

  return { statusCode: response.statusCode, body: safeBody }
}

export function getIdempotencyKey(req: Request) {
  const key = req.headers.get('idempotency-key')?.trim()
  return key || null
}
