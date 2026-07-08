import {
  Keyset,
  JoseKey,
  atprotoLoopbackClientMetadata,
  NodeOAuthClient,
  OAuthClientMetadataInput,
  RuntimeLock,
} from '@atproto/oauth-client-node'
import assert from 'node:assert'

import type { Database } from '#/db'
import { env } from '#/env'
import { SessionStore, StateStore } from './storage'

/**
 * An in-process, per-key mutex used to serialize OAuth token operations.
 *
 * atproto refresh tokens are single-use, so two concurrent requests that both
 * try to refresh the same session would race — one succeeds and the other's
 * refresh gets rejected, revoking the credentials and logging the user out.
 * Passing this explicitly also silences the "No lock mechanism provided"
 * warning. Note: this only coordinates within a single process. If you scale
 * the web tier to multiple instances, replace this with a shared lock (e.g.
 * backed by the database) so refreshes are serialized across instances too.
 */
function createInProcessLock(): RuntimeLock {
  const tails = new Map<string, Promise<unknown>>()
  return <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> => {
    const prev = tails.get(name) ?? Promise.resolve()
    const run = prev.then(fn, fn) as Promise<T>
    const tail = run.then(
      () => {},
      () => {},
    )
    tails.set(name, tail)
    tail.finally(() => {
      if (tails.get(name) === tail) tails.delete(name)
    })
    return run
  }
}

export async function createOAuthClient(db: Database) {
  // Confidential client require a keyset accessible on the internet. Non
  // internet clients (e.g. development) cannot expose a keyset on the internet
  // so they can't be private..
  const keyset =
    env.PUBLIC_URL && env.PRIVATE_KEYS
      ? new Keyset(
          await Promise.all(
            env.PRIVATE_KEYS.map((jwk) => JoseKey.fromJWK(jwk)),
          ),
        )
      : undefined

  assert(
    !env.PUBLIC_URL || keyset?.size,
    'ATProto requires backend clients to be confidential. Make sure to set the PRIVATE_KEYS environment variable.',
  )

  // If a keyset is defined (meaning the client is confidential). Let's make
  // sure it has a private key for signing. Note: findPrivateKey will throw if
  // the keyset does not contain a suitable private key.
  const pk = keyset?.findPrivateKey({ use: 'sig' })

  const clientMetadata: OAuthClientMetadataInput = env.PUBLIC_URL
    ? {
        client_name: 'Tree Appreciation',
        client_id: `${env.PUBLIC_URL}/oauth-client-metadata.json`,
        jwks_uri: `${env.PUBLIC_URL}/.well-known/jwks.json`,
        redirect_uris: [`${env.PUBLIC_URL}/oauth/callback`],
        scope: 'atproto transition:generic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: pk ? 'private_key_jwt' : 'none',
        token_endpoint_auth_signing_alg: pk ? pk.alg : undefined,
        dpop_bound_access_tokens: true,
      }
    : atprotoLoopbackClientMetadata(
        `http://localhost?${new URLSearchParams([
          ['redirect_uri', `http://127.0.0.1:${env.PORT}/oauth/callback`],
          ['scope', `atproto transition:generic`],
        ])}`,
      )

  return new NodeOAuthClient({
    keyset,
    clientMetadata,
    stateStore: new StateStore(db),
    sessionStore: new SessionStore(db),
    plcDirectoryUrl: env.PLC_URL,
    handleResolver: env.PDS_URL,
    requestLock: createInProcessLock(),
  })
}
