import { Agent } from '@atproto/api'
import { TID } from '@atproto/common'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { parse as exifrParse } from 'exifr'
import express, { Request, Response } from 'express'
import { getIronSession } from 'iron-session'
import multer from 'multer'
import crypto from 'node:crypto'
import { signRequest, verifyRequest } from '#/lib/http-signatures'
import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http'
import path from 'node:path'
import sharp from 'sharp'

import type { AppContext } from '#/context'
import { env } from '#/env'
import * as Profile from '#/lexicon/types/app/bsky/actor/profile'
import * as Tree from '#/lexicon/types/com/treeappreciation/tree'
import * as Inscription from '#/lexicon/types/com/treeappreciation/inscription'
import { handler } from '#/lib/http'
import { reverseGeocodePlace } from '#/lib/geocode'
import { findUniqueSlug } from '#/lib/slug'
import { ifString, imageUrl, treeLabel, upstreamImageUrl } from '#/lib/util'
import { page } from '#/lib/view'
import { Home } from '#/pages/home'
import { SeedTree } from '#/pages/seed-tree'
import { TreeDetail } from '#/pages/tree-detail'
import { Login } from '#/pages/login'

const MAX_BLOB_SIZE = 1_000_000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

type JsonMode = false | 'json' | 'activity+json'

function wantsJson(req: Request): JsonMode {
  // Check for ActivityStreams / JSON-LD accept types first
  const accept = req.get('accept') ?? ''
  if (
    accept.includes('application/activity+json') ||
    accept.includes('application/ld+json')
  ) {
    return 'activity+json'
  }
  const negotiated = req.accepts(['html', 'json'])
  return negotiated === 'json' ? 'json' : false
}

function treeToJson(
  tree: import('#/db').Tree,
  handle: string | undefined,
  inscriptionCount?: number,
) {
  return {
    uri: tree.uri,
    name: tree.name,
    slug: tree.slug,
    place: tree.place,
    description: tree.description,
    authorDid: tree.authorDid,
    authorHandle: handle ?? null,
    imageUrl: tree.imageCid ? imageUrl(tree.authorDid, tree.imageCid) : null,
    latitude: tree.latitude,
    longitude: tree.longitude,
    inscriptionCount: inscriptionCount ?? undefined,
    createdAt: tree.createdAt,
    indexedAt: tree.indexedAt,
  }
}

function inscriptionToJson(
  inscription: import('#/db').Inscription,
  handle: string | undefined,
) {
  return {
    uri: inscription.uri,
    authorDid: inscription.authorDid,
    authorHandle: handle ?? null,
    text: inscription.text,
    imageUrl: inscription.imageCid
      ? imageUrl(inscription.authorDid, inscription.imageCid)
      : null,
    photoTakenAt: inscription.photoTakenAt,
    createdAt: inscription.createdAt,
  }
}

function treeToActivityStreams(
  tree: ReturnType<typeof treeToJson>,
  baseUrl: string,
  publicKeyPem?: string,
) {
  const treeUrl = `${baseUrl}/tree/${tree.slug}`
  const obj: Record<string, unknown> = {
    type: 'Place',
    id: treeUrl,
    url: treeUrl,
    name: treeLabel(tree) ?? 'a tree',
    published: tree.createdAt,
    inbox: `${treeUrl}/inbox`,
    outbox: `${treeUrl}/outbox`,
    followers: `${treeUrl}/followers`,
    attributedTo: tree.authorDid,
  }
  if (publicKeyPem) {
    obj.publicKey = {
      id: `${treeUrl}#main-key`,
      owner: treeUrl,
      publicKeyPem,
    }
  }
  if (tree.description) obj.summary = tree.description
  if (tree.imageUrl) {
    obj.image = {
      type: 'Image',
      url: tree.imageUrl.startsWith('/') ? `${baseUrl}${tree.imageUrl}` : tree.imageUrl,
      mediaType: 'image/jpeg',
    }
  }
  if (tree.latitude != null && tree.longitude != null) {
    obj.location = {
      type: 'Place',
      latitude: parseFloat(tree.latitude),
      longitude: parseFloat(tree.longitude),
    }
  }
  return obj
}

function rkeyFromUri(uri: string): string {
  return uri.split('/').pop()!
}

function inscriptionToActivityStreams(
  inscription: ReturnType<typeof inscriptionToJson>,
  tree: ReturnType<typeof treeToJson>,
  baseUrl: string,
) {
  const rkey = rkeyFromUri(inscription.uri)
  const treeUrl = `${baseUrl}/tree/${tree.slug}`
  const obj: Record<string, unknown> = {
    type: 'Note',
    id: `${treeUrl}/inscription/${rkey}`,
    url: `${treeUrl}/inscription/${rkey}`,
    published: inscription.createdAt,
    inReplyTo: treeUrl,
    attributedTo: inscription.authorDid,
  }
  if (inscription.text) obj.content = inscription.text
  if (inscription.imageUrl) {
    obj.image = {
      type: 'Image',
      url: inscription.imageUrl.startsWith('/') ? `${baseUrl}${inscription.imageUrl}` : inscription.imageUrl,
      mediaType: 'image/jpeg',
    }
  }
  return obj
}

export type Echo = {
  actorId: string
  actorName: string | null
  content: string | null
  imageUrl: string | null
  type: 'note' | 'like' | 'announce' | 'follow'
  receivedAt: string
}

