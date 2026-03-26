# ActivityPub Design Decisions

## Actor type: Place

Trees are represented as `Place` objects in ActivityStreams, with `inbox`, `outbox`, `followers`, and `publicKey` properties. This is semantically correct — a tree is a place — but most ActivityPub implementations (Mastodon, GoToSocial) only recognize `Person`, `Service`, `Application`, `Organization`, and `Group` as followable actors.

For real federation with Mastodon, the type would need to change to `Service`. For now, `Place` is kept as the honest description. The inbox works for direct delivery; discoverability from Mastodon would require both the type change and a WebFinger endpoint.

## attributedTo uses DIDs, not Bluesky URLs

ActivityStreams `attributedTo` and `actor` fields use the raw DID (e.g., `did:plc:27737k2phovwfhzeii44bond`) rather than linking to `https://bsky.app/profile/...`. This avoids coupling the machine-readable protocol layer to a specific app.

DIDs are the durable, protocol-level identifier. If the AT Proto ecosystem evolves or the app moves to a different identity system, the published data remains valid. HTML pages still link to `bsky.app` for human convenience — those are just hrefs on pages we control and can change anytime.

## CORS: open for mashups

All ActivityPub endpoints and content-negotiated paths return `Access-Control-Allow-Origin: *`. This allows browser-based mashups (JSFiddle, custom web apps) to fetch tree data, outbox activities, and images directly.

This is safe because:
- The wildcard `*` prevents browsers from sending cookies, so authenticated sessions are not exposed
- All data exposed via CORS is already public (anyone can curl it)
- Write endpoints require session cookies to do anything, which CORS with `*` blocks by design

## Images proxied through our domain

All published image URLs use `/img/<cid>` paths on our domain, not third-party CDN URLs. See `docs/image-proxy.md` for the full rationale.

## Fediverse echoes: receive-only

The inbox accepts activities from the fediverse and displays them as "echoes" on the tree detail page. This is deliberately one-way — the fediverse can reach in, but trees don't push updates to followers' timelines. This matches the project's presence-first design: the tree is a place you visit, not an account that broadcasts.

## HTTP Signatures

Outbound deliveries are signed with RSA-SHA256 per draft-cavage-http-signatures. Inbound requests are verified when a Signature header is present; unsigned requests are currently allowed through (logged). A single instance-level keypair is shared across all trees.

For production federation with Mastodon, unsigned requests should be rejected and each tree may need its own keypair (Mastodon expects the keyId to resolve to the actor that sent the activity).

## What's not implemented

- **WebFinger** — trees are not discoverable by searching `@slug@treeappreciation.com`
- **Outbound delivery to followers** — new inscriptions are not pushed to followers' inboxes
- **Per-tree keypairs** — all trees share one instance key
- **Strict signature enforcement** — unsigned inbox requests are accepted
