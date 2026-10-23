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

// 같은 아이디로 5번 틀리면 10분 동안 막는다 (서버 메모리 기준)
const fails = new Map()

export async function login(req, res) {
  const loginId = typeof req.body.loginId === 'string' ? req.body.loginId.trim() : ''
  const password = typeof req.body.password === 'string' ? req.body.password : ''
  const record = fails.get(loginId)
  if (record && record.count >= MAX_FAILS && Date.now() - record.at < LOCK_MINUTES * 60_000) {
    return res.status(429).json({ error: `로그인을 여러 번 틀렸어요. ${LOCK_MINUTES}분 뒤에 다시 시도해 주세요.` })
  }
  const { rows } = await pool.query('SELECT id, login_id, password_hash FROM admins WHERE login_id = $1', [loginId])
  const ok = rows.length === 1 && (await verifyPassword(password, rows[0].password_hash))
  if (!ok) {
    fails.set(loginId, { count: (record?.count ?? 0) + 1, at: Date.now() })
    return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' })
  }
  fails.delete(loginId)
  setSessionCookie(res, sign({ id: rows[0].id, loginId: rows[0].login_id, exp: Date.now() + SESSION_HOURS * 3_600_000 }), SESSION_HOURS * 3600)
  res.json({ loginId: rows[0].login_id })
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

// 관리자 API 앞에 붙이는 문지기. 로그인하지 않았으면 401
export function requireAdmin(req, res, next) {
  const admin = currentAdmin(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  req.admin = admin
  next()
}
