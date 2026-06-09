import type { Database } from '#/db'
import * as Tree from '#/lexicon/types/com/treeappreciation/tree'
import * as Inscription from '#/lexicon/types/com/treeappreciation/inscription'
import { slugify, findUniqueSlug } from '#/lib/slug'
import { upstreamImageUrl } from '#/lib/util'

/**
 * Shared record-indexing logic used by both the firehose ingester (live
 * events) and the backfill script (historical records).
 */

function rkeyFromUri(uri: string): string {
  return uri.split('/').pop()!
}

async function registerImage(db: Database, did: string, imageCid: string) {
  await db
    .insertInto('image')
    .values({
      cid: imageCid,
      authorDid: did,
      upstreamUrl: upstreamImageUrl(did, imageCid),
      createdAt: new Date().toISOString(),
    })
    .onConflict((oc) => oc.doNothing())
    .execute()
}

export async function indexTree(
  db: Database,
  uri: string,
  did: string,
  record: Tree.Record,
) {
  const now = new Date()
  const imageCid = record.image?.ref?.toString() ?? null

  // Named (legacy) trees get name-based slugs; nameless trees use the rkey
  const baseSlug = record.name ? slugify(record.name) : rkeyFromUri(uri)
  const slug = await findUniqueSlug(db, baseSlug, uri)

  await db
    .insertInto('tree')
    .values({
      uri,
      authorDid: did,
      name: record.name ?? null,
      slug,
      place: record.place ?? null,
      description: record.description ?? null,
      imageCid,
      latitude: record.latitude ?? null,
      longitude: record.longitude ?? null,
      createdAt: record.createdAt,
      indexedAt: now.toISOString(),
    })
    .onConflict((oc) =>
      oc.column('uri').doUpdateSet({
        name: record.name ?? null,
        place: record.place ?? null,
        description: record.description ?? null,
        imageCid,
        latitude: record.latitude ?? null,
        longitude: record.longitude ?? null,
        indexedAt: now.toISOString(),
      }),
    )
    .execute()

  if (imageCid) {
    await registerImage(db, did, imageCid)
  }
}

export async function indexInscription(
  db: Database,
  uri: string,
  did: string,
  record: Inscription.Record,
) {
  const now = new Date()
  const imageCid = record.image?.ref?.toString() ?? null

  await db
    .insertInto('inscription')
    .values({
      uri,
      authorDid: did,
      tree: record.tree,
      text: record.text ?? null,
      imageCid,
      photoTakenAt: record.photoTakenAt ?? null,
      createdAt: record.createdAt,
      indexedAt: now.toISOString(),
    })
    .onConflict((oc) =>
      oc.column('uri').doUpdateSet({
        text: record.text ?? null,
        imageCid,
        photoTakenAt: record.photoTakenAt ?? null,
        indexedAt: now.toISOString(),
      }),
    )
    .execute()

  if (imageCid) {
    await registerImage(db, did, imageCid)
  }
}

export async function deleteTree(db: Database, uri: string) {
  await db.deleteFrom('tree').where('uri', '=', uri).execute()
}

export async function deleteInscription(db: Database, uri: string) {
  await db.deleteFrom('inscription').where('uri', '=', uri).execute()
}
