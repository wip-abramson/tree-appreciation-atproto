import { Agent } from '@atproto/api'
import { TID } from '@atproto/common'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { gps as exifrGps, parse as exifrParse } from 'exifr'
import express, { Request, Response } from 'express'
import { getIronSession } from 'iron-session'
import multer from 'multer'
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
import { slugify, findUniqueSlug } from '#/lib/slug'
import { ifString, imageUrl } from '#/lib/util'
import { page } from '#/lib/view'
import { Home } from '#/pages/home'
import { SeedTree } from '#/pages/seed-tree'
import { TreeDetail } from '#/pages/tree-detail'
import { Login } from '#/pages/login'

const MAX_BLOB_SIZE = 1_000_000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function wantsJson(req: Request): boolean {
  const accept = req.accepts(['html', 'json'])
  return accept === 'json'
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

async function processImage(
  buffer: Buffer,
  mimetype: string,
): Promise<Buffer> {
  // Apply EXIF orientation and strip all metadata
  let pipeline = sharp(buffer).rotate()

  // Downscale if the cleaned image would exceed the AT Protocol blob limit
  let result = await pipeline.toBuffer()
  if (result.byteLength > MAX_BLOB_SIZE) {
    const metadata = await sharp(buffer).metadata()
    const width = metadata.width ?? 2000
    // Estimate scale factor needed, then apply with some margin
    const scale = Math.sqrt(MAX_BLOB_SIZE / result.byteLength) * 0.9
    const targetWidth = Math.round(width * scale)
    pipeline = sharp(buffer).rotate().resize(targetWidth)
    result = await pipeline.toBuffer()

    // If still too large, compress more aggressively with JPEG
    if (result.byteLength > MAX_BLOB_SIZE) {
      result = await sharp(buffer)
        .rotate()
        .resize(targetWidth)
        .jpeg({ quality: 70 })
        .toBuffer()
    }
  }
  return result
}

// Max age, in seconds, for static routes and assets
const MAX_AGE = env.NODE_ENV === 'production' ? 60 : 0

type Session = { did?: string }

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
) {
  res.setHeader('Vary', 'Cookie')

  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: env.COOKIE_SECRET,
  })
  if (!session.did) return null

  // This page is dynamic and should not be cached publicly
  res.setHeader('cache-control', `max-age=${MAX_AGE}, private`)

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    return oauthSession ? new Agent(oauthSession) : null
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth restore failed')
    await session.destroy()
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
        const session = await getIronSession<Session>(req, res, {
          cookieName: 'sid',
          password: env.COOKIE_SECRET,
        })

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
        ctx.logger.error({ err }, 'oauth callback failed')
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

      const session = await getIronSession<Session>(req, res, {
        cookieName: 'sid',
        password: env.COOKIE_SECRET,
      })

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

  // Homepage — JSON: paginated tree list; HTML: single tree offering
  router.get(
    '/',
    handler(async (req, res) => {
      const isJson = wantsJson(req)

      // ── JSON API branch (paginated listing) ──
      if (isJson) {
        const limit = Math.min(
          Math.max(parseInt(req.query.limit as string) || DEFAULT_LIMIT, 1),
          MAX_LIMIT,
        )
        const cursor = ifString(req.query.cursor as string)

        let query = ctx.db
          .selectFrom('tree')
          .selectAll('tree')
          .orderBy('tree.indexedAt', 'desc')
          .limit(limit + 1)

        if (cursor) {
          query = query.where('tree.indexedAt', '<', cursor)
        }

        const rows = await query.execute()
        const hasMore = rows.length > limit
        const trees = hasMore ? rows.slice(0, limit) : rows

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
        return res.json({
          trees: trees.map((t) =>
            treeToJson(t, didHandleMap[t.authorDid], treeCounts[t.uri] ?? 0),
          ),
          cursor: hasMore ? trees[trees.length - 1].indexedAt : undefined,
        })
      }

      // ── HTML branch ──
      const agent = await getSessionAgent(req, res, ctx)
      const searchQuery = ifString(req.query.q as string)?.trim()

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

      // Search mode: return matching trees as a simple list
      if (searchQuery) {
        const results = await ctx.db
          .selectFrom('tree')
          .selectAll()
          .where('name', 'like', `%${searchQuery}%`)
          .orderBy('name', 'asc')
          .limit(20)
          .execute()

        const resultDids = results.map((t) => t.authorDid)
        const didHandleMap = resultDids.length
          ? await ctx.resolver.resolveDidsToHandles(resultDids)
          : {}

        // Get inscription counts for search results
        const treeCounts: Record<string, number> = {}
        if (results.length > 0) {
          const counts = await ctx.db
            .selectFrom('inscription')
            .select(['tree', ctx.db.fn.count('uri').as('count')])
            .where(
              'tree',
              'in',
              results.map((t) => t.uri),
            )
            .groupBy('tree')
            .execute()
          for (const row of counts) {
            treeCounts[row.tree] = Number(row.count)
          }
        }

        return res.type('html').send(
          page(
            <Home
              searchQuery={searchQuery}
              searchResults={results}
              treeCounts={treeCounts}
              didHandleMap={didHandleMap}
              user={user}
            />,
          ),
        )
      }

      // Offering mode: surface one tree
      const treeCount = await ctx.db
        .selectFrom('tree')
        .select(ctx.db.fn.count('uri').as('count'))
        .executeTakeFirst()
      const totalTrees = Number(treeCount?.count ?? 0)

      if (totalTrees === 0) {
        return res.type('html').send(page(<Home user={user} />))
      }

      // Pick a random tree, preferring ones with inscriptions
      const offset = Math.floor(Math.random() * totalTrees)
      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .orderBy('indexedAt', 'desc')
        .limit(1)
        .offset(offset)
        .executeTakeFirst()

      if (!tree) {
        return res.type('html').send(page(<Home user={user} />))
      }

      const inscriptionCount = Number(
        (
          await ctx.db
            .selectFrom('inscription')
            .select(ctx.db.fn.count('uri').as('count'))
            .where('tree', '=', tree.uri)
            .executeTakeFirst()
        )?.count ?? 0,
      )

      const didHandleMap = await ctx.resolver.resolveDidsToHandles([tree.authorDid])

      return res.type('html').send(
        page(
          <Home
            tree={tree}
            treeHandle={didHandleMap[tree.authorDid]}
            inscriptionCount={inscriptionCount}
            totalTrees={totalTrees}
            user={user}
          />,
        ),
      )
    }),
  )

  // Tree detail page
  router.get(
    '/tree/:slug',
    handler(async (req, res) => {
      const isJson = wantsJson(req)
      const agent = isJson ? null : await getSessionAgent(req, res, ctx)

      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) {
        if (isJson) {
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

      if (isJson) {
        res.setHeader('Vary', 'Accept')
        return res.json({
          tree: treeToJson(tree, didHandleMap[tree.authorDid]),
          inscriptions: inscriptions.map((i) =>
            inscriptionToJson(i, didHandleMap[i.authorDid]),
          ),
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
          />,
        ),
      )
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
      let imageBlob: unknown | undefined
      let imageCid: string | null = null

      {
        // Extract GPS from EXIF before stripping
        try {
          const gps = await exifrGps(req.file.buffer)
          if (gps) {
            const lat = Number(gps.latitude)
            const lng = Number(gps.longitude)
            if (!isNaN(lat) && !isNaN(lng)) {
              exifLat = String(lat)
              exifLng = String(lng)
            }
          }
        } catch (err) {
          ctx.logger.debug({ err }, 'no EXIF GPS data found')
        }

        // Strip EXIF and downscale if needed
        const cleaned = await processImage(req.file.buffer, req.file.mimetype)

        if (env.MOCK_WRITES) {
          ctx.logger.info('MOCK_WRITES: skipping uploadBlob for tree image')
          imageCid = `mock-${Date.now()}`
          mockImageStore.set(imageCid, { data: cleaned, mime: req.file.mimetype })
        } else {
          // Upload clean image to the user's repo
          const uploadRes = await agent.uploadBlob(cleaned, {
            encoding: req.file.mimetype,
          })
          imageBlob = uploadRes.data.blob
          imageCid = uploadRes.data.blob.ref.toString()
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

      const record: Record<string, unknown> = {
        $type: 'com.treeappreciation.tree',
        name: req.body?.name,
        description: req.body?.description || undefined,
        image: imageBlob,
        createdAt: new Date().toISOString(),
      }
      if (latitude) record.latitude = latitude
      if (longitude) record.longitude = longitude

      if (!env.MOCK_WRITES && !Tree.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid tree data</h1>')
      }

      let uri
      if (env.MOCK_WRITES) {
        const rkey = TID.nextStr()
        uri = `at://${agent.assertDid}/com.treeappreciation.tree/${rkey}`
        ctx.logger.info({ uri }, 'MOCK_WRITES: skipping putRecord for tree')
      } else {
        try {
          const result = await agent.com.atproto.repo.putRecord({
            repo: agent.assertDid,
            collection: 'com.treeappreciation.tree',
            rkey: TID.nextStr(),
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

      const baseSlug = req.body?.slug
        ? slugify(req.body.slug)
        : slugify(record.name as string)
      const slug = await findUniqueSlug(ctx.db, baseSlug)

      try {
        await ctx.db
          .insertInto('tree')
          .values({
            uri,
            authorDid: agent.assertDid,
            name: record.name as string,
            slug,
            description: (record.description as string) ?? null,
            imageCid,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            createdAt: record.createdAt as string,
            indexedAt: new Date().toISOString(),
          })
          .execute()
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

        const cleaned = await processImage(req.file.buffer, req.file.mimetype)

        if (env.MOCK_WRITES) {
          ctx.logger.info('MOCK_WRITES: skipping uploadBlob for inscription image')
          imageCid = `mock-${Date.now()}`
          mockImageStore.set(imageCid, { data: cleaned, mime: req.file.mimetype })
        } else {
          const uploadRes = await agent.uploadBlob(cleaned, {
            encoding: req.file.mimetype,
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
