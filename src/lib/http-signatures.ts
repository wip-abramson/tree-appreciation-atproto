import crypto from 'node:crypto'

export type KeyPair = {
  publicKeyPem: string
  privateKeyPem: string
}

/**
 * Generate a 2048-bit RSA keypair for ActivityPub HTTP Signatures.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey, privateKeyPem: privateKey }
}

/**
 * Build the signing string for HTTP Signatures (draft-cavage-http-signatures).
 */
export function buildSigningString(
  params: {
    method: string
    path: string
    headers: Record<string, string>
  },
  signedHeaders: string[],
): string {
  return signedHeaders
    .map((h) => {
      if (h === '(request-target)') {
        return `(request-target): ${params.method.toLowerCase()} ${params.path}`
      }
      const value = params.headers[h.toLowerCase()]
      if (value === undefined) {
        throw new Error(`Missing header "${h}" for signature`)
      }
      return `${h.toLowerCase()}: ${value}`
    })
    .join('\n')
}

/**
 * Compute the SHA-256 Digest header value for a request body.
 */
export function computeDigest(body: string | Buffer): string {
  const hash = crypto
    .createHash('sha256')
    .update(body)
    .digest('base64')
  return `SHA-256=${hash}`
}

/**
 * Sign an outbound HTTP request for ActivityPub delivery.
 * Returns headers that should be added to the request.
 */
export function signRequest(opts: {
  keyId: string
  privateKeyPem: string
  method: string
  url: string
  body?: string
}): Record<string, string> {
  const parsed = new URL(opts.url)
  const date = new Date().toUTCString()

  const headers: Record<string, string> = {
    host: parsed.host,
    date,
  }

  const signedHeaderNames = ['(request-target)', 'host', 'date']

  if (opts.body !== undefined) {
    headers.digest = computeDigest(opts.body)
    signedHeaderNames.push('digest')
  }

  const signingString = buildSigningString(
    {
      method: opts.method,
      path: parsed.pathname,
      headers,
    },
    signedHeaderNames,
  )

  const sign = crypto.createSign('RSA-SHA256')
  sign.update(signingString)
  sign.end()
  const signature = sign.sign(opts.privateKeyPem, 'base64')

  headers.signature = [
    `keyId="${opts.keyId}"`,
    `algorithm="rsa-sha256"`,
    `headers="${signedHeaderNames.join(' ')}"`,
    `signature="${signature}"`,
  ].join(',')

  return headers
}

/**
 * Parse a Signature header into its components.
 */
export function parseSignatureHeader(header: string): {
  keyId: string
  algorithm: string
  headers: string[]
  signature: string
} | null {
  const params: Record<string, string> = {}
  // Match key="value" pairs, handling commas inside quoted values
  const regex = /(\w+)="([^"]*)"/g
  let match
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2]
  }

  if (!params.keyId || !params.signature) return null

  return {
    keyId: params.keyId,
    algorithm: params.algorithm || 'rsa-sha256',
    headers: params.headers ? params.headers.split(' ') : ['date'],
    signature: params.signature,
  }
}

/**
 * Verify an inbound HTTP Signature.
 */
export function verifySignature(opts: {
  publicKeyPem: string
  signatureBase64: string
  signingString: string
  algorithm?: string
}): boolean {
  try {
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(opts.signingString)
    verify.end()
    return verify.verify(opts.publicKeyPem, opts.signingString.length > 0 ? opts.signatureBase64 : '', 'base64')
  } catch {
    return false
  }
}

/**
 * Full inbound request verification.
 * Fetches the actor's public key, reconstructs the signing string, and verifies.
 */
export async function verifyRequest(opts: {
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}): Promise<{ verified: boolean; keyId: string | null; error?: string }> {
  const sigHeader = opts.headers['signature']
  if (!sigHeader) {
    return { verified: false, keyId: null, error: 'no Signature header' }
  }

  const parsed = parseSignatureHeader(sigHeader)
  if (!parsed) {
    return { verified: false, keyId: null, error: 'malformed Signature header' }
  }

  // Check Date freshness (12 hour window like Mastodon)
  const dateStr = opts.headers['date']
  if (dateStr) {
    const requestDate = new Date(dateStr)
    const now = new Date()
    const diffMs = Math.abs(now.getTime() - requestDate.getTime())
    if (diffMs > 12 * 60 * 60 * 1000) {
      return { verified: false, keyId: parsed.keyId, error: 'Date header too old' }
    }
  }

  // Verify Digest if present and body is available
  if (opts.body !== undefined && parsed.headers.includes('digest')) {
    const expected = computeDigest(opts.body)
    if (opts.headers['digest'] !== expected) {
      return { verified: false, keyId: parsed.keyId, error: 'Digest mismatch' }
    }
  }

  // Fetch the actor document to get the public key
  let publicKeyPem: string
  try {
    // Strip the fragment (e.g., #main-key) to get the actor URL
    const actorUrl = parsed.keyId.replace(/#.*$/, '')
    const res = await fetch(actorUrl, {
      headers: { Accept: 'application/activity+json, application/ld+json' },
    })
    if (!res.ok) {
      return { verified: false, keyId: parsed.keyId, error: `failed to fetch actor: ${res.status}` }
    }
    const actor = (await res.json()) as Record<string, unknown>
    const pk = actor.publicKey as Record<string, unknown> | undefined
    if (!pk || typeof pk.publicKeyPem !== 'string') {
      return { verified: false, keyId: parsed.keyId, error: 'no publicKey in actor document' }
    }
    // Verify the keyId matches
    if (pk.id !== parsed.keyId) {
      return { verified: false, keyId: parsed.keyId, error: 'keyId mismatch with actor document' }
    }
    publicKeyPem = pk.publicKeyPem
  } catch (err) {
    return { verified: false, keyId: parsed.keyId, error: `actor fetch error: ${err}` }
  }

  // Reconstruct the signing string
  let signingString: string
  try {
    signingString = buildSigningString(
      { method: opts.method, path: opts.path, headers: opts.headers },
      parsed.headers,
    )
  } catch (err) {
    return { verified: false, keyId: parsed.keyId, error: `signing string error: ${err}` }
  }

  // Verify the signature
  try {
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signingString)
    verify.end()
    const valid = verify.verify(publicKeyPem, parsed.signature, 'base64')
    return { verified: valid, keyId: parsed.keyId, error: valid ? undefined : 'signature invalid' }
  } catch (err) {
    return { verified: false, keyId: parsed.keyId, error: `verification error: ${err}` }
  }
}
