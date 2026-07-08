import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import SqliteDb from 'better-sqlite3'
import {
  Kysely,
  Migrator,
  SqliteDialect,
  Migration,
  MigrationProvider,
  sql,
} from 'kysely'

// Types

export type DatabaseSchema = {
  tree: Tree
  inscription: Inscription
  inbox_activity: InboxActivity
  follower: Follower
  ap_key: ApKey
  image: Image
  auth_session: AuthSession
  auth_state: AuthState
}

export type Tree = {
  uri: string
  authorDid: string
  name: string | null
  slug: string
  place: string | null
  description: string | null
  imageCid: string | null
  latitude: string | null
  longitude: string | null
  photoTakenAt: string | null
  createdAt: string
  indexedAt: string
}

export type Inscription = {
  uri: string
  authorDid: string
  tree: string
  text: string | null
  imageCid: string | null
  photoTakenAt: string | null
  createdAt: string
  indexedAt: string
}

export type InboxActivity = {
  id: string
  treeSlug: string
  actorId: string | null
  type: string
  body: string
  receivedAt: string
}

export type Image = {
  cid: string
  authorDid: string
  upstreamUrl: string
  createdAt: string
}

export type ApKey = {
  id: string
  publicKeyPem: string
  privateKeyPem: string
  createdAt: string
}

export type Follower = {
  actorId: string
  treeSlug: string
  inbox: string
  followActivityId: string | null
  createdAt: string
}

export type AuthSession = {
  key: string
  session: AuthSessionJson
}

export type AuthState = {
  key: string
  state: AuthStateJson
}

type AuthStateJson = string

type AuthSessionJson = string

// Migrations

const migrations: Record<string, Migration> = {}

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('tree')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('description', 'varchar')
      .addColumn('imageCid', 'varchar')
      .addColumn('latitude', 'varchar', (col) => col.notNull())
      .addColumn('longitude', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('inscription')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('tree', 'varchar', (col) => col.notNull())
      .addColumn('text', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('inscription_tree_idx')
      .on('inscription')
      .column('tree')
      .execute()
    await db.schema
      .createTable('auth_session')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('session', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('auth_state')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('state', 'varchar', (col) => col.notNull())
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('auth_state').execute()
    await db.schema.dropTable('auth_session').execute()
    await db.schema.dropTable('inscription').execute()
    await db.schema.dropTable('tree').execute()
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('tree')
      .addColumn('slug', 'varchar', (col) => col.notNull().defaultTo(''))
      .execute()
    await db.schema
      .createIndex('tree_slug_idx')
      .on('tree')
      .column('slug')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('tree_slug_idx').execute()
    await db.schema.alterTable('tree').dropColumn('slug').execute()
  },
}

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    // SQLite requires table recreation to change NOT NULL constraints
    await db.schema
      .createTable('inscription_new')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('tree', 'varchar', (col) => col.notNull())
      .addColumn('text', 'varchar')
      .addColumn('imageCid', 'varchar')
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await sql`INSERT INTO inscription_new (uri, "authorDid", tree, text, "createdAt", "indexedAt") SELECT uri, "authorDid", tree, text, "createdAt", "indexedAt" FROM inscription`.execute(db)
    await db.schema.dropTable('inscription').execute()
    await sql`ALTER TABLE inscription_new RENAME TO inscription`.execute(db)
    await db.schema
      .createIndex('inscription_tree_idx')
      .on('inscription')
      .column('tree')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('inscription_tree_idx').execute()
    await db.schema
      .createTable('inscription_old')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('tree', 'varchar', (col) => col.notNull())
      .addColumn('text', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await sql`INSERT INTO inscription_old (uri, "authorDid", tree, text, "createdAt", "indexedAt") SELECT uri, "authorDid", tree, text, "createdAt", "indexedAt" FROM inscription`.execute(db)
    await db.schema.dropTable('inscription').execute()
    await sql`ALTER TABLE inscription_old RENAME TO inscription`.execute(db)
    await db.schema
      .createIndex('inscription_tree_idx')
      .on('inscription')
      .column('tree')
      .execute()
  },
}

migrations['004'] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable('inscription').addColumn('photoTakenAt', 'varchar').execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('inscription').dropColumn('photoTakenAt').execute()
  },
}

