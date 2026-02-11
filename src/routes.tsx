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
import { ifString } from '#/lib/util'
import { page } from '#/lib/view'
import { Home } from '#/pages/home'
import { SeedTree } from '#/pages/seed-tree'
import { TreeDetail } from '#/pages/tree-detail'
import { Login } from '#/pages/login'

const MAX_BLOB_SIZE = 1_000_000

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

export const createRouter = (ctx: AppContext): RequestListener => {
  const router = express()

  // Static assets
  router.use(
    '/public',
    express.static(path.join(__dirname, 'pages', 'public'), {
      maxAge: MAX_AGE * 1000,
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

      res.type('html').send(page(<SeedTree profile={profile} />))
    }),
  )

  // Homepage — list recent trees with inscription counts
  router.get(
    '/',
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)

      // Fetch trees with inscription counts
      const trees = await ctx.db
        .selectFrom('tree')
        .selectAll('tree')
        .orderBy('tree.indexedAt', 'desc')
        .limit(50)
        .execute()

      // Get inscription counts for these trees
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

      // Map user DIDs to their domain-name handles
      const didHandleMap = await ctx.resolver.resolveDidsToHandles(
        trees.map((t) => t.authorDid),
      )

      if (!agent) {
        return res
          .type('html')
          .send(
            page(
              <Home
                trees={trees}
                treeCounts={treeCounts}
                didHandleMap={didHandleMap}
              />,
            ),
          )
      }

      // Fetch profile for logged-in user
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

      res
        .type('html')
        .send(
          page(
            <Home
              trees={trees}
              treeCounts={treeCounts}
              didHandleMap={didHandleMap}
              profile={profile}
            />,
          ),
        )
    }),
  )

  // Tree detail page
  router.get(
    '/tree/:slug',
    handler(async (req, res) => {
      const agent = await getSessionAgent(req, res, ctx)

      const tree = await ctx.db
        .selectFrom('tree')
        .selectAll()
        .where('slug', '=', req.params.slug)
        .executeTakeFirst()

      if (!tree) {
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
      const didHandleMap = await ctx.resolver.resolveDidsToHandles(allDids)

      res.type('html').send(
        page(
          <TreeDetail
            tree={tree}
            inscriptions={inscriptions}
            didHandleMap={didHandleMap}
            currentDid={agent?.did ?? null}
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
            exifLat = String(gps.latitude)
            exifLng = String(gps.longitude)
          }
        } catch (err) {
          ctx.logger.debug({ err }, 'no EXIF GPS data found')
        }

        // Strip EXIF and downscale if needed
        const cleaned = await processImage(req.file.buffer, req.file.mimetype)

        // Upload clean image to the user's repo
        const uploadRes = await agent.uploadBlob(cleaned, {
          encoding: req.file.mimetype,
        })
        imageBlob = uploadRes.data.blob
        imageCid = uploadRes.data.blob.ref.toString()
      }

      // Use form values, falling back to EXIF GPS
      const latitude = req.body?.latitude || exifLat
      const longitude = req.body?.longitude || exifLng

      if (!latitude || !longitude) {
        return res
          .status(400)
          .type('html')
          .send(
            '<h1>Error: Location required. Provide coordinates or upload an image with GPS data.</h1>',
          )
      }

      const record: Record<string, unknown> = {
        $type: 'com.treeappreciation.tree',
        name: req.body?.name,
        description: req.body?.description || undefined,
        image: imageBlob,
        latitude,
        longitude,
        createdAt: new Date().toISOString(),
      }

      if (!Tree.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid tree data</h1>')
      }

      let uri
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
            latitude,
            longitude,
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
        const uploadRes = await agent.uploadBlob(cleaned, {
          encoding: req.file.mimetype,
        })
        imageBlob = uploadRes.data.blob
        imageCid = uploadRes.data.blob.ref.toString()
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

      if (!Inscription.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid inscription data</h1>')
      }

      let uri
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

  return router
}
