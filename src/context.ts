import { NodeOAuthClient } from '@atproto/oauth-client-node'
import { Firehose } from '@atproto/sync'
import { pino } from 'pino'

import { createOAuthClient } from '#/auth/client'
import { createDb, Database, migrateToLatest } from '#/db'
import { createIngester } from '#/ingester'
import { env } from '#/env'
import {
  BidirectionalResolver,
  createBidirectionalResolver,
} from '#/id-resolver'
import { generateKeyPair, type KeyPair } from '#/lib/http-signatures'

/**
 * Application state passed to the router and elsewhere
 */
export type AppContext = {
  db: Database
  ingester: Firehose
  logger: pino.Logger
  oauthClient: NodeOAuthClient
  resolver: BidirectionalResolver
  apKey: KeyPair
  destroy: () => Promise<void>
}

/**
 * Load or generate the instance-level RSA keypair for ActivityPub HTTP Signatures.
 */
async function ensureApKey(db: Database, logger: pino.Logger): Promise<KeyPair> {
  const existing = await db
    .selectFrom('ap_key')
    .selectAll()
    .where('id', '=', 'instance')
    .executeTakeFirst()

  if (existing) {
    logger.info('loaded existing AP signing key')
    return {
      publicKeyPem: existing.publicKeyPem,
      privateKeyPem: existing.privateKeyPem,
    }
  }

  logger.info('generating new AP signing keypair')
  const keypair = generateKeyPair()
  await db
    .insertInto('ap_key')
    .values({
      id: 'instance',
      publicKeyPem: keypair.publicKeyPem,
      privateKeyPem: keypair.privateKeyPem,
      createdAt: new Date().toISOString(),
    })
    .execute()

  return keypair
}

export async function createAppContext(): Promise<AppContext> {
  const db = createDb(env.DB_PATH)
  await migrateToLatest(db)
  const oauthClient = await createOAuthClient(db)
  const ingester = createIngester(db)
  const logger = pino({ name: 'server', level: env.LOG_LEVEL })
  const resolver = createBidirectionalResolver(oauthClient)
  const apKey = await ensureApKey(db, logger)

  return {
    db,
    ingester,
    logger,
    oauthClient,
    resolver,
    apKey,

    async destroy() {
      await ingester.destroy()
      await db.destroy()
    },
  }
}
