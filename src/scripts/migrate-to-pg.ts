import SqliteDb from 'better-sqlite3'
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely'
import { Pool } from 'pg'
import { env } from '#/env'
import { migrateToLatest, type DatabaseSchema } from '#/db'

/**
 * One-shot data migration from the production SQLite file into Fly Managed
 * Postgres, for the SQLite -> Postgres cutover.
 *
 * Usage:
 *   SQLITE_SRC=/data/prod.db DATABASE_URL=postgres://... npm run migrate-to-pg
 *
 * DATABASE_URL selects Postgres for `createDb`/`migrateToLatest`, so this script
 * first ensures the Postgres schema exists (the portable baseline), then bulk-
 * copies every app table from the SQLite source. Copies are idempotent
 * (ON CONFLICT DO NOTHING), so the script is safe to re-run.
 *
 * We copy *all* tables, not just the genuinely-local ones (ap_key, follower,
 * inbox_activity, auth_*). Trees/inscriptions/images are also rebuildable from
 * the network by backfill, but copying them here avoids an empty-grove window
 * at cutover and any dependence on backfill timing. The firehose/backfill later
 * reconcile them anyway.
 */

// Order matters only for readability; there are no cross-table FKs enforced.
const TABLES: (keyof DatabaseSchema)[] = [
  'tree',
  'inscription',
  'image',
  'ap_key',
  'follower',
  'inbox_activity',
  'auth_session',
  'auth_state',
]

async function main() {
  const srcPath = process.env.SQLITE_SRC ?? env.DB_PATH
  if (!srcPath || srcPath === ':memory:') {
    throw new Error(
      'Set SQLITE_SRC (or DB_PATH) to the SQLite file to copy from, e.g. /data/prod.db',
    )
  }
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to the destination Postgres URL')
  }

  const src = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: new SqliteDb(srcPath, { readonly: true }) }),
  })
  const destPool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  const dest = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool: destPool }) })

  // Ensure the Postgres schema exists (DATABASE_URL is set, so this runs the
  // portable pg baseline).
  await migrateToLatest(dest)
  console.log(`schema ready on Postgres; copying from ${srcPath}`)

  for (const table of TABLES) {
    const rows = await src.selectFrom(table).selectAll().execute()
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows (skip)`)
      continue
    }
    // Insert in chunks to keep parameter counts well under Postgres' limit.
    const chunkSize = 500
    let inserted = 0
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      const res = await dest
        .insertInto(table)
        .values(chunk as never)
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst()
      inserted += Number(res?.numInsertedOrUpdatedRows ?? 0n)
    }
    console.log(`  ${table}: ${rows.length} read, ${inserted} inserted (rest already present)`)
  }

  await src.destroy()
  await dest.destroy()
  console.log('migrate-to-pg complete')
}

main().catch((e) => {
  console.error('migrate-to-pg failed:', e)
  process.exit(1)
})
