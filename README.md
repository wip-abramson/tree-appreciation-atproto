# Tree Appreciation

A place-based memory application built on the [AT Protocol](https://atproto.com). Users create persistent digital presences for specific trees and add inscriptions that accumulate over time like memory rings.

The project is not about trees in general. It is about *this tree*, here, over time.

## Why Trees?

Trees are ideal anchors for both memory and meaning-making rituals. They provide a point of continuity across generations, while visibly expressing the cyclical nature of time and the constancy of change through the seasons. Dormancy, renewal, growth, and transformation.

Trees are local. They are located in one place, almost always continuously throughout their lifetimes. Though, while rooted in place, they are far from alone. Through its roots, bark, and leafy canopy, the tree participates in layered ecologies that stretch from subterranean fungal networks to the migratory paths of birds. Trees are deeply connected and present in the locality they inhabit.

Trees are sacred. They have strong cultural resonance throughout history and across cultures. We are drawn to them instinctively. They provide food, shelter, cooling shade and quietly invite us to gather, rest and reflect.

Although lately, in our busy, hyperconnected world, how many of us have taken up this invitation? Or even noticed it was being offered?

## How It Works

**Tree Presences** — A steward encounters a tree worth noticing and seeds a presence for it: a photo, a name, and coordinates grounding it in place.

**Inscriptions** — Anyone can add an inscription to a tree. These accumulate as memory rings — moments of observation, reflection, or care tied to a specific tree across time.

**Stewardship** — There is no single owner. Multiple stewards contribute independently. Meaning emerges through accumulation, not curation.

All data is stored in users' AT Protocol repositories using the `com.treeappreciation.tree` and `com.treeappreciation.inscription` record types. The app indexes these from the network firehose and renders them as server-side HTML.

**Fediverse Echoes** — Trees are addressable across protocols. Each tree exposes an ActivityPub-compatible profile with an inbox, outbox, and followers collection. People on Mastodon and other fediverse platforms can send messages to a tree, and those arrive as "echoes" — traces of attention from beyond the AT Protocol network, displayed alongside inscriptions on the tree's page.

This isn't full ActivityPub federation. Trees don't follow back or push updates to followers' timelines. It's a one-way membrane: the fediverse can reach in, and what it leaves behind becomes part of the tree's living history.

## ActivityPub Endpoints

Each tree at `/tree/:slug` supports content negotiation. Request `application/activity+json` or `application/ld+json` to receive ActivityStreams JSON instead of HTML.

| Endpoint | Description |
|---|---|
| `GET /tree/:slug` | Tree as a Place actor (with `Accept: application/activity+json`) |
| `GET /tree/:slug/outbox` | Inscriptions as an OrderedCollection of Create activities |
| `GET /tree/:slug/outbox/:rkey` | Individual Create activity for an inscription |
| `GET /tree/:slug/inscription/:rkey` | Individual inscription as a Note |
| `POST /tree/:slug/inbox` | Receive ActivityPub activities (Follow, Create, Like, etc.) |
| `GET /tree/:slug/followers` | OrderedCollection of actors following the tree |

Outbound deliveries (e.g., Accept in response to Follow) are signed with HTTP Signatures (RSA-SHA256). An instance-level keypair is generated on first boot and published via `publicKey` on each tree's actor document.

CORS headers are set on all ActivityPub endpoints, so the data is accessible from browser-based mashups without a proxy.

## Design Principles

See [Design Principles](./DESIGN_PRINCIPLES.md) for some thoughts on presence-first design.


## Getting Started

```sh
git clone <repo-url>
cd tree-appreciation-atproto
cp .env.template .env
npm install
npm run dev
# Navigate to http://localhost:8080
```

The default `.env` works as-is for local development (in-memory SQLite, loopback OAuth).

## Deploying

Production requires three environment variables:

**1. Generate a private key for signing OAuth token requests:**

```sh
./bin/gen-jwk
```

Add the output to your `.env`:

```env
PRIVATE_KEYS='[{"kty":"EC","kid":"12",...}]'
```

> The `PRIVATE_KEYS` array can contain multiple keys. The first key signs new tokens. Removing a key invalidates its associated sessions.

**2. Set a cookie secret:**

```sh
openssl rand -base64 33
```

```env
COOKIE_SECRET="<generated-secret>"
```

**3. Set your public URL** so authorization servers can fetch the app's public keys:

```env
PUBLIC_URL="https://your-app-url.com"
```

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (port 8080) |
| `npm run build` | Production build via tsup |
| `npm start` | Run production build |
| `npm run lexgen` | Regenerate types from lexicon schemas |
| `npm run clean` | Remove dist and coverage |

## License

MIT
