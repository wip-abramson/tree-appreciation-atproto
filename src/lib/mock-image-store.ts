import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { env } from '#/env'

/**
 * Disk-backed store for mock image blobs, used only when MOCK_WRITES is
 * enabled. Persisting to disk (rather than an in-memory Map) means uploaded
 * dev images survive server restarts — including the frequent `tsx watch`
 * reloads — so a persistent dev DB (DB_PATH) stays consistent with its images.
 *
 * Lives alongside the dev DB file (or ./data for an in-memory DB). Never
 * active in production, so nothing here touches prod or writes to atproto.
 */
function storeDir(): string {
  const base =
    env.DB_PATH && env.DB_PATH !== ':memory:'
      ? path.dirname(env.DB_PATH)
      : './data'
  return path.join(base, 'mock-images')
}

/** Generate a collision-resistant mock CID. */
export function newMockCid(): string {
  return `mock-${Date.now()}-${randomBytes(4).toString('hex')}`
}

export function saveMockImage(cid: string, data: Buffer): void {
  const dir = storeDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${cid}.jpg`), data)
}

export function readMockImage(cid: string): Buffer | null {
  // Guard against path traversal — mock CIDs are opaque, dot-free tokens.
  if (!/^mock-[A-Za-z0-9-]+$/.test(cid)) return null
  const file = path.join(storeDir(), `${cid}.jpg`)
  if (!existsSync(file)) return null
  return readFileSync(file)
}
