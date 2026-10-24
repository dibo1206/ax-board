// 저장할 때 암호화해야 하는 값(2단계 인증 비밀값, 나중에 받게 될 고유식별정보 등)과 2단계 인증 코드 확인.
// 외부 라이브러리 없이 node:crypto만 쓴다. 암호화 키는 .env 의 DATA_KEY (64자리 16진수 = 32바이트)에서만 읽는다.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function dataKey() {
  const hex = process.env.DATA_KEY ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('.env 의 DATA_KEY 가 없거나 형식이 틀려요 (64자리 16진수)')
  return Buffer.from(hex, 'hex')
}

// AES-256-GCM: 내용이 바뀌면 복호화가 실패해서 위조도 알아챈다. 형식: v1.iv.tag.본문 (base64url)
export function encrypt(text) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decrypt(sealed) {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1') throw new Error('알 수 없는 암호문 형식')
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

// ---------- 2단계 인증 (TOTP, RFC 6238: 30초마다 바뀌는 6자리 · 구글 OTP 등 인증 앱과 호환) ----------
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer) {
  let bits = ''
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0')
  return bits.match(/.{1,5}/g).map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)]).join('')
}

function base32Decode(text) {
  const bits = text.replace(/=+$/, '').toUpperCase().split('').map((c) => {
    const index = ALPHABET.indexOf(c)
    if (index < 0) throw new Error('잘못된 비밀값')
    return index.toString(2).padStart(5, '0')
  }).join('')
  return Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)))
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function totpCode(secret, counter) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

export const currentCounter = () => Math.floor(Date.now() / 30_000)

// 앞뒤 30초까지 허용 (휴대폰 시계가 조금 어긋나도 되게). 맞으면 그 코드의 counter를 돌려준다 (같은 코드 재사용 막기용)
export function verifyTotp(secret, code, afterCounter = -1) {
  if (!/^\d{6}$/.test(code)) return null
  const now = currentCounter()
  for (const counter of [now - 1, now, now + 1]) {
    if (counter <= afterCounter) continue
    if (timingSafeEqual(Buffer.from(totpCode(secret, counter)), Buffer.from(code))) return counter
  }
  return null
}

export function otpauthUri(account, secret) {
  const label = encodeURIComponent(`farm-mall:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=farm-mall&algorithm=SHA1&digits=6&period=30`
}
