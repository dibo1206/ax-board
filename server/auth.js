// 관리자 로그인. 비밀번호는 scrypt 해시로만 저장하고, 로그인 상태는 서명한 쿠키로 확인한다.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { pool } from './db.js'

const scrypt = promisify(scryptCb)
const COOKIE = 'admin_session'
const SESSION_HOURS = 8
const MAX_FAILS = 5
const LOCK_MINUTES = 10

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 64)
  return `scrypt:${salt}:${hash.toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [kind, salt, hex] = stored.split(':')
  if (kind !== 'scrypt' || !salt || !hex) return false
  const expected = Buffer.from(hex, 'hex')
  const actual = await scrypt(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('.env 의 SESSION_SECRET 이 없거나 너무 짧아요 (32자 이상)')
  return value
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

function verify(token) {
  const [body, mac] = (token || '').split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  return payload.exp > Date.now() ? payload : null
}

function readCookie(req, name) {
  const found = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`)
}

// 같은 아이디로 5번 틀리면 10분 동안 막는다. 아이디를 바꿔 가며 시도하는 것도 막으려고 같은 IP는 20번까지 (서버 메모리 기준)
const fails = new Map()
const ipFails = new Map()
const MAX_IP_FAILS = 20

function locked(map, key, max) {
  const record = map.get(key)
  if (!record) return false
  if (Date.now() - record.at >= LOCK_MINUTES * 60_000) {
    map.delete(key)
    return false
  }
  return record.count >= max
}

function addFail(map, key) {
  const record = map.get(key)
  const fresh = !record || Date.now() - record.at >= LOCK_MINUTES * 60_000
  map.set(key, { count: fresh ? 1 : record.count + 1, at: fresh ? Date.now() : record.at })
  if (map.size > 5000) { // 아이디를 무작위로 바꿔 메모리를 채우는 공격 대비: 시간이 지난 기록부터 지운다
    for (const [k, v] of map) if (Date.now() - v.at >= LOCK_MINUTES * 60_000) map.delete(k)
  }
}

export async function login(req, res) {
  const loginId = typeof req.body.loginId === 'string' ? req.body.loginId.trim().slice(0, 40) : ''
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : ''
  if (locked(ipFails, req.ip, MAX_IP_FAILS) || locked(fails, loginId, MAX_FAILS)) {
    return res.status(429).json({ error: `로그인을 여러 번 틀렸어요. ${LOCK_MINUTES}분 뒤에 다시 시도해 주세요.` })
  }
  const { rows } = await pool.query('SELECT id, login_id, password_hash, role, seller_code FROM admins WHERE login_id = $1', [loginId])
  const ok = rows.length === 1 && (await verifyPassword(password, rows[0].password_hash))
  if (!ok) {
    addFail(fails, loginId)
    addFail(ipFails, req.ip)
    return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' })
  }
  fails.delete(loginId)
  const { id, login_id: account, role, seller_code: sellerCode } = rows[0]
  setSessionCookie(res, sign({ id, loginId: account, role, sellerCode, exp: Date.now() + SESSION_HOURS * 3_600_000 }), SESSION_HOURS * 3600)
  res.json({ loginId: account, role, sellerCode })
}

export function logout(req, res) {
  setSessionCookie(res, '', 0)
  res.status(204).end()
}

export function currentAdmin(req) {
  try {
    return verify(readCookie(req, COOKIE))
  } catch {
    return null
  }
}

// 관리자 API 앞에 붙이는 문지기. 로그인하지 않았으면 401, 판매자 계정이면 403
// (판매자 기능 전에 만든 로그인 쿠키에는 role이 없는데, 그때는 관리자 계정만 있었다)
export function requireAdmin(req, res, next) {
  const admin = currentAdmin(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  if (admin.role === 'seller') return res.status(403).json({ error: '관리자만 쓸 수 있어요. 판매자 화면(/seller)을 이용해 주세요.' })
  req.admin = admin
  next()
}

// 판매자 API 앞에 붙이는 문지기. 판매자 계정만 통과하고, req.seller.sellerCode로 자기 농가만 다룬다
export function requireSeller(req, res, next) {
  const account = currentAdmin(req)
  if (!account) return res.status(401).json({ error: '판매자 로그인이 필요해요.' })
  if (account.role !== 'seller' || !account.sellerCode) return res.status(403).json({ error: '판매자 계정만 쓸 수 있어요. 관리자는 관리자 화면(/admin)을 이용해 주세요.' })
  req.seller = account
  next()
}