function parseEcho(
  activity: Record<string, unknown>,
  receivedAt: string,
): Echo | null {
  const actorRaw = activity.actor
  const actorId =
    typeof actorRaw === 'string'
      ? actorRaw
      : typeof actorRaw === 'object' && actorRaw !== null && 'id' in actorRaw
        ? String((actorRaw as Record<string, unknown>).id)
        : null
  if (!actorId) return null

  const actorName =
    typeof actorRaw === 'object' && actorRaw !== null && 'name' in actorRaw
      ? String((actorRaw as Record<string, unknown>).name)
      : null

  const type = String(activity.type)

  if (type === 'Follow') {
    return { actorId, actorName, content: null, imageUrl: null, type: 'follow', receivedAt }
  }

  if (type === 'Like' || type === 'Announce') {
    return {
      actorId,
      actorName,
      content: null,
      imageUrl: null,
      type: type === 'Like' ? 'like' : 'announce',
      receivedAt,
    }
  }

  // Create with an inner object (Note, Article, etc.)
  if (type === 'Create' && typeof activity.object === 'object' && activity.object !== null) {
    const obj = activity.object as Record<string, unknown>
    const content = typeof obj.content === 'string' ? obj.content : null
    let imageUrl: string | null = null
    if (typeof obj.image === 'object' && obj.image !== null) {
      const img = obj.image as Record<string, unknown>
      if (typeof img.url === 'string') imageUrl = img.url
    }
    if (!content && !imageUrl) return null
    return { actorId, actorName, content, imageUrl, type: 'note', receivedAt }
  }

  // A bare Note/Article posted directly
  if ((type === 'Note' || type === 'Article') && typeof activity.content === 'string') {
    return {
      actorId,
      actorName,
      content: activity.content as string,
      imageUrl: null,
      type: 'note',
      receivedAt,
    }
  }

  return null
}

/**
 * Fetch a remote ActivityPub actor document and return their inbox URL.
 */
async function resolveActorInbox(actorId: string): Promise<string | null> {
  try {
    const res = await fetch(actorId, {
      headers: { Accept: 'application/activity+json, application/ld+json' },
    })
    if (!res.ok) return null
    const doc = (await res.json()) as Record<string, unknown>
    if (typeof doc.inbox === 'string') return doc.inbox
    return null
  } catch {
    return null
  }
}

/**
 * Deliver a signed activity to a remote inbox.
 * Returns true if the remote accepted it (2xx).
 */
async function deliverActivity(
  inboxUrl: string,
  activity: Record<string, unknown>,
  signing: { keyId: string; privateKeyPem: string },
): Promise<boolean> {
  try {
    const body = JSON.stringify(activity)
    const sigHeaders = signRequest({
      keyId: signing.keyId,
      privateKeyPem: signing.privateKeyPem,
      method: 'POST',
      url: inboxUrl,
      body,
    })

    const res = await fetch(inboxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        ...sigHeaders,
      },
      body,
    })
    return res.ok
  } catch {
    return false
  }
}

// In-memory store for mock image blobs (only used when MOCK_WRITES is enabled)
const mockImageStore = new Map<string, { data: Buffer; mime: string }>()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20_000_000 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true)
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'))
    }
  },
})

// Longest edge (px) we keep for stored images. Well above display needs while
// keeping blobs small and fast to encode.
const MAX_IMAGE_DIMENSION = 2048

/**
 * Normalize an uploaded image: apply EXIF orientation, strip all metadata,
 * downscale to a sane maximum dimension, and encode a single JPEG under the
 * AT Protocol blob size limit.
 *
 * Encodes in a single pass in the common case (metadata read is header-only);
 * only steps quality down if the first encode is still over the limit.
 */
async function processImage(
  buffer: Buffer,
): Promise<{ data: Buffer; mimetype: string }> {
  const meta = await sharp(buffer, { failOn: 'none' })
    .metadata()
    .catch(() => ({}) as sharp.Metadata)
  const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0)
  const targetWidth =
    longestEdge > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION : undefined

  const encode = (quality: number): Promise<Buffer> => {
    let pipeline = sharp(buffer, { failOn: 'none' })
      .rotate() // bake in EXIF orientation before metadata is stripped
      .flatten({ background: '#ffffff' }) // drop alpha so JPEG isn't black
    if (targetWidth) {
      pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true })
    }
    return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
  }

  let quality = 82
  let data = await encode(quality)
  // Bounded fallback: step quality down until under the blob limit.
  while (data.byteLength > MAX_BLOB_SIZE && quality > 40) {
    quality -= 15
    data = await encode(quality)
  }

  return { data, mimetype: 'image/jpeg' }
}

// Max age, in seconds, for static routes and assets
const MAX_AGE = env.NODE_ENV === 'production' ? 60 : 0

type Session = { did?: string }

// How long a login stays valid without any activity, in seconds. This is a
// *sliding* window: it is renewed on every authenticated request (see
// getSessionAgent), so an active user effectively stays logged in indefinitely
// and only a genuinely idle session eventually expires.
const SESSION_TTL = 60 * 60 * 24 * 30 // 30 days

// Shared iron-session options for the `sid` cookie. Centralized so every call
// site (read, callback, logout) uses identical settings — a mismatch here
// silently invalidates cookies and logs users out.
const sessionOptions = {
  cookieName: 'sid',
  password: env.COOKIE_SECRET,
  ttl: SESSION_TTL,
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    // Only require HTTPS in production. In dev (http://localhost) a `secure`
    // cookie would be dropped by the browser, logging you out immediately.
    secure: env.NODE_ENV === 'production',
    maxAge: SESSION_TTL,
  },
}

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
) {
  res.setHeader('Vary', 'Cookie')

  const session = await getIronSession<Session>(req, res, sessionOptions)
  if (!session.did) return null

  // This page is dynamic and should not be cached publicly
  res.setHeader('cache-control', `max-age=${MAX_AGE}, private`)

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    if (!oauthSession) return null
    // Sliding renewal: re-issue the cookie so the 30-day idle window resets on
    // every authenticated request. Active users never get unexpectedly logged
    // out. Best-effort — a failure here must not break the request.
    try {
      await session.save()
    } catch (err) {
      ctx.logger.debug({ err }, 'session sliding-save failed')
    }
    return new Agent(oauthSession)
  } catch (err) {
    // A restore failure is often transient (a token refresh that raced or a
    // brief PDS/network hiccup). Do NOT destroy the session here — doing so
    // logs the user out on every such blip. Treat this request as logged-out
    // and let the next request retry the restore. If the session is genuinely
    // revoked the user simply logs in again.
    ctx.logger.warn({ err }, 'oauth restore failed (treating request as logged-out)')
    return null
  }
}

