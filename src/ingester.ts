import type { Database } from '#/db'
import * as Tree from '#/lexicon/types/com/treeappreciation/tree'
import * as Inscription from '#/lexicon/types/com/treeappreciation/inscription'
import { slugify, findUniqueSlug } from '#/lib/slug'
import { IdResolver, MemoryCache } from '@atproto/identity'
import { Event, Firehose } from '@atproto/sync'
import pino from 'pino'
import { env } from './env'

const HOUR = 60e3 * 60
const DAY = HOUR * 24

export function createIngester(db: Database) {
  const logger = pino({ name: 'firehose', level: env.LOG_LEVEL })
  return new Firehose({
    filterCollections: [
      'com.treeappreciation.tree',
      'com.treeappreciation.inscription',
    ],
    handleEvent: async (evt: Event) => {
      if (evt.event === 'create' || evt.event === 'update') {
        const now = new Date()
        const record = evt.record

        if (
          evt.collection === 'com.treeappreciation.tree' &&
          Tree.isRecord(record) &&
          Tree.validateRecord(record).success
        ) {
          logger.debug(
            { uri: evt.uri.toString(), name: record.name },
            'ingesting tree',
          )

          const imageCid = record.image?.ref?.toString() ?? null
          const baseSlug = slugify(record.name)
          const slug = await findUniqueSlug(db, baseSlug, evt.uri.toString())

          await db
            .insertInto('tree')
            .values({
              uri: evt.uri.toString(),
              authorDid: evt.did,
              name: record.name,
              slug,
              description: record.description ?? null,
              imageCid,
              latitude: record.latitude,
              longitude: record.longitude,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
            })
            .onConflict((oc) =>
              oc.column('uri').doUpdateSet({
                name: record.name,
                description: record.description ?? null,
                imageCid,
                latitude: record.latitude,
                longitude: record.longitude,
                indexedAt: now.toISOString(),
              }),
            )
            .execute()
        } else if (
          evt.collection === 'com.treeappreciation.inscription' &&
          Inscription.isRecord(record) &&
          Inscription.validateRecord(record).success
        ) {
          logger.debug(
            { uri: evt.uri.toString(), tree: record.tree },
            'ingesting inscription',
          )

          const imageCid = record.image?.ref?.toString() ?? null

          await db
            .insertInto('inscription')
            .values({
              uri: evt.uri.toString(),
              authorDid: evt.did,
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
        }
      } else if (evt.event === 'delete') {
        if (evt.collection === 'com.treeappreciation.tree') {
          logger.debug(
            { uri: evt.uri.toString(), did: evt.did },
            'deleting tree',
          )
          await db
            .deleteFrom('tree')
            .where('uri', '=', evt.uri.toString())
            .execute()
        } else if (evt.collection === 'com.treeappreciation.inscription') {
          logger.debug(
            { uri: evt.uri.toString(), did: evt.did },
            'deleting inscription',
          )
          await db
            .deleteFrom('inscription')
            .where('uri', '=', evt.uri.toString())
            .execute()
        }
      }
    },
    onError: (err: unknown) => {
      logger.error({ err }, 'error on firehose ingestion')
    },
    excludeIdentity: true,
    excludeAccount: true,
    service: env.FIREHOSE_URL,
    idResolver: new IdResolver({
      plcUrl: env.PLC_URL,
      didCache: new MemoryCache(HOUR, DAY),
    }),
  })
}
