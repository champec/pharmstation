// ============================================
// Time-based one-time codes (RFC 6238, HMAC-SHA1), in plain TypeScript.
//
// Hermes has no crypto.subtle and adding a native crypto package would force
// a new app build, so SHA-1 and HMAC are implemented here. They are only used
// to generate authenticator codes, which is what SHA-1 is still fine for.
// ============================================

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decode an RFC 4648 base32 secret (spaces, dashes and padding ignored). */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('That setup key isn’t valid.')
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

function rotl(x: number, n: number) {
  return (x << n) | (x >>> (32 - n))
}

export function sha1(msg: Uint8Array): Uint8Array {
  const ml = msg.length
  const withPad = ((ml + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(withPad)
  buf.set(msg)
  buf[ml] = 0x80
  const bitLen = ml * 8
  const view = new DataView(buf.buffer)
  view.setUint32(withPad - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(withPad - 4, bitLen >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  const ov = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h))
  return out
}

export function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key.length > 64 ? sha1(key) : key
  const padded = new Uint8Array(64)
  padded.set(k)
  k = padded
  const inner = new Uint8Array(64 + msg.length)
  const outer = new Uint8Array(64 + 20)
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i] ^ 0x36
    outer[i] = k[i] ^ 0x5c
  }
  inner.set(msg, 64)
  outer.set(sha1(inner), 64)
  return sha1(outer)
}

/** The code for `secret` at `timeMs` (defaults: 6 digits, 30-second steps). */
export function totp(secret: string, timeMs = Date.now(), digits = 6, period = 30): string {
  const key = base32Decode(secret)
  const counter = Math.floor(timeMs / 1000 / period)
  const msg = new Uint8Array(8)
  const mv = new DataView(msg.buffer)
  mv.setUint32(0, Math.floor(counter / 0x100000000))
  mv.setUint32(4, counter >>> 0)
  const h = hmacSha1(key, msg)
  const o = h[19] & 0x0f
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export interface OtpAccount {
  id: string
  issuer: string
  label: string
  secret: string
  digits: number
  period: number
  /** Supabase factor id when this phone set itself up, so it can be matched later. */
  factorId?: string
  addedAt: string
}

/** Parse an otpauth://totp/... link from a setup QR code. */
export function parseOtpauth(uri: string): Omit<OtpAccount, 'id' | 'addedAt'> {
  const m = /^otpauth:\/\/totp\/([^?]*)\?(.*)$/i.exec(uri.trim())
  if (!m) throw new Error('That isn’t a two-step sign-in QR code.')
  const params: Record<string, string> = {}
  for (const pair of m[2].split('&')) {
    const [k, v = ''] = pair.split('=')
    params[decodeURIComponent(k).toLowerCase()] = decodeURIComponent(v.replace(/\+/g, ' '))
  }
  const algorithm = (params.algorithm ?? 'SHA1').toUpperCase()
  if (algorithm !== 'SHA1') throw new Error('This code uses a type the app doesn’t support yet.')
  const secret = (params.secret ?? '').replace(/\s/g, '').toUpperCase()
  base32Decode(secret) // validates
  const path = decodeURIComponent(m[1])
  const [pathIssuer, ...rest] = path.includes(':') ? path.split(':') : ['', path]
  const digits = Number(params.digits ?? 6)
  const period = Number(params.period ?? 30)
  return {
    issuer: params.issuer || pathIssuer || 'PharmStation',
    label: (rest.join(':') || path).trim(),
    secret,
    digits: digits === 8 ? 8 : 6,
    period: period > 0 && period <= 300 ? period : 30,
  }
}
