/**
 * Backfill the local index from the live AT Protocol network.
 *
 * The firehose only streams new events, so a fresh database never sees
 * records created before it started listening. This script discovers every
 * repo holding com.treeappreciation.* records via the relay, fetches the
 * records from each owner's PDS, and indexes them with the same logic the
 * ingester uses.
 *
 * Usage: npm run backfill   (respects DB_PATH — use a persistent path)
 */
import { jsonToLex } from '@atproto/lexicon'
import { IdResolver, MemoryCache } from '@atproto/identity'
import pino from 'pino'

import { createDb, Database, migrateToLatest } from '#/db'
import { env } from '#/env'
import * as Tree from '#/lexicon/types/com/treeappreciation/tree'
import * as Inscription from '#/lexicon/types/com/treeappreciation/inscription'
import { indexTree, indexInscription } from '#/indexing'

const COLLECTIONS = [
  'com.treeappreciation.tree',
  'com.treeappreciation.inscription',
] as const

const RELAY_URL = env.FIREHOSE_URL
  ? env.FIREHOSE_URL.replace(/^ws/, 'http')
  : 'https://relay1.us-east.bsky.network'

async function listReposByCollection(collection: string): Promise<string[]> {
  const dids: string[] = []
  let cursor: string | undefined

  do {
    const params = new URLSearchParams({ collection, limit: '500' })
    if (cursor) params.set('cursor', cursor)
    const res = await fetch(
      `${RELAY_URL}/xrpc/com.atproto.sync.listReposByCollection?${params}`,
    )
    if (!res.ok) {
      throw new Error(
        `listReposByCollection failed: ${res.status} ${await res.text()}`,
      )
    }
    const data = (await res.json()) as {
      repos: { did: string }[]
      cursor?: string
    }
    dids.push(...data.repos.map((r) => r.did))
    cursor = data.cursor
  } while (cursor)

  return dids
}

async function listRecords(
  pds: string,
  did: string,
  collection: string,
): Promise<{ uri: string; value: unknown }[]> {
  const records: { uri: string; value: unknown }[] = []
  let cursor: string | undefined

  do {
    const params = new URLSearchParams({
      repo: did,
      collection,
      limit: '100',
    })
    if (cursor) params.set('cursor', cursor)
    const res = await fetch(
      `${pds}/xrpc/com.atproto.repo.listRecords?${params}`,
    )
    if (!res.ok) {
      throw new Error(`listRecords failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as {
      records: { uri: string; value: unknown }[]
      cursor?: string
    }
    records.push(...data.records)
    cursor = data.cursor
  } while (cursor)

  return records
}

/**
 * Discover every repo holding com.treeappreciation.* records via the relay,
 * fetch each owner's records from their PDS, and index them with the same
 * logic the firehose ingester uses. Idempotent — indexing upserts, so this is
 * safe to re-run (e.g. on boot when the index is empty).
 */
export async function runBackfill(
  db: Database,
  logger: pino.Logger,
): Promise<{ repos: number; trees: number; inscriptions: number }> {
  const idResolver = new IdResolver({
    plcUrl: env.PLC_URL,
    didCache: new MemoryCache(),
  })

  // Discover every repo that holds our records
  const dids = new Set<string>()
  for (const collection of COLLECTIONS) {
    const repos = await listReposByCollection(collection)
    repos.forEach((did) => dids.add(did))
    logger.info({ collection, repos: repos.length }, 'discovered repos')
  }

  let trees = 0
  let inscriptions = 0

  for (const did of dids) {
    let pds: string
    try {
      const atpData = await idResolver.did.resolveAtprotoData(did)
      pds = atpData.pds
    } catch (err) {
      logger.warn({ did, err }, 'could not resolve PDS; skipping repo')
      continue
    }

    for (const collection of COLLECTIONS) {
      let records: { uri: string; value: unknown }[]
      try {
        records = await listRecords(pds, did, collection)
      } catch (err) {
        logger.warn({ did, collection, err }, 'could not list records')
        continue
      }

      for (const { uri, value } of records) {
        // listRecords returns plain JSON; convert blob refs etc. to lex values
        const record = jsonToLex(value)

        if (
          collection === 'com.treeappreciation.tree' &&
          Tree.isRecord(record) &&
          Tree.validateRecord(record).success
        ) {
          await indexTree(db, uri, did, record)
          trees++
        } else if (
          collection === 'com.treeappreciation.inscription' &&
          Inscription.isRecord(record) &&
          Inscription.validateRecord(record).success
        ) {
          await indexInscription(db, uri, did, record)
          inscriptions++
        } else {
          logger.warn({ uri }, 'skipping invalid record')
        }
      }
    }
  }

  logger.info({ repos: dids.size, trees, inscriptions }, 'backfill complete')
  return { repos: dids.size, trees, inscriptions }
}

async function main() {
  const logger = pino({ name: 'backfill', level: env.LOG_LEVEL })
  const db = createDb(env.DB_PATH)
  await migrateToLatest(db)

  if (env.DB_PATH === ':memory:') {
    logger.warn(
      'DB_PATH is :memory: — the backfilled index will vanish when this process exits. Set DB_PATH to a file (e.g. ./data/dev.db) to keep it.',
    )
  }

  try {
    await runBackfill(db, logger)
  } finally {
    await db.destroy()
  }
}

// Only run as a CLI when invoked directly (not when imported by the server).
// Filename check works under both tsx (dev) and the CJS build (prod), where
// `import.meta.url` is unavailable.
const invokedDirectly = /[\\/]backfill\.[jt]s$/.test(process.argv[1] ?? '')
if (invokedDirectly) {
  main().catch((err) => {
    pino({ name: 'backfill', level: env.LOG_LEVEL }).error(
      { err },
      'backfill failed',
    )
    process.exit(1)
  })
}
