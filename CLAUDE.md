# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is **Tree Appreciation** — a place-based memory application built on the AT Protocol. Users create persistent presences for specific trees and add inscriptions that accumulate over time like "memory rings." See `requirements.md` for the full product vision and `DESIGN_PRINCIPLES.md` for the presence-first design ethos that governs UX decisions (no feeds, no engagement metrics, minimal friction, image-forward).

The app uses the `com.treeappreciation.*` namespace with two record types: `com.treeappreciation.tree` and `com.treeappreciation.inscription`. Trees have **no required name** — identity is the photo plus an optional reverse-geocoded `place` label; URLs use the record key as an opaque slug. Legacy named trees keep their names and name-based slugs.

## Commands

- `npm run dev` — Start dev server with hot reload (tsx watch + pino-pretty), serves at http://localhost:8080
- `npm run build` — Production build via tsup
- `npm start` — Run production build (`node dist/index.js`)
- `npm run lexgen` — Regenerate TypeScript types from lexicon JSON schemas in `lexicons/` into `src/lexicon/`
- `npm run backfill` — Index existing `com.treeappreciation.*` records from the live network (relay repo discovery + per-PDS `listRecords`). Use a persistent `DB_PATH`; the firehose only streams new events, so a fresh DB needs this to see the global data
- `npm run clean` — Remove dist and coverage directories
- `./bin/gen-jwk` — Generate a JWK private key for production OAuth

## Architecture

### Boot Sequence (src/index.ts)

1. `createAppContext()` initializes all dependencies (DB, OAuth client, firehose ingester, logger, ID resolver, AP signing keypair) into an `AppContext` object
2. `createRouter(ctx)` sets up Express routes
3. HTTP server starts, then firehose subscription begins
4. Graceful shutdown on SIGINT/SIGTERM

### Key Layers

**Routes (src/routes.tsx):** Express router with OAuth endpoints (`/login`, `/oauth/callback`, `/logout`), OAuth metadata endpoints, app endpoints (`GET /` for the grove, `GET /tree/:slug` for tree detail, `POST /tree` to seed trees, `POST /inscription` to add inscriptions), and ActivityPub endpoints (inbox, outbox, followers, individual activities). Content negotiation on `GET /` and `GET /tree/:slug` returns ActivityStreams JSON when `application/activity+json` or `application/ld+json` is requested. Seeding requires only a photo: location comes from EXIF or a map tap, the `place` label is reverse-geocoded server-side (src/lib/geocode.ts, Nominatim), and the rkey becomes the slug. Inscription counts and author handles are exposed only via the JSON API — the HTML grove deliberately carries no metrics or identity.

**Database (src/db.ts):** SQLite via better-sqlite3 with Kysely as a type-safe query builder. Tables: `tree` (name nullable, optional `place` label), `inscription` (with index on `tree` column), `inbox_activity` (received AP activities), `follower` (AP actors following trees), `ap_key` (instance RSA keypair), `image` (CID-to-upstream-URL mapping for image proxy), `auth_session`, `auth_state`. Migrations are inline. DB path configured via `DB_PATH` env var (`:memory:` for dev).

**ActivityPub / HTTP Signatures (src/lib/http-signatures.ts):** RSA-SHA256 signing and verification for ActivityPub server-to-server auth. Instance-level keypair generated on first boot and stored in `ap_key` table. Outbound deliveries (Accept activities) are signed. Inbound inbox requests are verified when a Signature header is present.

**AT Protocol OAuth (src/auth/):** `client.ts` creates `NodeOAuthClient` — loopback client in dev, confidential client in production (requires `PRIVATE_KEYS` and `PUBLIC_URL`). `storage.ts` implements `SessionStore` and `StateStore` backed by SQLite.

**Firehose Ingester (src/ingester.ts):** Subscribes to the AT Protocol relay firehose, filters for `com.treeappreciation.tree` and `com.treeappreciation.inscription` collections, validates records against lexicon schemas, and upserts/deletes via the shared indexing logic in `src/indexing.ts` (also used by `src/scripts/backfill.ts`, which discovers repos via `com.atproto.sync.listReposByCollection` on the relay and pages through each repo's records).

**Lexicons (lexicons/):** JSON schema files defining custom AT Protocol record types. Run `npm run lexgen` after modifying these to regenerate `src/lexicon/` (types, validators, schema definitions). Custom schemas: `com.treeappreciation.tree`, `com.treeappreciation.inscription`.

**Image Proxy (GET /img/:cid):** All image URLs are served through our domain. The route redirects to the upstream CDN (currently Bluesky) via 302. The `image` table maps CIDs to upstream URLs; backfills on first request if the CID predates the table. See `docs/image-proxy.md`.

**Views (src/pages/):** Server-side rendered HTML using JSX (React, `renderToString` — event-handler props are dropped, so client behavior lives in inline `<script>` strings). `shell.tsx` wraps pages in the HTML document structure. Pages: `home.tsx` (the "grove": shuffled photo grid with no counts/handles, an opt-in geolocation "find the trees around you" that sorts cards by distance and centers the map, a map of presences, and seeding demoted to a quiet footer line; login is a small corner link rendered by `shell.tsx` when logged out), `seed-tree.tsx` (photo-first seeding, no name/description fields), `tree-detail.tsx` (hero photo + a slow-crossfade **timelapse** of all photographic moments ordered by `photoTakenAt ?? createdAt`, text-only inscriptions as "words left here", inscription form after the encounter, fediverse echoes), `login.tsx`.

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
