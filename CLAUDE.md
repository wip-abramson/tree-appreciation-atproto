# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is **Tree Appreciation** — a place-based memory application built on the AT Protocol. Users create persistent presences for specific trees and add inscriptions that accumulate over time like "memory rings." See `requirements.md` for the full product vision and `DESIGN_PRINCIPLES.md` for the presence-first design ethos that governs UX decisions (no feeds, no engagement metrics, minimal friction, image-forward).

The app uses the `com.treeappreciation.*` namespace with two record types: `com.treeappreciation.tree` and `com.treeappreciation.inscription`. Trees have **no required name** — identity is the photo plus an optional reverse-geocoded `place` label; URLs use the record key as an opaque slug. Legacy named trees keep their names and name-based slugs.

### Design Context

`PRODUCT.md` (project root) is the strategic design brief used by the `/impeccable` frontend workflow. Register: **product** (design serves the practice, not a marketing surface). Core principles: presence before interaction, threshold not destination, memory arrives like a gift, commons over ownership, continuity over accumulation, minimal technological presence. Anti-references: social media, SaaS dashboards, gamified eco-apps, slick/trendy fashion. A11y bar: WCAG 2.1 AA (with outdoor, one-handed use in mind). A visual `DESIGN.md` can be generated later via `/impeccable document`.

## Commands

- `npm run dev` — Start dev server with hot reload (tsx watch + pino-pretty), serves at http://localhost:8080
- `npm run dev:ingester` — Start the firehose ingester as a separate process (dev)
- `npm run build` — Production build via tsup (builds both `index.js` and `ingester-runner.js`)
- `npm start` — Run production build (`node dist/index.js`)
- `npm run start:ingester` — Run the firehose ingester process (`node dist/ingester-runner.js`)
- `npm run lexgen` — Regenerate TypeScript types from lexicon JSON schemas in `lexicons/` into `src/lexicon/`
- `npm run backfill` — Index existing `com.treeappreciation.*` records from the live network (relay repo discovery + per-PDS `listRecords`). Use a persistent `DB_PATH`; the firehose only streams new events, so a fresh DB needs this to see the global data. The server also runs this automatically on boot **when the index is empty** (a fresh/lost persistent volume) — see Boot Sequence. The same logic compiles to `dist/scripts/backfill.js` for manual prod runs (`node dist/scripts/backfill.js`, e.g. via `fly ssh console`)
- `npm run dedupe-trees` — One-off cleanup for duplicate tree presences (same author + same image CID, e.g. from a double submission). Keeps the earliest, re-points inscriptions/followers/inbox onto it, and durably deletes the duplicate record from the author's PDS repo via their stored OAuth session. Respects `DB_PATH`; pass `-- --dry-run` to report without changing anything. Builds to `dist/scripts/dedupe-trees.js` for prod
- `npm run clean` — Remove dist and coverage directories
- `./bin/gen-jwk` — Generate a JWK private key for production OAuth

## Architecture

### Boot Sequence (src/index.ts)

1. `createAppContext()` initializes all dependencies (DB, OAuth client, firehose ingester, logger, ID resolver, AP signing keypair) into an `AppContext` object
2. `createRouter(ctx)` sets up Express routes
3. HTTP server starts, then firehose subscription begins
4. `maybeBackfillOnBoot()` runs: if the `tree` table is empty (or `BACKFILL_ON_BOOT=true`), it kicks off `runBackfill()` from `src/scripts/backfill.ts` in the background (non-blocking, so a slow/unavailable relay never blocks boot). This self-seeds history on a fresh persistent volume; populated volumes skip it and rely on the firehose. Indexing is idempotent (upserts), so re-runs are safe
5. Graceful shutdown on SIGINT/SIGTERM

### Key Layers

**Routes (src/routes.tsx):** Express router with OAuth endpoints (`/login`, `/oauth/callback`, `/logout`), OAuth metadata endpoints, app endpoints (`GET /` for the grove, `GET /tree/:slug` for tree detail, `POST /tree` to seed trees, `POST /inscription` to add inscriptions), and ActivityPub endpoints (inbox, outbox, followers, individual activities). Content negotiation on `GET /` and `GET /tree/:slug` returns ActivityStreams JSON when `application/activity+json` or `application/ld+json` is requested. Seeding requires only a photo: location comes from EXIF or a map tap, the `place` label is reverse-geocoded server-side (src/lib/geocode.ts, Nominatim), and the rkey becomes the slug. Inscription counts and author handles are exposed only via the JSON API — the HTML grove deliberately carries no metrics or identity.

**Database (src/db.ts):** Kysely as a type-safe query builder over one of two dialects, chosen at runtime by `createDb`: **Postgres** (`pg` Pool) when `DATABASE_URL` is set — production, so multiple stateless machines share one Fly Managed Postgres HA database — else **SQLite** via better-sqlite3 at `DB_PATH` (dev/test default, `:memory:`). Tables: `tree` (name nullable, optional `place` label), `inscription` (with index on `tree` column), `inbox_activity` (received AP activities), `follower` (AP actors following trees), `ap_key` (instance RSA keypair), `image` (CID-to-upstream-URL mapping for image proxy), `auth_session`, `auth_state`. Migrations are inline and dialect-specific: SQLite keeps its historical `001`–`010` (with SQLite-only table-rebuild steps); Postgres runs a single portable `001_baseline` that must be kept in sync with the current schema. See `docs/postgres.md` for the HA topology and the SQLite→Postgres cutover runbook (`npm run migrate-to-pg`).

