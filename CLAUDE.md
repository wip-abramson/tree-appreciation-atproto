# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is **Tree Appreciation** — a place-based memory application built on the AT Protocol. Users create persistent presences for specific trees and add inscriptions that accumulate over time like "memory rings." See `requirements.md` for the full product vision.

The app uses the `com.treeappreciation.*` namespace with two record types: `com.treeappreciation.tree` and `com.treeappreciation.inscription`.

## Commands

- `npm run dev` — Start dev server with hot reload (tsx watch + pino-pretty), serves at http://localhost:8080
- `npm run build` — Production build via tsup
- `npm start` — Run production build (`node dist/index.js`)
- `npm run lexgen` — Regenerate TypeScript types from lexicon JSON schemas in `lexicons/` into `src/lexicon/`
- `npm run clean` — Remove dist and coverage directories
- `./bin/gen-jwk` — Generate a JWK private key for production OAuth

## Architecture

### Boot Sequence (src/index.ts)

1. `createAppContext()` initializes all dependencies (DB, OAuth client, firehose ingester, logger, ID resolver) into an `AppContext` object
2. `createRouter(ctx)` sets up Express routes
3. HTTP server starts, then firehose subscription begins
4. Graceful shutdown on SIGINT/SIGTERM

### Key Layers

**Routes (src/routes.ts):** Express router with OAuth endpoints (`/login`, `/oauth/callback`, `/logout`), OAuth metadata endpoints, and app endpoints (`GET /` for tree listing, `GET /tree/:uri` for tree detail, `POST /tree` to create trees, `POST /inscription` to add inscriptions).

**Database (src/db.ts):** SQLite via better-sqlite3 with Kysely as a type-safe query builder. Tables: `tree` (indexed tree records), `inscription` (indexed inscription records with index on `tree` column), `auth_session`, `auth_state`. Migrations are inline. DB path configured via `DB_PATH` env var (`:memory:` for dev).

**AT Protocol OAuth (src/auth/):** `client.ts` creates `NodeOAuthClient` — loopback client in dev, confidential client in production (requires `PRIVATE_KEYS` and `PUBLIC_URL`). `storage.ts` implements `SessionStore` and `StateStore` backed by SQLite.

**Firehose Ingester (src/ingester.ts):** Subscribes to the AT Protocol relay firehose, filters for `com.treeappreciation.tree` and `com.treeappreciation.inscription` collections, validates records against lexicon schemas, and upserts/deletes from the local SQLite DB.

**Lexicons (lexicons/):** JSON schema files defining custom AT Protocol record types. Run `npm run lexgen` after modifying these to regenerate `src/lexicon/` (types, validators, schema definitions). Custom schemas: `com.treeappreciation.tree`, `com.treeappreciation.inscription`.

**Views (src/pages/):** Server-side rendered HTML using `uhtml` tagged template literals. `shell.ts` wraps pages in the HTML document structure. Pages: `home.ts` (tree listing + creation form), `tree-detail.ts` (tree info + inscriptions), `login.ts`.

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

Two streams to pick up:

### Stream 1: Image-centric inscriptions
Change inscriptions to be image-centric rather than text-centric. This includes updating the inscription lexicon to support image blobs (similar to how `com.treeappreciation.tree` already handles images), and experimenting with how inscriptions render on the tree detail page — exploring visual treatments for the "memory rings" display.

### Stream 2: GPS extraction feedback in the form
When a user uploads a photo in the "Seed Tree Presence" form, if GPS coordinates are extracted from the image EXIF data, show feedback in the form indicating that coordinates were found. Currently the extraction happens server-side on submit with no client-side indication. This could involve client-side JavaScript to read EXIF on file select and populate/indicate the lat/lng fields, or a two-step server interaction.

## Environment Setup

Copy `.env.template` to `.env`. For local dev, defaults work as-is. For production, you must set `PUBLIC_URL`, `COOKIE_SECRET` (use `openssl rand -base64 33`), and `PRIVATE_KEYS` (use `./bin/gen-jwk`).
