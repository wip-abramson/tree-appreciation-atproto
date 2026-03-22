import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  generateKeyPair,
  buildSigningString,
  computeDigest,
  signRequest,
  parseSignatureHeader,
  verifySignature,
} from '../http-signatures'

describe('generateKeyPair', () => {
  it('generates valid RSA PEM keys', () => {
    const kp = generateKeyPair()
    assert.ok(kp.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----'))
    assert.ok(kp.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----'))
  })

  it('generates keys that can sign and verify', () => {
    const kp = generateKeyPair()
    const data = 'hello world'
    const sign = crypto.createSign('RSA-SHA256')
    sign.update(data)
    const signature = sign.sign(kp.privateKeyPem, 'base64')

    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(data)
    assert.ok(verify.verify(kp.publicKeyPem, signature, 'base64'))
  })
})

describe('computeDigest', () => {
  it('computes SHA-256 digest of a string body', () => {
    const body = '{"type":"Follow"}'
    const digest = computeDigest(body)
    assert.ok(digest.startsWith('SHA-256='))

    // Verify manually
    const expected =
      'SHA-256=' +
      crypto.createHash('sha256').update(body).digest('base64')
    assert.equal(digest, expected)
  })

  it('computes SHA-256 digest of a Buffer body', () => {
    const body = Buffer.from('hello')
    const digest = computeDigest(body)
    const expected =
      'SHA-256=' +
      crypto.createHash('sha256').update(body).digest('base64')
    assert.equal(digest, expected)
  })
})

describe('buildSigningString', () => {
  it('builds correct signing string for GET request', () => {
    const result = buildSigningString(
      {
        method: 'GET',
        path: '/users/alice',
        headers: {
          host: 'example.com',
          date: 'Fri, 20 Mar 2026 12:00:00 GMT',
        },
      },
      ['(request-target)', 'host', 'date'],
    )
    assert.equal(
      result,
      '(request-target): get /users/alice\nhost: example.com\ndate: Fri, 20 Mar 2026 12:00:00 GMT',
    )
  })

  it('builds correct signing string for POST request with digest', () => {
    const result = buildSigningString(
      {
        method: 'POST',
        path: '/inbox',
        headers: {
          host: 'remote.example.com',
          date: 'Fri, 20 Mar 2026 12:00:00 GMT',
          digest: 'SHA-256=abc123',
        },
      },
      ['(request-target)', 'host', 'date', 'digest'],
    )
    assert.equal(
      result,
      '(request-target): post /inbox\n' +
        'host: remote.example.com\n' +
        'date: Fri, 20 Mar 2026 12:00:00 GMT\n' +
        'digest: SHA-256=abc123',
    )
  })

  it('throws if a required header is missing', () => {
    assert.throws(() => {
      buildSigningString(
        { method: 'GET', path: '/', headers: {} },
        ['(request-target)', 'host'],
      )
    }, /Missing header "host"/)
  })
})

describe('parseSignatureHeader', () => {
  it('parses a standard Signature header', () => {
    const header =
      'keyId="https://example.com/tree/oak#main-key",' +
      'algorithm="rsa-sha256",' +
      'headers="(request-target) host date digest",' +
      'signature="abc123base64=="'
    const parsed = parseSignatureHeader(header)
    assert.ok(parsed)
    assert.equal(parsed.keyId, 'https://example.com/tree/oak#main-key')
    assert.equal(parsed.algorithm, 'rsa-sha256')
    assert.deepEqual(parsed.headers, [
      '(request-target)',
      'host',
      'date',
      'digest',
    ])
    assert.equal(parsed.signature, 'abc123base64==')
  })

  it('returns null for missing keyId', () => {
    const result = parseSignatureHeader('algorithm="rsa-sha256"')
    assert.equal(result, null)
  })

  it('defaults to date header when headers param is missing', () => {
    const result = parseSignatureHeader(
      'keyId="https://x.com/a#main-key",signature="abc"',
    )
    assert.ok(result)
    assert.deepEqual(result.headers, ['date'])
  })
})

describe('signRequest + verify round-trip', () => {
  const kp = generateKeyPair()

  it('signs a GET request and verifies the signature', () => {
    const url = 'https://remote.example.com/users/bob'
    const sigHeaders = signRequest({
      keyId: 'https://tree.app/tree/oak#main-key',
      privateKeyPem: kp.privateKeyPem,
      method: 'GET',
      url,
    })

    assert.ok(sigHeaders.signature)
    assert.ok(sigHeaders.date)
    assert.ok(sigHeaders.host)

    // Parse the Signature header
    const parsed = parseSignatureHeader(sigHeaders.signature)
    assert.ok(parsed)
    assert.equal(parsed.keyId, 'https://tree.app/tree/oak#main-key')
    assert.equal(parsed.algorithm, 'rsa-sha256')

    // Reconstruct signing string and verify
    const signingString = buildSigningString(
      {
        method: 'GET',
        path: '/users/bob',
        headers: sigHeaders,
      },
      parsed.headers,
    )

    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signingString)
    assert.ok(verify.verify(kp.publicKeyPem, parsed.signature, 'base64'))
  })

  it('signs a POST request with body and verifies digest + signature', () => {
    const url = 'https://remote.example.com/users/bob/inbox'
    const body = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Accept',
      actor: 'https://tree.app/tree/oak',
    })

    const sigHeaders = signRequest({
      keyId: 'https://tree.app/tree/oak#main-key',
      privateKeyPem: kp.privateKeyPem,
      method: 'POST',
      url,
      body,
    })

    // Verify the Digest header matches
    assert.ok(sigHeaders.digest)
    assert.equal(sigHeaders.digest, computeDigest(body))

    // Parse and verify the signature
    const parsed = parseSignatureHeader(sigHeaders.signature)
    assert.ok(parsed)
    assert.ok(parsed.headers.includes('digest'))

    const signingString = buildSigningString(
      {
        method: 'POST',
        path: '/users/bob/inbox',
        headers: sigHeaders,
      },
      parsed.headers,
    )

    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signingString)
    assert.ok(verify.verify(kp.publicKeyPem, parsed.signature, 'base64'))
  })

  it('fails verification with wrong public key', () => {
    const otherKp = generateKeyPair()
    const url = 'https://remote.example.com/test'
    const sigHeaders = signRequest({
      keyId: 'https://tree.app/tree/oak#main-key',
      privateKeyPem: kp.privateKeyPem,
      method: 'GET',
      url,
    })

    const parsed = parseSignatureHeader(sigHeaders.signature)
    assert.ok(parsed)

    const signingString = buildSigningString(
      { method: 'GET', path: '/test', headers: sigHeaders },
      parsed.headers,
    )

    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signingString)
    assert.ok(!verify.verify(otherKp.publicKeyPem, parsed.signature, 'base64'))
  })

  it('fails verification with tampered body', () => {
    const url = 'https://remote.example.com/inbox'
    const body = '{"type":"Follow"}'
    const sigHeaders = signRequest({
      keyId: 'https://tree.app/tree/oak#main-key',
      privateKeyPem: kp.privateKeyPem,
      method: 'POST',
      url,
      body,
    })

    // Tamper with the digest
    const tamperedDigest = computeDigest('{"type":"Delete"}')
    assert.notEqual(sigHeaders.digest, tamperedDigest)
  })

  it('fails verification with tampered headers', () => {
    const url = 'https://remote.example.com/inbox'
    const sigHeaders = signRequest({
      keyId: 'https://tree.app/tree/oak#main-key',
      privateKeyPem: kp.privateKeyPem,
      method: 'GET',
      url,
    })

    const parsed = parseSignatureHeader(sigHeaders.signature)
    assert.ok(parsed)

    // Tamper with the date
    const tamperedHeaders = { ...sigHeaders, date: 'Sat, 01 Jan 2000 00:00:00 GMT' }
    const signingString = buildSigningString(
      { method: 'GET', path: '/inbox', headers: tamperedHeaders },
      parsed.headers,
    )

    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signingString)
    assert.ok(!verify.verify(kp.publicKeyPem, parsed.signature, 'base64'))
  })
})
