/**
 * One-off cleanup for duplicate tree presences.
 *
 * A flaky submission could mint the same tree twice (e.g. a network retry that
 * resent the form). Since a tree's identity is its photo, two trees by the same
 * author with the same content-addressed image CID are duplicates. This script
 * finds those groups, keeps the earliest-created presence, re-points any
 * inscriptions / followers / fediverse activity onto the keeper, and durably
 * removes the duplicate by deleting the record from the author's PDS repo (not
 * just the local index — otherwise a backfill would resurrect it).
 *
 * Deleting the source record requires the author's stored OAuth session, so the
 * script must run against the same persistent DB the app uses (respects
 * DB_PATH). If a session can't be restored, it falls back to removing the local
 * row only and warns; the in-app dedup guard keeps it from reappearing.
 *
 * Usage: npm run dedupe-trees           (report + clean)
 *        npm run dedupe-trees -- --dry-run   (report only, no changes)
 */
import { Agent } from '@atproto/api'
import { sql } from 'kysely'
import pino from 'pino'

import { createDb, Database, migrateToLatest } from '#/db'
import { createOAuthClient } from '#/auth/client'
import { env } from '#/env'

const TREE_COLLECTION = 'com.treeappreciation.tree'

function rkeyFromUri(uri: string): string {
  return uri.split('/').pop()!
}

type TreeRow = {
  uri: string
  authorDid: string
  slug: string
  imageCid: string
  name: string | null
  createdAt: string
}

export async function dedupeTrees(
  db: Database,
  oauthClient: Awaited<ReturnType<typeof createOAuthClient>>,
  logger: pino.Logger,
  opts: { dryRun: boolean },
): Promise<{ groups: number; removed: number; sourceDeletes: number }> {
  // Pull every tree that carries an image CID; group by (author, CID) in JS.
  const rows = (await db
    .selectFrom('tree')
    .select(['uri', 'authorDid', 'slug', 'imageCid', 'name', 'createdAt'])
    .where('imageCid', 'is not', null)
    .execute()) as TreeRow[]

  const groups = new Map<string, TreeRow[]>()
  for (const row of rows) {
    const key = `${row.authorDid}\n${row.imageCid}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  let groupCount = 0
  let removed = 0
  let sourceDeletes = 0

  for (const list of groups.values()) {
    if (list.length < 2) continue
    groupCount++

    // Deterministic keeper: earliest createdAt, uri as tiebreak.
    list.sort((a, b) =>
      a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : a.uri < b.uri
            ? -1
            : 1,
    )
    const keep = list[0]
    const dups = list.slice(1)

    logger.info(
      {
        imageCid: keep.imageCid,
        keep: keep.uri,
        keepSlug: keep.slug,
        name: keep.name,
        duplicates: dups.map((d) => d.uri),
      },
      'duplicate tree group',
    )

    if (opts.dryRun) continue

    for (const dup of dups) {
      // 1. Re-point everything that references the duplicate onto the keeper.
      //    Inscriptions reference a tree by URI; followers and inbox activity
      //    reference it by slug.
      await db
        .updateTable('inscription')
        .set({ tree: keep.uri })
        .where('tree', '=', dup.uri)
        .execute()
      // OR IGNORE so an actor that followed both presences doesn't collide on
      // the (actorId, treeSlug) unique index; any leftover is dropped after.
      await sql`UPDATE OR IGNORE follower SET "treeSlug" = ${keep.slug} WHERE "treeSlug" = ${dup.slug}`.execute(
        db,
      )
      await db
        .deleteFrom('follower')
        .where('treeSlug', '=', dup.slug)
        .execute()
      await db
        .updateTable('inbox_activity')
        .set({ treeSlug: keep.slug })
        .where('treeSlug', '=', dup.slug)
        .execute()

      // 2. Durably delete the duplicate record from the author's PDS repo so a
      //    backfill can't bring it back.
      try {
        const oauthSession = await oauthClient.restore(dup.authorDid)
        if (oauthSession) {
          const agent = new Agent(oauthSession)
          await agent.com.atproto.repo.deleteRecord({
            repo: dup.authorDid,
            collection: TREE_COLLECTION,
            rkey: rkeyFromUri(dup.uri),
          })
          sourceDeletes++
          logger.info({ uri: dup.uri }, 'deleted duplicate record from PDS')
        } else {
          logger.warn(
            { uri: dup.uri, did: dup.authorDid },
            'no stored OAuth session for author; removed local row only ' +
              '(the in-app dedup guard prevents re-indexing)',
          )
        }
      } catch (err) {
        logger.warn(
          { uri: dup.uri, err },
          'could not delete duplicate record from PDS; removed local row only',
        )
      }

      // 3. Drop the duplicate's local index row.
      await db.deleteFrom('tree').where('uri', '=', dup.uri).execute()
      removed++
    }
  }

  logger.info(
    { groups: groupCount, removed, sourceDeletes },
    opts.dryRun ? 'dry run complete' : 'dedupe complete',
  )
  return { groups: groupCount, removed, sourceDeletes }
}

async function main() {
  const logger = pino({ name: 'dedupe-trees', level: env.LOG_LEVEL })
  const dryRun = process.argv.includes('--dry-run')

  if (env.DB_PATH === ':memory:') {
    logger.error(
      'DB_PATH is :memory: — nothing to clean. Point DB_PATH at the persistent database (e.g. ./data/dev.db).',
    )
    process.exit(1)
  }

  const db = createDb(env.DB_PATH)
  await migrateToLatest(db)
  const oauthClient = await createOAuthClient(db)

  try {
    await dedupeTrees(db, oauthClient, logger, { dryRun })
  } finally {
    await db.destroy()
  }
}

// Only run as a CLI when invoked directly (not when imported).
const invokedDirectly = /[\\/]dedupe-trees\.[jt]s$/.test(process.argv[1] ?? '')
if (invokedDirectly) {
  main().catch((err) => {
    pino({ name: 'dedupe-trees', level: env.LOG_LEVEL }).error(
      { err },
      'dedupe failed',
    )
    process.exit(1)
  })
}
