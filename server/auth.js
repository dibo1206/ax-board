// 관리자·판매자 로그인. 비밀번호는 scrypt 해시로만 저장하고, 로그인 상태는 서명한 쿠키로 확인한다.
// 비밀번호 확인·서명·쿠키·로그인 잠금 함수는 손님 회원(account.js)도 같이 쓴다.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { writeAccessLog } from './accessLog.js'
import { decrypt, verifyTotp } from './crypto.js'
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

// 없는 계정일 때도 같은 시간이 걸리게 가짜 해시로 한 번 계산한다 (응답 시간으로 가입 여부를 알아내지 못하게)
const dummyHash = hashPassword(randomBytes(16).toString('hex'))
export async function passwordMatches(password, stored) {
  const ok = await verifyPassword(password, stored ?? (await dummyHash))
  return ok && Boolean(stored)
}

export async function verifyPassword(password, stored) {
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

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyToken(token) {
  const [body, mac] = (token || '').split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  return payload.exp > Date.now() ? payload : null
}

export function readCookie(req, name) {
  const found = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null
}

export function setCookie(res, name, value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.append('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`)
}

const setSessionCookie = (res, value, maxAgeSeconds) => setCookie(res, COOKIE, value, maxAgeSeconds)

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

function undoFail(map, key) {
  const record = map.get(key)
  if (record && record.count > 1) record.count -= 1
  else map.delete(key)
}

// 관리자 접속 허용 IP: .env 의 ADMIN_ALLOWED_IPS (쉼표로 여러 개, "203.0.113." 처럼 끝이 점이면 그 대역 전체). 비우면 제한 없음
export function adminIpAllowed(ip) {
  const list = (process.env.ADMIN_ALLOWED_IPS ?? '').split(',').map((v) => v.trim()).filter(Boolean)
  if (!list.length) return true
  const plain = (ip ?? '').replace(/^::ffff:/, '')
  return list.some((rule) => (rule.endsWith('.') ? plain.startsWith(rule) : plain === rule))
}

// 2단계 인증을 등록하지 않은 계정은 로그인할 수 없다: REQUIRE_2FA=1 이거나, 운영(NODE_ENV=production)이면 기본으로 켜진다 (REQUIRE_2FA=0 으로만 끈다)
const twoFactorRequired = () => process.env.REQUIRE_2FA === '1' || (process.env.NODE_ENV === 'production' && process.env.REQUIRE_2FA !== '0')

// 손님 회원 로그인도 같은 잠금 규칙을 쓴다 (key 앞에 'c:'를 붙여 관리자 아이디와 섞이지 않게)
// 비밀번호 확인(scrypt)은 느려서, 확인이 끝난 뒤에 실패를 세면 동시에 들어온 요청이 모두 '0번 틀림'을 보고 통과한다.
// 그래서 확인하기 전에 이번 시도를 실패 1번으로 미리 센다(잠금 검사와 같은 순간, 사이에 await 없음).
// 비밀번호가 맞으면 undoAttempt로 되돌린다. 잠겨 있으면 false
export function reserveAttempt(key, ip) {
  if (locked(ipFails, ip, MAX_IP_FAILS) || locked(fails, key, MAX_FAILS)) return false
  addFail(fails, key)
  addFail(ipFails, ip)
  return true
}
export function undoAttempt(key, ip) {
  undoFail(fails, key)
  undoFail(ipFails, ip)
}
export const clearFails = (key) => fails.delete(key)

export async function login(req, res) {
  const loginId = typeof req.body.loginId === 'string' ? req.body.loginId.trim().slice(0, 40) : ''
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : ''
  const otp = typeof req.body.otp === 'string' ? req.body.otp.replace(/\s/g, '') : ''
  const log = (action, extra = {}) => writeAccessLog({ loginId, action, ip: req.ip, ...extra })
  if (!reserveAttempt(loginId, req.ip)) {
    log('login_locked')
    return res.status(429).json({ error: `로그인을 여러 번 틀렸어요. ${LOCK_MINUTES}분 뒤에 다시 시도해 주세요.` })
  }
  const { rows } = await pool.query(
    'SELECT id, login_id, password_hash, role, seller_code, totp_secret_enc, totp_last_counter, session_version FROM admins WHERE login_id = $1',
    [loginId],
  )
  const ok = (await passwordMatches(password, rows[0]?.password_hash)) && rows.length === 1
  if (!ok) {
    log('login_fail') // 실패는 위에서 이미 셌다
    return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' })
  }
  // 비밀번호는 맞았으니 미리 센 1번을 되돌린다. 아이디의 실패 기록은 2단계 인증까지 통과해야 지운다
  // (비밀번호를 아는 사람이 인증 코드를 계속 넣어 보지 못하게)
  undoAttempt(loginId, req.ip)
  const { id, login_id: account, role, seller_code: sellerCode, totp_secret_enc: sealed, totp_last_counter: lastCounter, session_version: sv } = rows[0]
  if (role === 'admin' && !adminIpAllowed(req.ip)) {
    log('login_blocked_ip', { role })
    return res.status(403).json({ error: '허용된 곳에서만 관리자 로그인이 돼요.' })
  }
  if (sealed) {
    if (!otp) return res.status(401).json({ error: '인증 앱에 나온 6자리 코드를 넣어 주세요.', needOtp: true })
    const counter = verifyTotp(decrypt(sealed), otp, Number(lastCounter))
    if (counter === null) {
      addFail(fails, loginId)
      addFail(ipFails, req.ip)
      log('otp_fail', { role })
      return res.status(401).json({ error: '인증 코드가 맞지 않아요. 새 코드로 다시 넣어 주세요.', needOtp: true })
    }
    await pool.query('UPDATE admins SET totp_last_counter = $1 WHERE id = $2', [counter, id]) // 같은 코드를 다시 못 쓰게
  } else if (twoFactorRequired()) {
    log('login_no_2fa', { role })
    return res.status(403).json({ error: '2단계 인증을 먼저 등록해 주세요. (서버에서 npm run admin-2fa -- 아이디)' })
  }
  fails.delete(loginId)
  setSessionCookie(res, signToken({ kind: 'staff', id, sv, loginId: account, role, sellerCode, mfa: Boolean(sealed), exp: Date.now() + SESSION_HOURS * 3_600_000 }), SESSION_HOURS * 3600)
  log('login_ok', { role })
  res.json({ loginId: account, role, sellerCode, mfa: Boolean(sealed) })
}

export function logout(req, res) {
  const account = currentAdmin(req)
  if (account) writeAccessLog({ loginId: account.loginId, role: account.role, action: 'logout', ip: req.ip })
  setSessionCookie(res, '', 0)
  res.status(204).end()
}

export function currentAdmin(req) {
  try {
    const payload = verifyToken(readCookie(req, COOKIE))
    return payload?.kind === 'staff' ? payload : null // 손님 쿠키나 결제용 표를 관리자 쿠키 자리에 넣어도 통과하지 못하게
  } catch {
    return null
  }
}

// 쿠키 서명만 믿지 않고 요청마다 DB에서 계정을 다시 확인한다
// → 계정을 지우거나 비밀번호·2단계 인증을 바꾸면(session_version 증가) 이미 로그인한 쿠키도 바로 끊긴다. 역할·농가도 DB 값을 쓴다
export async function currentStaff(req) {
  const token = currentAdmin(req)
  if (!token?.id) return null
  const { rows } = await pool.query(
    `SELECT a.login_id, a.role, a.seller_code, a.session_version, a.totp_secret_enc IS NOT NULL AS mfa, s.status AS seller_status
     FROM admins a LEFT JOIN sellers s ON s.seller_code = a.seller_code WHERE a.id = $1`,
    [token.id],
  )
  const row = rows[0]
  if (!row || row.session_version !== token.sv) return null
  return { ...token, loginId: row.login_id, role: row.role, sellerCode: row.seller_code, mfa: row.mfa, sellerStatus: row.seller_status }
}

// 관리자 API 앞에 붙이는 문지기. 로그인하지 않았으면 401, 판매자 계정이면 403
export async function requireAdmin(req, res, next) {
  const admin = await currentStaff(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  if (admin.role === 'seller') return res.status(403).json({ error: '관리자만 쓸 수 있어요. 판매자 화면(/seller)을 이용해 주세요.' })
  if (!adminIpAllowed(req.ip)) return res.status(403).json({ error: '허용된 곳에서만 관리자 화면을 쓸 수 있어요.' })
  req.admin = admin
  next()
}

// 판매자 API 앞에 붙이는 문지기. 판매자 계정만 통과하고, req.seller.sellerCode로 자기 농가만 다룬다
export async function requireSeller(req, res, next) {
  const account = await currentStaff(req)
  if (!account) return res.status(401).json({ error: '판매자 로그인이 필요해요.' })
  if (account.role !== 'seller' || !account.sellerCode) return res.status(403).json({ error: '판매자 계정만 쓸 수 있어요. 관리자는 관리자 화면(/admin)을 이용해 주세요.' })
  // 승인 전 판매자는 내 상태(/me)만 볼 수 있다 (상품·주문은 승인 뒤에)
  if (account.sellerStatus !== 'active' && req.path !== '/me') return res.status(403).json({ error: '판매자 승인 뒤에 쓸 수 있어요.', notApproved: true })
  req.seller = account
  next()
}
