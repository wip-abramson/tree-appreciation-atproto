import dotenv from 'dotenv'
import { bool, cleanEnv, port, str, testOnly, url } from 'envalid'
import { envalidJsonWebKeys as keys } from '#/lib/jwk'

dotenv.config()

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    devDefault: testOnly('test'),
    choices: ['development', 'production', 'test'],
  }),
  PORT: port({ devDefault: testOnly(3000) }),
  PUBLIC_URL: url({ default: undefined }),
  // Optional: only used on the SQLite path. Production sets DATABASE_URL
  // instead and never reads this, so it must not be required there.
  DB_PATH: str({ devDefault: ':memory:', default: ':memory:' }),
  // When set, the app uses Postgres (via this connection string) instead of the
  // SQLite file at DB_PATH. Production sets this to the Fly Managed Postgres URL
  // so multiple stateless machines share one HA database; dev/test leave it
  // empty and keep the fast in-memory SQLite path. See docs/postgres.md.
  DATABASE_URL: str({ default: '' }),
  COOKIE_SECRET: str({ devDefault: '00000000000000000000000000000000' }),
  PRIVATE_KEYS: keys({ default: undefined }),
  LOG_LEVEL: str({
    devDefault: 'debug',
    default: 'info',
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
  }),
  PDS_URL: url({ default: undefined }),
  PLC_URL: url({ default: undefined }),
  FIREHOSE_URL: url({ default: undefined }),
  MOCK_WRITES: bool({ devDefault: true, default: false }),
  // Force a network backfill on boot even when the index already has data.
  // By default the server only backfills when the index is empty.
  BACKFILL_ON_BOOT: bool({ default: false }),
  // When true, the web process also runs the firehose ingester in-process.
  // In production this should be false: run the ingester as its own process
  // (`npm run start:ingester`) so heavy firehose decoding never blocks the
  // HTTP event loop. Defaults to false everywhere for a smooth web tier.
  FIREHOSE_ENABLED: bool({ default: false }),
})