type UserInfo = {
  did: string
  displayName?: string
  handle?: string
  avatarUrl?: string
}

function buildUserInfo(
  did: string,
  profile: Record<string, unknown>,
  handleMap: Record<string, string | undefined>,
): UserInfo {
  const handle = handleMap[did]
  const avatarCid =
    profile.avatar &&
    typeof profile.avatar === 'object' &&
    'ref' in (profile.avatar as Record<string, unknown>)
      ? String((profile.avatar as Record<string, unknown>).ref)
      : undefined
  return {
    did,
    displayName: typeof profile.displayName === 'string' ? profile.displayName : undefined,
    handle: handle || undefined,
    avatarUrl: avatarCid
      ? `https://cdn.bsky.app/img/avatar/plain/${did}/${avatarCid}@jpeg`
      : undefined,
  }
}

export const createRouter = (ctx: AppContext): RequestListener => {
  const router = express()

  // Static assets
  router.use(
    '/public',
    express.static(path.join(__dirname, 'pages', 'public'), {
      maxAge: MAX_AGE * 1000,
    }),
  )

  // CORS for ActivityPub/JSON endpoints and content-negotiated tree pages
  router.use((req, res, next) => {
    const isApPath =
      req.path.endsWith('/outbox') ||
      req.path.endsWith('/inbox') ||
      req.path.endsWith('/followers') ||
      req.path.startsWith('/img/')
    const isContentNegotiated =
      req.path === '/' || req.path.startsWith('/tree/')

    // For content-negotiated paths, allow CORS on OPTIONS (preflight won't
    // have the Accept header) and on requests that ask for AP/JSON content
    const wantsAp =
      req.get('accept')?.includes('application/activity+json') ||
      req.get('accept')?.includes('application/ld+json') ||
      req.get('accept')?.includes('application/json')

    if (isApPath || (isContentNegotiated && (req.method === 'OPTIONS' || wantsAp))) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')

      if (req.method === 'OPTIONS') {
        return res.status(204).end()
      }
    }

    next()
  })

  // Serve mock images (only active when MOCK_WRITES is enabled)
  if (env.MOCK_WRITES) {
    router.get(
      '/mock-image/:cid',
      handler((req, res) => {
        const entry = mockImageStore.get(req.params.cid)
        if (!entry) {
          return res.status(404).send('Not found')
        }
        res.setHeader('content-type', entry.mime)
        res.setHeader('cache-control', 'max-age=3600')
        res.send(entry.data)
      }),
    )
  }

  // Image proxy — redirect to upstream CDN via URLs we control
  router.get(
    '/img/:cid',
    handler(async (req, res) => {
      const cid = req.params.cid

      // Check the image table first
      const image = await ctx.db
        .selectFrom('image')
        .select('upstreamUrl')
        .where('cid', '=', cid)
        .executeTakeFirst()

      if (image) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        return res.redirect(302, image.upstreamUrl)
      }

      // Fall back to searching tree and inscription tables
      const tree = await ctx.db
        .selectFrom('tree')
        .select('authorDid')
        .where('imageCid', '=', cid)
        .executeTakeFirst()

      if (tree) {
        const upstream = upstreamImageUrl(tree.authorDid, cid)
        // Backfill the image table
        await ctx.db
          .insertInto('image')
          .values({ cid, authorDid: tree.authorDid, upstreamUrl: upstream, createdAt: new Date().toISOString() })
          .onConflict((oc) => oc.doNothing())
          .execute()
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        return res.redirect(302, upstream)
      }

      const inscription = await ctx.db
        .selectFrom('inscription')
        .select('authorDid')
        .where('imageCid', '=', cid)
        .executeTakeFirst()

      if (inscription) {
        const upstream = upstreamImageUrl(inscription.authorDid, cid)
        await ctx.db
          .insertInto('image')
          .values({ cid, authorDid: inscription.authorDid, upstreamUrl: upstream, createdAt: new Date().toISOString() })
          .onConflict((oc) => oc.doNothing())
          .execute()
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        return res.redirect(302, upstream)
      }

      return res.status(404).send('Image not found')
    }),
  )

  // OAuth metadata
  router.get(
    '/oauth-client-metadata.json',
    handler((req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)
      res.json(ctx.oauthClient.clientMetadata)
    }),
  )

  // Public keys
  router.get(
    '/.well-known/jwks.json',
    handler((req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)
      res.json(ctx.oauthClient.jwks)
    }),
  )

  // OAuth callback to complete session creation
  router.get(
    '/oauth/callback',
    handler(async (req, res) => {
      res.setHeader('cache-control', 'no-store')

      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      try {
        // Load the session cookie
        const session = await getIronSession<Session>(req, res, sessionOptions)

        // If the user is already signed in, destroy the old credentials
        if (session.did) {
          try {
            const oauthSession = await ctx.oauthClient.restore(session.did)
            if (oauthSession) oauthSession.signOut()
          } catch (err) {
            ctx.logger.warn({ err }, 'oauth restore failed')
          }
        }

        // Complete the OAuth flow
        const oauth = await ctx.oauthClient.callback(params)

        // Update the session cookie
        session.did = oauth.session.did

        await session.save()
      } catch (err) {
        // Surface the failure to the user instead of silently bouncing them
        // back to the homepage still logged out (which is indistinguishable
        // from "login didn't happen").
        ctx.logger.error({ err }, 'oauth callback failed')
        const message =
          err instanceof OAuthResolverError
            ? err.message
            : "We couldn't complete your login. Please try again."
        return res
          .status(400)
          .type('html')
          .send(page(<Login error={message} />))
      }

      return res.redirect('/')
    }),
  )

  // Login page
  router.get(
    '/login',
    handler(async (req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)
      res.type('html').send(page(<Login />))
    }),
  )

  // Login handler
  router.post(
    '/login',
    express.urlencoded(),
    handler(async (req, res) => {
      // Never store this route
      res.setHeader('cache-control', 'no-store')

      // Initiate the OAuth flow
      try {
        // Validate input: can be a handle, a DID or a service URL (PDS).
        const input = ifString(req.body.input)
        if (!input) {
          throw new Error('Invalid input')
        }

        // Initiate the OAuth flow
        const url = await ctx.oauthClient.authorize(input, {
          scope: 'atproto transition:generic',
        })

        res.redirect(url.toString())
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')

        const error = err instanceof Error ? err.message : 'unexpected error'

        return res.type('html').send(page(<Login error={error} />))
      }
    }),
  )

  // Signup
  router.get(
    '/signup',
    handler(async (req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)

      try {
        const service = env.PDS_URL ?? 'https://bsky.social'
        const url = await ctx.oauthClient.authorize(service, {
          scope: 'atproto transition:generic',
        })
        res.redirect(url.toString())
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')
        res.type('html').send(
          page(
            <Login
              error={
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login"
              }
            />,
          ),
        )
      }
    }),
  )

  // Logout handler
  router.post(
    '/logout',
    handler(async (req, res) => {
      // Never store this route
      res.setHeader('cache-control', 'no-store')

      const session = await getIronSession<Session>(req, res, sessionOptions)

      // Revoke credentials on the server
      if (session.did) {
        try {
          const oauthSession = await ctx.oauthClient.restore(session.did)
          if (oauthSession) await oauthSession.signOut()
        } catch (err) {
          ctx.logger.warn({ err }, 'Failed to revoke credentials')
        }
      }

      session.destroy()

      return res.redirect('/')
    }),
  )

  // Seed tree form page (requires auth)
  router.get(
    '/seed-tree',
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res.redirect('/login')
      }

      const profileResponse = await agent.com.atproto.repo
        .getRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.actor.profile',
          rkey: 'self',
        })
        .catch(() => undefined)

      const profileRecord = profileResponse?.data

      const profile =
        profileRecord &&
        Profile.isRecord(profileRecord.value) &&
        Profile.validateRecord(profileRecord.value).success
          ? profileRecord.value
          : {}

      const handleMap = await ctx.resolver.resolveDidsToHandles([agent.assertDid])
      const user = buildUserInfo(agent.assertDid, profile, handleMap)

      res.type('html').send(page(<SeedTree user={user} />))
    }),
  )

  // Homepage — list recent trees with inscription counts
  router.get(
    '/',
    handler(async (req, res) => {
      const jsonMode = wantsJson(req)

      // Parse pagination params (used for both HTML and JSON, but most useful for JSON)
      const limit = Math.min(
        Math.max(parseInt(req.query.limit as string) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      )
      const cursor = ifString(req.query.cursor as string)

      const agent = jsonMode ? null : await getSessionAgent(req, res, ctx)

      // Fetch trees with inscription counts
      let query = ctx.db
        .selectFrom('tree')
        .selectAll('tree')
        .orderBy('tree.indexedAt', 'desc')
        .limit(limit + 1) // fetch one extra to determine if there's a next page

      if (cursor) {
        query = query.where('tree.indexedAt', '<', cursor)
      }

      const rows = await query.execute()
      const hasMore = rows.length > limit
      const trees = hasMore ? rows.slice(0, limit) : rows

      if (jsonMode) {
        // Inscription counts and handles are only surfaced via the API;
        // the HTML grove deliberately carries no metrics or identity.
        const treeCounts: Record<string, number> = {}
        if (trees.length > 0) {
          const counts = await ctx.db
            .selectFrom('inscription')
            .select(['tree', ctx.db.fn.count('uri').as('count')])
            .where(
              'tree',
              'in',
              trees.map((t) => t.uri),
            )
            .groupBy('tree')
            .execute()
          for (const row of counts) {
            treeCounts[row.tree] = Number(row.count)
          }
        }

        const didHandleMap = await ctx.resolver.resolveDidsToHandles(
          trees.map((t) => t.authorDid),
        )

        res.setHeader('Vary', 'Accept')
        if (jsonMode === 'activity+json') {
          const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
          res.setHeader('Content-Type', 'application/activity+json; charset=utf-8')
          return res.json({
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollection',
            id: `${baseUrl}/`,
            totalItems: trees.length,
            orderedItems: trees.map((t) => {
              const tJson = treeToJson(t, didHandleMap[t.authorDid], treeCounts[t.uri] ?? 0)
              return treeToActivityStreams(tJson, baseUrl, ctx.apKey.publicKeyPem)
            }),
            ...(hasMore
              ? { next: `${baseUrl}/?cursor=${encodeURIComponent(trees[trees.length - 1].indexedAt)}` }
              : {}),
          })
        }
        return res.json({
          trees: trees.map((t) =>
            treeToJson(t, didHandleMap[t.authorDid], treeCounts[t.uri] ?? 0),
          ),
          cursor: hasMore ? trees[trees.length - 1].indexedAt : undefined,
        })
      }

      let user: UserInfo | undefined
      if (agent) {
        const profileResponse = await agent.com.atproto.repo
          .getRecord({
            repo: agent.assertDid,
            collection: 'app.bsky.actor.profile',
            rkey: 'self',
          })
          .catch(() => undefined)

        const profileRecord = profileResponse?.data
        const profile =
          profileRecord &&
          Profile.isRecord(profileRecord.value) &&
          Profile.validateRecord(profileRecord.value).success
            ? profileRecord.value
            : {}

        const handleMap = await ctx.resolver.resolveDidsToHandles([agent.assertDid])
        user = buildUserInfo(agent.assertDid, profile, handleMap)
      }

      // Gently shuffle — the grove has no "recent", no ranking
      const shuffled = [...trees]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }

      res.type('html').send(page(<Home trees={shuffled} user={user} />))
    }),
  )

  // Tree detail page
  router.get(
    '/tree/:slug',
    handler(async (req, res) => {
      const jsonMode = wantsJson(req)
      const agent = jsonMode ? null : await getSessionAgent(req, res, ctx)

      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) {
        if (jsonMode) {
          return res.status(404).json({ error: 'Tree not found' })
        }
        return res.status(404).type('html').send('<h1>Tree not found</h1>')
      }

      const inscriptions = await ctx.db
        .selectFrom('inscription')
        .selectAll()
        .where('tree', '=', tree.uri)
        .orderBy('createdAt', 'asc')
        .execute()

      // Resolve handles for tree author and inscription authors
      const allDids = [
        tree.authorDid,
        ...inscriptions.map((i) => i.authorDid),
      ]
      if (agent) allDids.push(agent.assertDid)
      const didHandleMap = await ctx.resolver.resolveDidsToHandles(allDids)

      if (jsonMode) {
        res.setHeader('Vary', 'Accept')
        if (jsonMode === 'activity+json') {
          const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
          const tJson = treeToJson(tree, didHandleMap[tree.authorDid])
          const asTree = treeToActivityStreams(tJson, baseUrl, ctx.apKey.publicKeyPem)
          res.setHeader('Content-Type', 'application/activity+json; charset=utf-8')
          return res.json({
            '@context': 'https://www.w3.org/ns/activitystreams',
            ...asTree,
            replies: {
              type: 'OrderedCollection',
              totalItems: inscriptions.length,
              orderedItems: inscriptions.map((i) => {
                const iJson = inscriptionToJson(i, didHandleMap[i.authorDid])
                return inscriptionToActivityStreams(iJson, tJson, baseUrl)
              }),
            },
          })
        }
        return res.json({
          tree: treeToJson(tree, didHandleMap[tree.authorDid]),
          inscriptions: inscriptions.map((i) =>
            inscriptionToJson(i, didHandleMap[i.authorDid]),
          ),
        })
      }

      // Fetch fediverse echoes (inbox activities worth displaying)
      const inboxActivities = await ctx.db
        .selectFrom('inbox_activity')
        .selectAll()
        .where('treeSlug', '=', tree.slug)
        .orderBy('receivedAt', 'asc')
        .execute()

      const echoes = inboxActivities
        .map((a) => {
          try {
            const parsed = JSON.parse(a.body)
            return parseEcho(parsed, a.receivedAt)
          } catch {
            return null
          }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null)

      let user: UserInfo | undefined
      if (agent) {
        const profileResponse = await agent.com.atproto.repo
          .getRecord({
            repo: agent.assertDid,
            collection: 'app.bsky.actor.profile',
            rkey: 'self',
          })
          .catch(() => undefined)

        const profileRecord = profileResponse?.data
        const profile =
          profileRecord &&
          Profile.isRecord(profileRecord.value) &&
          Profile.validateRecord(profileRecord.value).success
            ? profileRecord.value
            : {}

        user = buildUserInfo(agent.assertDid, profile, didHandleMap)
      }

      res.type('html').send(
        page(
          <TreeDetail
            tree={tree}
            inscriptions={inscriptions}
            didHandleMap={didHandleMap}
            currentDid={agent?.did ?? null}
            user={user}
            echoes={echoes}
          />,
        ),
      )
    }),
  )

  // ActivityPub inbox for a tree
  router.post(
    '/tree/:slug/inbox',
    express.json({ type: ['application/json', 'application/activity+json', 'application/ld+json'] }),
    handler(async (req, res) => {
      const tree = await ctx.db
        .selectFrom('tree')
        .select(['uri', 'slug'])
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) {
        return res.status(404).json({ error: 'Tree not found' })
      }

      const body = req.body
      if (!body || typeof body !== 'object' || !body.type) {
        return res.status(400).json({ error: 'Invalid activity' })
      }

      // Verify HTTP signature if present
      const rawBody = JSON.stringify(body)
      const sigHeader = req.get('signature')
      if (sigHeader) {
        const reqHeaders: Record<string, string> = {}
        for (const h of ['host', 'date', 'digest', 'signature', 'content-type']) {
          const v = req.get(h)
          if (v) reqHeaders[h] = v
        }
        const verification = await verifyRequest({
          method: req.method,
          path: req.originalUrl,
          headers: reqHeaders,
          body: rawBody,
        })
        if (!verification.verified) {
          ctx.logger.warn(
            { keyId: verification.keyId, error: verification.error },
            'inbox signature verification failed',
          )
          return res.status(401).json({ error: 'Signature verification failed' })
        }
        ctx.logger.info({ keyId: verification.keyId }, 'inbox signature verified')
      } else {
        ctx.logger.debug('inbox request has no Signature header (unsigned)')
      }

      const activityId =
        (typeof body.id === 'string' && body.id) ||
        `urn:uuid:${crypto.randomUUID()}`

      const actorId =
        typeof body.actor === 'string'
          ? body.actor
          : typeof body.actor?.id === 'string'
            ? body.actor.id
            : null

      // Store all incoming activities
      try {
        await ctx.db
          .insertInto('inbox_activity')
          .values({
            id: activityId,
            treeSlug: tree.slug,
            actorId,
            type: String(body.type),
            body: JSON.stringify(body),
            receivedAt: new Date().toISOString(),
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
      } catch (err) {
        ctx.logger.warn({ err }, 'failed to store inbox activity')
      }

      ctx.logger.info(
        { treeSlug: tree.slug, type: body.type, actor: actorId },
        'received inbox activity',
      )

      const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
      const treeUrl = `${baseUrl}/tree/${tree.slug}`

      // Handle Follow
      if (body.type === 'Follow' && actorId) {
        // Resolve the follower's inbox so we can deliver the Accept
        const followerInbox = await resolveActorInbox(actorId)

        if (followerInbox) {
          // Store the follower
          try {
            await ctx.db
              .insertInto('follower')
              .values({
                actorId,
                treeSlug: tree.slug,
                inbox: followerInbox,
                followActivityId: activityId,
                createdAt: new Date().toISOString(),
              })
              .onConflict((oc) =>
                oc.columns(['actorId', 'treeSlug']).doUpdateSet({
                  inbox: followerInbox,
                  followActivityId: activityId,
                }),
              )
              .execute()
          } catch (err) {
            ctx.logger.warn({ err, actorId }, 'failed to store follower')
          }

          // Send Accept back to the follower
          const accept = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'Accept',
            id: `${treeUrl}/accept/${crypto.randomUUID()}`,
            actor: treeUrl,
            object: body,
          }

          const delivered = await deliverActivity(followerInbox, accept, {
            keyId: `${treeUrl}#main-key`,
            privateKeyPem: ctx.apKey.privateKeyPem,
          })
          ctx.logger.info(
            { actorId, treeSlug: tree.slug, delivered },
            'processed Follow activity',
          )
        } else {
          ctx.logger.warn(
            { actorId },
            'could not resolve inbox for Follow actor',
          )
        }
      }

      // Handle Undo (for unfollowing)
      if (body.type === 'Undo' && actorId) {
        const inner = body.object
        const innerType =
          typeof inner === 'object' && inner !== null ? inner.type : null

        if (innerType === 'Follow') {
          try {
            await ctx.db
              .deleteFrom('follower')
              .where('actorId', '=', actorId)
              .where('treeSlug', '=', tree.slug)
              .execute()

            ctx.logger.info(
              { actorId, treeSlug: tree.slug },
              'processed Undo Follow',
            )
          } catch (err) {
            ctx.logger.warn({ err, actorId }, 'failed to remove follower')
          }
        }
      }

      return res.status(202).json({ status: 'accepted' })
    }),
  )

  // ActivityPub outbox for a tree (read-only, lists inscriptions as Create activities)
  router.get(
    '/tree/:slug/outbox',
    handler(async (req, res) => {
      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) {
        return res.status(404).json({ error: 'Tree not found' })
      }

      const inscriptions = await ctx.db
        .selectFrom('inscription')
        .selectAll()
        .where('tree', '=', tree.uri)
        .orderBy('createdAt', 'asc')
        .execute()

      const allDids = [tree.authorDid, ...inscriptions.map((i) => i.authorDid)]
      const didHandleMap = await ctx.resolver.resolveDidsToHandles(allDids)

      const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
      const tJson = treeToJson(tree, didHandleMap[tree.authorDid])

      res.setHeader('Content-Type', 'application/activity+json; charset=utf-8')
      return res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'OrderedCollection',
        id: `${baseUrl}/tree/${tree.slug}/outbox`,
        totalItems: inscriptions.length,
        orderedItems: inscriptions.map((i) => {
          const iJson = inscriptionToJson(i, didHandleMap[i.authorDid])
          const rkey = rkeyFromUri(i.uri)
          return {
            type: 'Create',
            id: `${baseUrl}/tree/${tree.slug}/outbox/${rkey}`,
            actor: iJson.authorDid,
            published: iJson.createdAt,
            object: inscriptionToActivityStreams(iJson, tJson, baseUrl),
          }
        }),
      })
    }),
  )

  // Individual inscription as ActivityStreams Note
  router.get(
    '/tree/:slug/inscription/:rkey',
    handler(async (req, res) => {
      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) return res.status(404).json({ error: 'Tree not found' })

      const uriSuffix = `com.treeappreciation.inscription/${req.params.rkey}`
      const inscription = await ctx.db
        .selectFrom('inscription')
        .selectAll()
        .where('tree', '=', tree.uri)
        .where('uri', 'like', `%${uriSuffix}`)
        .executeTakeFirst()

      if (!inscription) return res.status(404).json({ error: 'Inscription not found' })

      const didHandleMap = await ctx.resolver.resolveDidsToHandles([inscription.authorDid])
      const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
      const tJson = treeToJson(tree, didHandleMap[tree.authorDid])
      const iJson = inscriptionToJson(inscription, didHandleMap[inscription.authorDid])

      res.setHeader('Content-Type', 'application/activity+json; charset=utf-8')
      return res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        ...inscriptionToActivityStreams(iJson, tJson, baseUrl),
      })
    }),
  )

  // Individual outbox activity (Create wrapper for an inscription)
  router.get(
    '/tree/:slug/outbox/:rkey',
    handler(async (req, res) => {
      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) return res.status(404).json({ error: 'Tree not found' })

      const uriSuffix = `com.treeappreciation.inscription/${req.params.rkey}`
      const inscription = await ctx.db
        .selectFrom('inscription')
        .selectAll()
        .where('tree', '=', tree.uri)
        .where('uri', 'like', `%${uriSuffix}`)
        .executeTakeFirst()

      if (!inscription) return res.status(404).json({ error: 'Activity not found' })

      const didHandleMap = await ctx.resolver.resolveDidsToHandles([inscription.authorDid])
      const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
      const tJson = treeToJson(tree, didHandleMap[tree.authorDid])
      const iJson = inscriptionToJson(inscription, didHandleMap[inscription.authorDid])
      const rkey = rkeyFromUri(inscription.uri)

      res.setHeader('Content-Type', 'application/activity+json; charset=utf-8')
      return res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Create',
        id: `${baseUrl}/tree/${tree.slug}/outbox/${rkey}`,
        actor: iJson.authorDid,
        published: iJson.createdAt,
        object: inscriptionToActivityStreams(iJson, tJson, baseUrl),
      })
    }),
  )

  // ActivityPub followers collection for a tree
  router.get(
    '/tree/:slug/followers',
    handler(async (req, res) => {
      const tree = await ctx.db
        .selectFrom('tree')
        .select(['uri', 'slug'])
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) {
        return res.status(404).json({ error: 'Tree not found' })
      }

      const followers = await ctx.db
        .selectFrom('follower')
        .select(['actorId', 'createdAt'])
        .where('treeSlug', '=', tree.slug)
        .orderBy('createdAt', 'asc')
        .execute()

      const baseUrl = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`

      res.setHeader('Content-Type', 'application/activity+json; charset=utf-8')
      return res.json({
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'OrderedCollection',
        id: `${baseUrl}/tree/${tree.slug}/followers`,
        totalItems: followers.length,
        orderedItems: followers.map((f) => f.actorId),
      })
    }),
  )

  // Create a tree
  router.post(
    '/tree',
    upload.single('image'),
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }

      if (!req.file) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: A photo is required to seed a tree presence.</h1>')
      }

      // Extract EXIF GPS from uploaded image if present
      let exifLat: string | undefined
      let exifLng: string | undefined
      let exifDatetime: string | undefined
      let imageBlob: unknown | undefined
      let imageCid: string | null = null

      {
        // Extract GPS and datetime from EXIF before stripping
        try {
          const exif = await exifrParse(req.file.buffer)
          const lat = Number(exif?.latitude)
          const lng = Number(exif?.longitude)
          if (!isNaN(lat) && !isNaN(lng)) {
            exifLat = String(lat)
            exifLng = String(lng)
          }
          const raw = exif?.DateTimeOriginal
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            exifDatetime = raw.toISOString()
          }
        } catch (err) {
          ctx.logger.debug({ err }, 'no EXIF GPS/datetime data found')
        }

        // Strip EXIF and downscale if needed
        const cleaned = await processImage(req.file.buffer)

        if (env.MOCK_WRITES) {
          ctx.logger.info('MOCK_WRITES: skipping uploadBlob for tree image')
          imageCid = `mock-${Date.now()}`
          mockImageStore.set(imageCid, { data: cleaned.data, mime: cleaned.mimetype })
        } else {
          // Upload clean image to the user's repo
          const uploadRes = await agent.uploadBlob(cleaned.data, {
            encoding: cleaned.mimetype,
          })
          imageBlob = uploadRes.data.blob
          imageCid = uploadRes.data.blob.ref.toString()
        }
      }

      // Identity is the photo. uploadBlob is content-addressed, so a duplicate
      // submission (a flaky-network retry, a double tap) re-uploads the same
      // bytes and produces the same CID. If this steward already has a presence
      // for this exact image, return it instead of minting a second tree — you
      // can never seed the same photo twice. (The re-uploaded blob is harmless:
      // it dedupes to the same CID and, unreferenced, is GC'd by the PDS.)
      if (imageCid && !imageCid.startsWith('mock-')) {
        const existing = await ctx.db
          .selectFrom('tree')
          .select('slug')
          .where('authorDid', '=', agent.assertDid)
          .where('imageCid', '=', imageCid)
          .executeTakeFirst()
        if (existing) {
          ctx.logger.info(
            { did: agent.assertDid, imageCid, slug: existing.slug },
            'duplicate tree submission for an existing photo; redirecting to the existing presence',
          )
          return res.redirect(`/tree/${existing.slug}`)
        }
      }

      // Use form values, falling back to EXIF GPS (unless user opted to hide location)
      const hideLocation = req.body?.hideLocation === 'on'
      const formLat = req.body?.latitude ? String(req.body.latitude) : undefined
      const formLng = req.body?.longitude ? String(req.body.longitude) : undefined
      const latitude = hideLocation ? undefined : (
        (formLat && !isNaN(Number(formLat)) ? formLat : undefined) || exifLat
      )
      const longitude = hideLocation ? undefined : (
        (formLng && !isNaN(Number(formLng)) ? formLng : undefined) || exifLng
      )

      // Ground the tree in the physical world with a quiet place label
      let place: string | undefined
      if (latitude && longitude) {
        place = (await reverseGeocodePlace(latitude, longitude)) ?? undefined
      }

      // photoTakenAt: form value > EXIF value > omitted
      const formPhotoTakenAt = req.body?.photoTakenAt
        ? new Date(req.body.photoTakenAt).toISOString()
        : undefined
      const photoTakenAt = formPhotoTakenAt ?? exifDatetime

      const record: Record<string, unknown> = {
        $type: 'com.treeappreciation.tree',
        image: imageBlob,
        createdAt: new Date().toISOString(),
      }
      if (place) record.place = place
      if (latitude) record.latitude = latitude
      if (longitude) record.longitude = longitude
      if (photoTakenAt) record.photoTakenAt = photoTakenAt

      if (!env.MOCK_WRITES && !Tree.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid tree data</h1>')
      }

      // The rkey doubles as the public slug — opaque, no naming required
      const rkey = TID.nextStr()
      let uri
      if (env.MOCK_WRITES) {
        uri = `at://${agent.assertDid}/com.treeappreciation.tree/${rkey}`
        ctx.logger.info({ uri }, 'MOCK_WRITES: skipping putRecord for tree')
      } else {
        try {
          const result = await agent.com.atproto.repo.putRecord({
            repo: agent.assertDid,
            collection: 'com.treeappreciation.tree',
            rkey,
            record,
            validate: false,
          })
          uri = result.data.uri
        } catch (err) {
          ctx.logger.warn({ err }, 'failed to write tree record')
          return res
            .status(500)
            .type('html')
            .send('<h1>Error: Failed to write record</h1>')
        }
      }

      const slug = await findUniqueSlug(ctx.db, rkey)

      try {
        await ctx.db
          .insertInto('tree')
          .values({
            uri,
            authorDid: agent.assertDid,
            name: null,
            slug,
            place: place ?? null,
            description: null,
            imageCid,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            photoTakenAt: photoTakenAt ?? null,
            createdAt: record.createdAt as string,
            indexedAt: new Date().toISOString(),
          })
          .execute()

        // Register the image in the proxy table
        if (imageCid && !imageCid.startsWith('mock-')) {
          await ctx.db
            .insertInto('image')
            .values({
              cid: imageCid,
              authorDid: agent.assertDid,
              upstreamUrl: upstreamImageUrl(agent.assertDid, imageCid),
              createdAt: new Date().toISOString(),
            })
            .onConflict((oc) => oc.doNothing())
            .execute()
        }
      } catch (err) {
        ctx.logger.warn(
          { err },
          'failed to update computed view; ignoring as it should be caught by the firehose',
        )
      }

      return res.redirect(`/tree/${slug}`)
    }),
  )

  // Add an inscription to a tree
  router.post(
    '/inscription',
    upload.single('image'),
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }

      const treeUri = req.body?.tree
      if (!treeUri) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Tree reference required</h1>')
      }

      const text = req.body?.text?.trim() || undefined
      if (!req.file && !text) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: A photo or text is required.</h1>')
      }

      // Process image if provided
      let imageBlob: unknown | undefined
      let imageCid: string | null = null
      let exifDatetime: string | undefined

      if (req.file) {
        // Extract datetime from EXIF before stripping
        try {
          const exif = await exifrParse(req.file.buffer)
          const raw = exif?.DateTimeOriginal
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            exifDatetime = raw.toISOString()
          }
        } catch (err) {
          ctx.logger.debug({ err }, 'no EXIF datetime found')
        }

        const cleaned = await processImage(req.file.buffer)

        if (env.MOCK_WRITES) {
          ctx.logger.info('MOCK_WRITES: skipping uploadBlob for inscription image')
          imageCid = `mock-${Date.now()}`
          mockImageStore.set(imageCid, { data: cleaned.data, mime: cleaned.mimetype })
        } else {
          const uploadRes = await agent.uploadBlob(cleaned.data, {
            encoding: cleaned.mimetype,
          })
          imageBlob = uploadRes.data.blob
          imageCid = uploadRes.data.blob.ref.toString()
        }
      }

      // photoTakenAt: form value > EXIF value > omitted
      const formPhotoTakenAt = req.body?.photoTakenAt
        ? new Date(req.body.photoTakenAt).toISOString()
        : undefined
      const photoTakenAt = formPhotoTakenAt ?? exifDatetime

      const record: Record<string, unknown> = {
        $type: 'com.treeappreciation.inscription',
        tree: treeUri,
        createdAt: new Date().toISOString(),
      }
      if (text) record.text = text
      if (imageBlob) record.image = imageBlob
      if (photoTakenAt) record.photoTakenAt = photoTakenAt

      if (!env.MOCK_WRITES && !Inscription.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid inscription data</h1>')
      }

      let uri
      if (env.MOCK_WRITES) {
        const rkey = TID.nextStr()
        uri = `at://${agent.assertDid}/com.treeappreciation.inscription/${rkey}`
        ctx.logger.info({ uri }, 'MOCK_WRITES: skipping putRecord for inscription')
      } else {
        try {
          const result = await agent.com.atproto.repo.putRecord({
            repo: agent.assertDid,
            collection: 'com.treeappreciation.inscription',
            rkey: TID.nextStr(),
            record,
            validate: false,
          })
          uri = result.data.uri
        } catch (err) {
          ctx.logger.warn({ err }, 'failed to write inscription record')
          return res
            .status(500)
            .type('html')
            .send('<h1>Error: Failed to write record</h1>')
        }
      }

      try {
        await ctx.db
          .insertInto('inscription')
          .values({
            uri,
            authorDid: agent.assertDid,
            tree: treeUri,
            text: text ?? null,
            imageCid,
            photoTakenAt: photoTakenAt ?? null,
            createdAt: record.createdAt as string,
            indexedAt: new Date().toISOString(),
          })
          .execute()

        // Register the image in the proxy table
        if (imageCid && !imageCid.startsWith('mock-')) {
          await ctx.db
            .insertInto('image')
            .values({
              cid: imageCid,
              authorDid: agent.assertDid,
              upstreamUrl: upstreamImageUrl(agent.assertDid, imageCid),
              createdAt: new Date().toISOString(),
            })
            .onConflict((oc) => oc.doNothing())
            .execute()
        }
      } catch (err) {
        ctx.logger.warn(
          { err },
          'failed to update computed view; ignoring as it should be caught by the firehose',
        )
      }

      const treeRow = await ctx.db
        .selectFrom('tree')
        .select('slug')
        .where('uri', '=', treeUri)
        .executeTakeFirst()

      return res.redirect(`/tree/${treeRow?.slug ?? encodeURIComponent(treeUri)}`)
    }),
  )

  // Delete an inscription
  router.post(
    '/inscription/:rkey/delete',
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }

      const rkey = req.params.rkey
      const uri = `at://${agent.assertDid}/com.treeappreciation.inscription/${rkey}`

      const inscription = await ctx.db
        .selectFrom('inscription')
        .selectAll()
        .where('uri', '=', uri)
        .executeTakeFirst()

      if (!inscription) {
        return res
          .status(404)
          .type('html')
          .send('<h1>Inscription not found</h1>')
      }

      if (inscription.authorDid !== agent.assertDid) {
        return res
          .status(403)
          .type('html')
          .send('<h1>Error: You can only delete your own inscriptions</h1>')
      }

      if (env.MOCK_WRITES) {
        ctx.logger.info({ uri }, 'MOCK_WRITES: skipping deleteRecord for inscription')
      } else {
        try {
          await agent.com.atproto.repo.deleteRecord({
            repo: agent.assertDid,
            collection: 'com.treeappreciation.inscription',
            rkey,
          })
        } catch (err) {
          ctx.logger.warn({ err }, 'failed to delete inscription record from PDS')
          return res
            .status(500)
            .type('html')
            .send('<h1>Error: Failed to delete record</h1>')
        }
      }

      // Delete from local DB
      try {
        await ctx.db
          .deleteFrom('inscription')
          .where('uri', '=', uri)
          .execute()
      } catch (err) {
        ctx.logger.warn({ err }, 'failed to delete inscription from local DB')
      }

      // Redirect back to the tree detail page
      const treeRow = await ctx.db
        .selectFrom('tree')
        .select('slug')
        .where('uri', '=', inscription.tree)
        .executeTakeFirst()

      return res.redirect(`/tree/${treeRow?.slug ?? '/'}`)
    }),
  )

  return router
}
