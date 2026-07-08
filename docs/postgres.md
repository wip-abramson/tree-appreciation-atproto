# Postgres migration & high availability

Tree Appreciation originally ran on a single Fly machine with SQLite on an
attached volume. Because a Fly volume attaches to exactly one machine, that
machine was a single point of failure: when Fly did host maintenance (a
"machine lease currently held by Fly.io system" event), the whole site went
down until the lease released.

This document describes the move to **Fly Managed Postgres (MPG)**, which makes
the app machines stateless so they can run redundantly.

## Why Postgres (not LiteFS / self-rebuilding standby)

The SQLite DB was two things at once:

- **Derived cache** — `tree`, `inscription`, `image` are rebuildable from the
  AT Protocol network by `npm run backfill` and the firehose.
- **Genuinely local state** — `ap_key` (the instance federation keypair),
  `follower` and `inbox_activity` (ActivityPub state, not on atproto), and
  `auth_session` / `auth_state` (OAuth sessions). None of this exists anywhere
  else.

That local state is why a "two independent SQLite caches" standby doesn't work:
the machines must agree on one source of truth or federation identity splits and
logins break. Postgres gives us one HA database that all machines share, which
is the simplest correct answer. (LiteFS would keep embedded SQLite but requires
write-forwarding on every write endpoint and pinning the ingester to the
primary — more app-level plumbing for this app's two-writer process model.)

## How the code chooses a database

`createDb` (`src/db.ts`) selects the dialect at runtime:

- `DATABASE_URL` set → **Postgres** (`pg` Pool + `PostgresDialect`).
- `DATABASE_URL` empty → **SQLite** at `DB_PATH` (dev/test default, in-memory).

The two dialects use different migration sets (`src/db.ts`):

- SQLite keeps its historical `001`–`010` migrations (they include table-rebuild
  steps that only make sense on SQLite).
- Postgres runs a single portable `001_baseline` that produces the *current*
  schema. **Keep it in sync with the final SQLite schema** whenever you add a
  column.

## Target topology

Postgres removes the reason web and the firehose ingester had to share a machine
(the SQLite volume — see the old `bin/start.sh`). So we split them with Fly
`[processes]`:

- **`web`** — `min_machines_running = 2`, spread across two regions. Stateless,
  HA, serves all HTTP. Runs with the firehose disabled.
- **`ingester`** — a single machine running the firehose consumer. Not
  user-facing, so brief downtime only delays indexing of *other* users' records
  (which backfill/catch-up reconcile), never the site's availability.

Proposed `fly.toml` (apply during cutover, step 6 — **not before**, or a deploy
would drop the volume while data still lives only in SQLite):

```toml
app = 'tree-appreciation'
primary_region = 'ams'

[build]

[env]
  NODE_ENV = 'production'
  PORT = '8080'
  # DATABASE_URL is set via `fly secrets`, not here.

[processes]
  web = "node dist/index.js"
  ingester = "node dist/ingester-runner.js"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 2
  processes = ["web"]

[[vm]]
  memory = '2gb'
  cpus = 2
  memory_mb = 2048
```

Note there is **no `[[mounts]]`** and no `DB_PATH` — the volume is gone.

## Cutover runbook

Provisioning MPG and deploying are billable, outward-facing actions. Run these
yourself (or confirm before Claude runs them).

1. **Provision Fly Managed Postgres**, then note the cluster ID and connection
   string:

   ```sh
   fly mpg create --name tree-appreciation-db --region ams \
     --plan Basic --pg-major-version 16
   # SAVE the connection string it prints (user, password, dbname) — you need it
   # for the local migration in step 4. You can't read it back from a secret.
   fly mpg list          # note the CLUSTER ID
   ```

2. **Attach** the cluster to the app (adds the `DATABASE_URL` secret, pointing at
   Fly's private network). This restarts the app on the *current* image, which
   is still the SQLite-only code — harmless, it ignores `DATABASE_URL`:

   ```sh
   fly mpg attach <cluster-id> -a tree-appreciation
   fly secrets list -a tree-appreciation      # confirm DATABASE_URL present
   ```

3. **Snapshot the live SQLite DB** to your machine:

   ```sh
   fly ssh sftp get /data/prod.db ./data/prod-snapshot.db -a tree-appreciation
   ```

4. **Open a local tunnel** to Postgres (separate terminal, leave running). The
   proxy defaults to local port **16380**:

   ```sh
   fly mpg proxy <cluster-id>                 # listens on 127.0.0.1:16380
   ```

5. **Run the data migration locally** (creates the pg schema, then bulk-copies
   every table — idempotent, safe to re-run). Build the URL from step 1's
   credentials but point host/port at the tunnel, and add `sslmode=disable`
   (the tunnel to localhost is plaintext; the traffic inside it is encrypted by
   Fly).

   `<user>`/`<pw>`/`<db>` are the cluster's generated credentials from the
   step-1 `create` output. If that scrolled away, read the attached string back
   from a running machine (secrets aren't listable, but env vars print):

   ```sh
   fly ssh console -a tree-appreciation -C "printenv DATABASE_URL"
   ```

   Copy its `user`, `pw`, and `db` verbatim; only swap the host/port for
   `localhost:16380` and change `sslmode=require` to `sslmode=disable`:

   ```sh
   export PG_LOCAL='postgres://<user>:<pw>@localhost:16380/<db>?sslmode=disable'
   SQLITE_SRC=./data/prod-snapshot.db DATABASE_URL="$PG_LOCAL" npm run migrate-to-pg
   ```

   Expect per-table row counts, ending `migrate-to-pg complete`.

6. **Sanity check** the copy. `fly mpg connect` needs a local `psql`; if you
   don't have one, query with the `pg` driver over the same tunnel/URL instead
   (no install needed):

   ```sh
   DATABASE_URL="$PG_LOCAL" node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});(async()=>{for(const t of ['ap_key','follower','tree','inscription','image']){const{rows}=await p.query('select count(*) as n from '+t);console.log(t.padEnd(12),rows[0].n)}await p.end()})().catch(e=>{console.error(e);process.exit(1)})"
   ```

   `ap_key` must be `1` (preserves federation identity). To install psql for
   interactive use instead: `brew install libpq && brew link --force libpq`.

7. **Apply the new `fly.toml`** (above) and deploy the Postgres-capable code.
   `fly deploy` builds from your local working directory, so the changes don't
   need to be pushed first (committing is still good hygiene):

   ```sh
   fly deploy -a tree-appreciation
   ```

   On boot the app now reads Postgres. `tree`/`inscription`/`image` are already
   populated from step 5, and the ingester + boot backfill reconcile from there.

8. **Scale to the HA topology**:

   ```sh
   fly scale count web=2 ingester=1 -a tree-appreciation
   fly machine clone <web-machine-id> --region cdg -a tree-appreciation   # 2nd region
   ```

9. **Verify** (see below), then **destroy the old volume** once you're happy:

   ```sh
   fly volumes list -a tree-appreciation
   fly volumes destroy <vol-id> -a tree-appreciation
   ```

## Verification

- `curl -sS -o /dev/null -w '%{http_code}\n' https://treeappreciation.com/` → 200
- Both web machines `started`: `fly machine list -a tree-appreciation`
- Grove renders trees (data copied); a test login + inscription works.
- **HA proof**: `fly machine stop <one-web-machine-id>` and confirm the site
  still serves 200 from the survivor. Start it back up afterwards.

## Gotchas (hit during the first cutover)

- **`DB_PATH` must be optional.** `src/env.ts` originally declared `DB_PATH`
  with only a `devDefault`, so envalid treated it as **required in production**.
  With the volume/`DB_PATH` removed from `fly.toml`, every machine crash-looped
  on boot with `Missing environment variables: DB_PATH`. Fixed by giving it a
  `default` too — it's unused when `DATABASE_URL` is set.

- **The ingester can inherit a stale `standby` role.** After the `[processes]`
  split, the ingester machine was reused from the old combined machine and
  carried a `standbys` config pointing at a now-deleted machine, so Fly kept it
  **stopped** (a standby only runs on host failure) and the firehose never ran.
  Detect with `fly status` (a `†` next to the process) or
  `fly machines list --json | grep standbys`. Clear it:

  ```sh
  fly machine update <ingester-id> --standby-for "" -a tree-appreciation --yes
  ```

  Confirm `standby_for` is `None` and the machine reports
  `firehose ingester process running`.

## Rollback

Until step 9, the SQLite volume is untouched. To roll back, revert `fly.toml`
(restore `[[mounts]]`, `DB_PATH`, `min_machines_running = 1`, drop
`[processes]`), unset the secret (`fly secrets unset DATABASE_URL`), and
redeploy. The app falls back to SQLite on the volume.