**ActivityPub / HTTP Signatures (src/lib/http-signatures.ts):** RSA-SHA256 signing and verification for ActivityPub server-to-server auth. Instance-level keypair generated on first boot and stored in `ap_key` table. Outbound deliveries (Accept activities) are signed. Inbound inbox requests are verified when a Signature header is present.

**AT Protocol OAuth (src/auth/):** `client.ts` creates `NodeOAuthClient` — loopback client in dev, confidential client in production (requires `PRIVATE_KEYS` and `PUBLIC_URL`). `storage.ts` implements `SessionStore` and `StateStore` backed by SQLite.

**Firehose Ingester (src/ingester.ts):** Subscribes to the AT Protocol relay firehose, filters for `com.treeappreciation.tree` and `com.treeappreciation.inscription` collections, validates records against lexicon schemas, and upserts/deletes via the shared indexing logic in `src/indexing.ts` (also used by `src/scripts/backfill.ts`, which discovers repos via `com.atproto.sync.listReposByCollection` on the relay and pages through each repo's records). Decoding the full network firehose is CPU-heavy, so in production it runs as its **own process** (`src/ingester-runner.ts`, `npm run start:ingester`) rather than in the web process — this keeps the HTTP event loop responsive. The web process only runs it in-process when `FIREHOSE_ENABLED=true`. Both processes share the SQLite file safely via WAL mode + a busy timeout (configured in `src/db.ts`).

**Lexicons (lexicons/):** JSON schema files defining custom AT Protocol record types. Run `npm run lexgen` after modifying these to regenerate `src/lexicon/` (types, validators, schema definitions). Custom schemas: `com.treeappreciation.tree`, `com.treeappreciation.inscription`.

**Image Proxy (GET /img/:cid):** All image URLs are served through our domain. The route redirects to the upstream CDN (currently Bluesky) via 302. The `image` table maps CIDs to upstream URLs; backfills on first request if the CID predates the table. See `docs/image-proxy.md`.

**Views (src/pages/):** Server-side rendered HTML using JSX (React, `renderToString` — event-handler props are dropped, so client behavior lives in inline `<script>` strings). `shell.tsx` wraps pages in the HTML document structure. Pages: `home.tsx` (the "grove": shuffled photo grid with no counts/handles, an opt-in geolocation "find the trees near you" that sorts cards by distance (toggling back to the shuffled order), and seeding demoted to a quiet footer line; login is a small corner link rendered by `shell.tsx` when logged out), `seed-tree.tsx` (photo-first seeding, no name/description fields), `tree-detail.tsx` (hero photo + a slow-crossfade **timelapse** of all photographic moments ordered by `photoTakenAt ?? createdAt`, text-only inscriptions as "words left here", inscription form after the encounter, fediverse echoes), `login.tsx`.

**Identity Resolution (src/id-resolver.ts):** Resolves DIDs to human-readable handles using the OAuth client's identity resolver. Provides batch `resolveDidsToHandles()`.

### Data Flow: Writing a Record

1. User submits form → POST endpoint
2. `getSessionAgent()` restores OAuth session from cookie (iron-session)
3. Record validated against lexicon schema
4. Written to user's AT Protocol repo via `agent.com.atproto.repo.putRecord()`
5. Local DB updated optimistically
6. Firehose ingester eventually picks up the event (consistency backup)

### Path Alias

`#/*` maps to `src/*` (configured in tsconfig.json). Use `#/db` instead of relative paths like `../../db`.

## Current Work Streams

The June 2026 image-forward revamp landed: nameless photo-first seeding, opaque slugs, the grove homepage, and the timelapse rendering of memory rings. Candidate next steps, all to be judged against `DESIGN_PRINCIPLES.md`:

### Per-steward tree names
Will's instinct: "everyone should have their own names for trees." A steward could offer a personal name from the tree page; the tree would show them layered ("called Old Smoky by @wip"), with no name canonical. Needs a new record type or field.

### Resonance-based offering
Surface one inscription as a contextual offering (matching the current season or time of day) rather than always starting the timelapse at the oldest moment — principle 3.3, "memory arrives like a gift."

## Environment Setup

Copy `.env.template` to `.env`. For local dev, defaults work as-is (`MOCK_WRITES=true`, in-memory DB). To work with real network data locally: set `DB_PATH=./data/dev.db`, run `npm run backfill` to index existing records, and set `MOCK_WRITES=false` to make logins write real records to your PDS. For production, you must set `PUBLIC_URL`, `COOKIE_SECRET` (use `openssl rand -base64 33`), and `PRIVATE_KEYS` (use `./bin/gen-jwk`).
