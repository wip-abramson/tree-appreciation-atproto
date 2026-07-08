import { OAuthClient } from '@atproto/oauth-client-node'

export interface BidirectionalResolver {
  resolveDidToHandle(did: string): Promise<string | undefined>
  resolveDidsToHandles(
    dids: string[],
  ): Promise<Record<string, string | undefined>>
}

// How long to trust a cached handle before re-resolving. Handles change rarely,
// so a generous TTL keeps page renders off the network. Negative results (no
// handle / resolution error) are cached briefly so a transient failure doesn't
// hammer the network on every request.
const POSITIVE_TTL_MS = 10 * 60 * 1000
const NEGATIVE_TTL_MS = 30 * 1000

type CacheEntry = { handle: string | undefined; expires: number }

export function createBidirectionalResolver({
  identityResolver,
}: OAuthClient): BidirectionalResolver {
  const cache = new Map<string, CacheEntry>()
  // De-duplicate concurrent in-flight lookups for the same DID.
  const inflight = new Map<string, Promise<string | undefined>>()

  async function resolveUncached(did: string): Promise<string | undefined> {
    try {
      const { handle } = await identityResolver.resolve(did)
      return handle || undefined
    } catch {
      return undefined
    }
  }

  const resolver: BidirectionalResolver = {
    async resolveDidToHandle(did: string): Promise<string | undefined> {
      const now = Date.now()
      const cached = cache.get(did)
      if (cached && cached.expires > now) return cached.handle

      const existing = inflight.get(did)
      if (existing) return existing

      const promise = resolveUncached(did)
        .then((handle) => {
          cache.set(did, {
            handle,
            expires:
              Date.now() + (handle ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
          })
          return handle
        })
        .finally(() => {
          inflight.delete(did)
        })

      inflight.set(did, promise)
      return promise
    },

    async resolveDidsToHandles(
      dids: string[],
    ): Promise<Record<string, string | undefined>> {
      const uniqueDids = [...new Set(dids)]

      return Object.fromEntries(
        await Promise.all(
          uniqueDids.map((did) =>
            resolver.resolveDidToHandle(did).then((handle) => [did, handle]),
          ),
        ),
      )
    },
  }

  return resolver
}
