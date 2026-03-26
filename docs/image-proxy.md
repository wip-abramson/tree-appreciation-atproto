# Image Proxy: URLs Under Our Control

## Decision

All image URLs published by Tree Appreciation — in HTML pages, JSON API responses, and ActivityStreams documents — must be under the `treeappreciation.com` domain. We never hand out third-party CDN URLs directly.

## Why

Images are currently stored in users' AT Protocol repositories and served via Bluesky's CDN (`cdn.bsky.app`). This works, but creates a dependency we don't control:

- Bluesky could change their CDN structure, start charging, or shut down
- URLs we've published (especially via ActivityStreams to the fediverse) get cached by remote servers — if the upstream breaks, every cached reference breaks
- We have no way to verify that the CDN continues to serve the original image
- Linking directly to a third-party CDN is a form of vendor lock-in that's easy to avoid early and painful to fix later

This concern was raised by Bengo (ActivityPub community) and applies broadly: any URL you publish should be one you can redirect later.

## How It Works

**Published URL:** `/img/<cid>` (e.g., `https://treeappreciation.com/img/bafkrei...`)

**Resolution:**

1. Look up the CID in the `image` table to find the upstream URL
2. If not found, fall back to searching the `tree` and `inscription` tables (and backfill the `image` table)
3. Return a 302 redirect to the upstream CDN URL
4. Cache headers are set to `public, max-age=31536000, immutable` — CIDs are content-addressed, so they never change

**Image table:**

| Column | Description |
|---|---|
| `cid` | Content identifier (primary key) |
| `authorDid` | DID of the uploader (needed to construct upstream URL) |
| `upstreamUrl` | Current upstream CDN URL |
| `createdAt` | When the record was created |

The table is populated from three sources:
- Route handlers (when a tree or inscription is created via the web form)
- Firehose ingester (when records arrive from the network)
- The proxy route itself (backfills on first request for images that predate the table)

## Future: Serving Bytes Directly

The redirect approach means Bluesky still pays for bandwidth. When we're ready to fully decouple:

1. Fetch image bytes from the upstream URL
2. Verify the content hash matches the CID
3. Store locally (filesystem, S3, or similar)
4. Serve directly instead of redirecting

No published URLs change. The `/img/<cid>` route just stops redirecting and starts serving bytes. This is the key benefit of the indirection layer.

## Note on CIDs vs RFC 6920 (`ni:` URIs)

The identifiers we currently use (`bafkrei...`) are IPFS CIDv1 values — a SHA-256 hash wrapped in multicodec, multibase, and CID version framing. This is what AT Proto gives us. It works, but it's an IPFS-specific encoding of what is fundamentally just a content hash.

The IETF equivalent is RFC 6920 Named Information (`ni:`) URIs: `ni:///sha-256;{base64url(hash)}`. Same hash, standard encoding, no ambiguity about parameters. A CID can only be reproduced if you know the exact CID version, multicodec, and multibase — `ni:` URIs are deterministic from the bytes alone.

For now, the CID is opaque to us — we get it from AT Proto, store it, and use it as a key. We never compute CIDs ourselves. But if we later want to accept images from non-AT-Proto sources or independently verify content, `ni:` URIs would be simpler.

The proxy layer makes this a future decision, not a current one. Published URLs are `/img/{identifier}` — the route could accept both CIDs and `ni:` hashes without breaking anything already published.
