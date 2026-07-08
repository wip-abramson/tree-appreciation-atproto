import { once } from 'node:events'

import { pino } from 'pino'

import { createDb, migrateToLatest } from '#/db'
import { env } from '#/env'
import { createIngester } from '#/ingester'
import { run } from '#/lib/process'

/**
 * Standalone entrypoint for the AT Protocol firehose ingester.
 *
 * This runs as its own process, independent of the web server, so that the
 * CPU-heavy work of decoding the full network firehose never competes with the
 * HTTP event loop. Both processes share the same SQLite database file; WAL mode
 * and a busy timeout (configured in `createDb`) make concurrent access safe.
 *
 * Run with `npm run dev:ingester` (dev) or `npm run start:ingester` (prod).
 */
run(async (killSignal) => {
  const logger = pino({ name: 'ingester', level: env.LOG_LEVEL })

  const db = createDb(env.DB_PATH)
  await migrateToLatest(db)

  const ingester = createIngester(db)
  ingester.start()
  logger.info('firehose ingester process running')

  if (!killSignal.aborted) await once(killSignal, 'abort')
  logger.info('Signal received, shutting down ingester...')

  await ingester.destroy()
  await db.destroy()
})