migrations['005'] = {
  async up(db: Kysely<unknown>) {
    // SQLite requires table recreation to remove NOT NULL constraints
    await db.schema
      .createTable('tree_new')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('slug', 'varchar', (col) => col.notNull().defaultTo(''))
      .addColumn('description', 'varchar')
      .addColumn('imageCid', 'varchar')
      .addColumn('latitude', 'varchar')
      .addColumn('longitude', 'varchar')
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await sql`INSERT INTO tree_new (uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt") SELECT uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt" FROM tree`.execute(db)
    await db.schema.dropTable('tree').execute()
    await sql`ALTER TABLE tree_new RENAME TO tree`.execute(db)
    await db.schema
      .createIndex('tree_slug_idx')
      .on('tree')
      .column('slug')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .createTable('tree_old')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('slug', 'varchar', (col) => col.notNull().defaultTo(''))
      .addColumn('description', 'varchar')
      .addColumn('imageCid', 'varchar')
      .addColumn('latitude', 'varchar', (col) => col.notNull())
      .addColumn('longitude', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await sql`INSERT INTO tree_old (uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt") SELECT uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt" FROM tree`.execute(db)
    await db.schema.dropTable('tree').execute()
    await sql`ALTER TABLE tree_old RENAME TO tree`.execute(db)
    await db.schema
      .createIndex('tree_slug_idx')
      .on('tree')
      .column('slug')
      .execute()
  },
}

migrations['006'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('inbox_activity')
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('treeSlug', 'varchar', (col) => col.notNull())
      .addColumn('actorId', 'varchar')
      .addColumn('type', 'varchar', (col) => col.notNull())
      .addColumn('body', 'text', (col) => col.notNull())
      .addColumn('receivedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('inbox_activity_tree_idx')
      .on('inbox_activity')
      .column('treeSlug')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('inbox_activity').execute()
  },
}

migrations['007a'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('ap_key')
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('publicKeyPem', 'text', (col) => col.notNull())
      .addColumn('privateKeyPem', 'text', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('ap_key').execute()
  },
}

migrations['007b'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('follower')
      .addColumn('actorId', 'varchar', (col) => col.notNull())
      .addColumn('treeSlug', 'varchar', (col) => col.notNull())
      .addColumn('inbox', 'varchar', (col) => col.notNull())
      .addColumn('followActivityId', 'varchar')
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createIndex('follower_pk')
      .on('follower')
      .columns(['actorId', 'treeSlug'])
      .unique()
      .execute()
    await db.schema
      .createIndex('follower_tree_idx')
      .on('follower')
      .column('treeSlug')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('follower').execute()
  },
}

migrations['008'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('image')
      .addColumn('cid', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('upstreamUrl', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('image').execute()
  },
}

migrations['009'] = {
  async up(db: Kysely<unknown>) {
    // SQLite requires table recreation to make name nullable; also adds place
    await db.schema
      .createTable('tree_new')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar')
      .addColumn('slug', 'varchar', (col) => col.notNull().defaultTo(''))
      .addColumn('place', 'varchar')
      .addColumn('description', 'varchar')
      .addColumn('imageCid', 'varchar')
      .addColumn('latitude', 'varchar')
      .addColumn('longitude', 'varchar')
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await sql`INSERT INTO tree_new (uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt") SELECT uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt" FROM tree`.execute(db)
    await db.schema.dropTable('tree').execute()
    await sql`ALTER TABLE tree_new RENAME TO tree`.execute(db)
    await db.schema
      .createIndex('tree_slug_idx')
      .on('tree')
      .column('slug')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema
      .createTable('tree_old')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('slug', 'varchar', (col) => col.notNull().defaultTo(''))
      .addColumn('description', 'varchar')
      .addColumn('imageCid', 'varchar')
      .addColumn('latitude', 'varchar')
      .addColumn('longitude', 'varchar')
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await sql`INSERT INTO tree_old (uri, "authorDid", name, slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt") SELECT uri, "authorDid", COALESCE(name, ''), slug, description, "imageCid", latitude, longitude, "createdAt", "indexedAt" FROM tree`.execute(db)
    await db.schema.dropTable('tree').execute()
    await sql`ALTER TABLE tree_old RENAME TO tree`.execute(db)
    await db.schema
      .createIndex('tree_slug_idx')
      .on('tree')
      .column('slug')
      .execute()
  },
}

migrations['010'] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable('tree').addColumn('photoTakenAt', 'varchar').execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable('tree').dropColumn('photoTakenAt').execute()
  },
}

// APIs

export const createDb = (location: string): Database => {
  if (location !== ':memory:') {
    mkdirSync(dirname(location), { recursive: true })
  }

  const sqlite = new SqliteDb(location)

  // Production-grade SQLite pragmas. These are essential for running the web
  // server and the firehose ingester as separate processes against the same
  // database file without hitting `SQLITE_BUSY` errors under load.
  if (location !== ':memory:') {
    // WAL lets many readers run concurrently with a single writer.
    sqlite.pragma('journal_mode = WAL')
  }
  // Wait up to 5s for a competing writer instead of throwing immediately.
  sqlite.pragma('busy_timeout = 5000')
  // NORMAL is the recommended durability/perf trade-off when using WAL.
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  // Cap the WAL size so it is checkpointed regularly under write bursts.
  sqlite.pragma('wal_autocheckpoint = 1000')

  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>
