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
  auth_session: AuthSession
  auth_state: AuthState
}

export type Tree = {
  uri: string
  authorDid: string
  name: string
  slug: string
  description: string | null
  imageCid: string | null
  latitude: string | null
  longitude: string | null
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

// APIs

export const createDb = (location: string): Database => {
  if (location !== ':memory:') {
    mkdirSync(dirname(location), { recursive: true })
  }
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>
