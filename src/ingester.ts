import type { Database } from '#/db'
import * as Tree from '#/lexicon/types/com/treeappreciation/tree'
import * as Inscription from '#/lexicon/types/com/treeappreciation/inscription'
import {
  indexTree,
  indexInscription,
  deleteTree,
  deleteInscription,
} from '#/indexing'
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
          await indexTree(db, evt.uri.toString(), evt.did, record)
        } else if (
          evt.collection === 'com.treeappreciation.inscription' &&
          Inscription.isRecord(record) &&
          Inscription.validateRecord(record).success
        ) {
          logger.debug(
            { uri: evt.uri.toString(), tree: record.tree },
            'ingesting inscription',
          )
          await indexInscription(db, evt.uri.toString(), evt.did, record)
        }
      } else if (evt.event === 'delete') {
        if (evt.collection === 'com.treeappreciation.tree') {
          logger.debug(
            { uri: evt.uri.toString(), did: evt.did },
            'deleting tree',
          )
          await deleteTree(db, evt.uri.toString())
        } else if (evt.collection === 'com.treeappreciation.inscription') {
          logger.debug(
            { uri: evt.uri.toString(), did: evt.did },
            'deleting inscription',
          )
          await deleteInscription(db, evt.uri.toString())
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
