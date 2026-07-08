import { once } from 'node:events'

import { createAppContext } from '#/context'
import { env } from '#/env'
import { startServer } from '#/lib/http'
import { run } from '#/lib/process'
import { createRouter } from '#/routes'
import { runBackfill } from '#/scripts/backfill'

/**
 * Seed historical records from the network when the index is empty (a fresh or
 * lost persistent volume), or when BACKFILL_ON_BOOT forces a re-sync. The
 * firehose only streams new events, so without this a fresh DB serves an empty
 * grove. Runs in the background so a slow/unavailable relay never blocks boot.
 */
async function maybeBackfillOnBoot(ctx: Awaited<ReturnType<typeof createAppContext>>) {
  const { count } = await ctx.db
    .selectFrom('tree')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()

  if (count > 0 && !env.BACKFILL_ON_BOOT) {
    ctx.logger.info({ trees: count }, 'index already populated, skipping backfill')
    return
  }

  ctx.logger.info(
    { trees: count, forced: env.BACKFILL_ON_BOOT },
    'backfilling index from network in background',
  )
  runBackfill(ctx.db, ctx.logger.child({ name: 'backfill' })).catch((err) => {
    ctx.logger.error({ err }, 'boot backfill failed')
  })
}

run(async (killSignal) => {
  // Create the application context
  const ctx = await createAppContext()

  // Create the HTTP router
  const router = createRouter(ctx)

  // Start the HTTP server
  const { terminate } = await startServer(router, { port: env.PORT })

  const url = env.PUBLIC_URL || `http://localhost:${env.PORT}`
  ctx.logger.info(`Server (${env.NODE_ENV}) running at ${url}`)

  // Subscribe to events on the firehose
  ctx.ingester.start()

  // Seed history if the index is empty (or forced) — non-blocking
  await maybeBackfillOnBoot(ctx)

  // Wait for a termination signal
  if (!killSignal.aborted) await once(killSignal, 'abort')
  ctx.logger.info(`Signal received, shutting down...`)

  // Gracefully shutdown the http server
  await terminate()

  // Gracefully shutdown the application context
  await ctx.destroy()
})
