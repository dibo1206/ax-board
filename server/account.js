// 손님 회원: 가입·로그인·로그아웃·내 정보·배송지·비밀번호 변경·탈퇴·비밀번호 찾기·내 주문
// 비회원 주문은 그대로 되고, 로그인한 손님의 주문은 계정에 묶여 마이페이지에서 본다.
import { createHash, randomBytes } from 'node:crypto'
import express from 'express'
import { clearFails, hashPassword, isLocked, noteFail, readCookie, setCookie, signToken, verifyPassword, verifyToken } from './auth.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { publicUrl, queueMail } from './mailer.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'

const COOKIE = 'customer_session'
const SESSION_DAYS = 14
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const digits = (v) => text(v).replace(/[^0-9]/g, '')
const isEmail = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)
const isMobile = (v) => /^01[016789]\d{7,8}$/.test(v)
const sha256 = (v) => createHash('sha256').update(v).digest('hex')

function checkPassword(password, email) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 100) return '비밀번호는 10~100자로 정해 주세요.'
  if (/^\d+$/.test(password) || /^(.)\1+$/.test(password)) return '숫자만 쓰거나 같은 글자만 반복한 비밀번호는 쓸 수 없어요.'
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) return '이메일 아이디가 들어간 비밀번호는 쓸 수 없어요.'
  return null
}

function startSession(res, customer) {
  const token = signToken({ kind: 'customer', id: customer.id, sv: customer.session_version, exp: Date.now() + SESSION_DAYS * 86_400_000 })
  setCookie(res, COOKIE, token, SESSION_DAYS * 86_400)
}

// 로그인한 손님 (없거나, 비밀번호를 바꿔 예전 로그인이 끊겼거나, 탈퇴했으면 null)
export async function currentCustomer(req) {
  let payload = null
  try {
    payload = verifyToken(readCookie(req, COOKIE))
  } catch {
    return null
  }
  if (payload?.kind !== 'customer') return null
  const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL', [payload.id])
  return rows[0] && rows[0].session_version === payload.sv ? rows[0] : null
}

async function requireCustomer(req, res, next) {
  const customer = await currentCustomer(req)
  if (!customer) return res.status(401).json({ error: '로그인이 필요해요.' })
  req.customer = customer
  next()
}

const me = (c) => ({ email: c.email, name: c.name, phone: c.phone, zipcode: c.zipcode, address1: c.address1, address2: c.address2 })

export const accountRouter = express.Router()
const tooManySignups = createLimiter({ limit: 5, windowMs: 60 * 60_000 })
const tooManyResets = createLimiter({ limit: 5, windowMs: 60 * 60_000 })

accountRouter.post('/signup', async (req, res) => {
  const email = text(req.body.email).toLowerCase()
  const name = text(req.body.name)
  const phone = digits(req.body.phone)
  const errors = []
  if (!isEmail(email)) errors.push('이메일을 확인해 주세요.')
  const weak = checkPassword(req.body.password, email)
  if (weak) errors.push(weak)
  if (!name || name.length > 20) errors.push('이름을 20자 안으로 적어 주세요.')
  if (!isMobile(phone)) errors.push('휴대폰 번호를 확인해 주세요.')
  const sensitive = findSensitive(name)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (req.body.agreeTerms !== true || req.body.agreePrivacy !== true) errors.push('이용약관과 개인정보 수집·이용에 동의해 주세요.')
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooManySignups(req)) return res.status(429).json({ error: '가입 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  const { rows } = await pool.query(
    `INSERT INTO customers (email, password_hash, name, phone, agreed_at, last_login_at) VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    [email, await hashPassword(req.body.password), name, phone],
  )
  if (!rows.length) return res.status(409).json({ error: '이미 가입한 이메일이에요. 로그인하거나 비밀번호 찾기를 해 주세요.' })
  startSession(res, rows[0])
  console.log(`[account] 회원 가입 #${rows[0].id}`)
  queueMail({ kind: 'welcome', to: email, subject: '가입을 환영해요', body: `${name}님, 가입해 주셔서 고마워요.\n\n마이페이지에서 주문 내역과 배송지를 관리할 수 있어요.\n${publicUrl()}/account\n` })
  res.status(201).json(me(rows[0]))
})

accountRouter.post('/login', async (req, res) => {
  const email = text(req.body.email).toLowerCase().slice(0, 254)
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : ''
  const key = `c:${email}`
  if (isLocked(key, req.ip)) return res.status(429).json({ error: '로그인을 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요.' })
  const { rows } = await pool.query('SELECT * FROM customers WHERE email = $1 AND deleted_at IS NULL', [email])
  if (!rows.length || !(await verifyPassword(password, rows[0].password_hash))) {
    noteFail(key, req.ip)
    return res.status(401).json({ error: '이메일 또는 비밀번호가 맞지 않아요.' })
  }
  clearFails(key)
  await pool.query('UPDATE customers SET last_login_at = now() WHERE id = $1', [rows[0].id])
  startSession(res, rows[0])
  res.json(me(rows[0]))
})

accountRouter.post('/logout', (req, res) => {
  setCookie(res, COOKIE, '', 0)
  res.status(204).end()
})

accountRouter.get('/me', requireCustomer, (req, res) => res.json(me(req.customer)))

accountRouter.patch('/me', requireCustomer, async (req, res) => {
  const name = text(req.body.name ?? req.customer.name)
  const phone = digits(req.body.phone ?? req.customer.phone)
  const zipcode = text(req.body.zipcode ?? req.customer.zipcode ?? '')
  const address1 = text(req.body.address1 ?? req.customer.address1 ?? '')
  const address2 = text(req.body.address2 ?? req.customer.address2 ?? '')
  const errors = []
  if (!name || name.length > 20) errors.push('이름을 20자 안으로 적어 주세요.')
  if (!isMobile(phone)) errors.push('휴대폰 번호를 확인해 주세요.')
  if (zipcode && !/^\d{5}$/.test(zipcode)) errors.push('우편번호 5자리를 넣어 주세요.')
  if (address1.length > 100 || address2.length > 60) errors.push('주소가 너무 길어요.')
  const sensitive = findSensitive(name, address1, address2)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  const { rows } = await pool.query(
    'UPDATE customers SET name = $2, phone = $3, zipcode = $4, address1 = $5, address2 = $6 WHERE id = $1 RETURNING *',
    [req.customer.id, name, phone, zipcode || null, address1 || null, address2 || null],
  )
  res.json(me(rows[0]))
})

// 비밀번호 변경: 지금 비밀번호 확인 → 바꾸면 다른 기기의 로그인은 모두 끊긴다
accountRouter.post('/password', requireCustomer, async (req, res) => {
  if (!(await verifyPassword(String(req.body.current ?? ''), req.customer.password_hash))) {
    noteFail(`c:${req.customer.email}`, req.ip)
    return res.status(401).json({ error: '지금 비밀번호가 맞지 않아요.' })
  }
  const weak = checkPassword(req.body.next, req.customer.email)
  if (weak) return res.status(400).json({ error: weak })
  const { rows } = await pool.query(
    'UPDATE customers SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING *',
    [req.customer.id, await hashPassword(req.body.next)],
  )
  startSession(res, rows[0])
  queueMail({ kind: 'password_changed', to: rows[0].email, subject: '비밀번호가 바뀌었어요', body: '방금 계정 비밀번호가 바뀌었어요. 직접 바꾼 게 아니라면 바로 비밀번호 찾기로 다시 정하고 고객센터에 알려 주세요.\n' })
  res.status(204).end()
})

// 탈퇴: 비밀번호 확인 → 계정 개인정보를 지운다. 주문 기록은 전자상거래법에 따라 5년 보관(주문에 담긴 배송 정보만)
accountRouter.delete('/me', requireCustomer, async (req, res) => {
  if (!(await verifyPassword(String(req.body.password ?? ''), req.customer.password_hash))) {
    return res.status(401).json({ error: '비밀번호가 맞지 않아요.' })
  }
  await pool.query(
    `UPDATE customers SET email = $2, name = '탈퇴 회원', phone = '', zipcode = NULL, address1 = NULL, address2 = NULL,
       password_hash = $3, session_version = session_version + 1, deleted_at = now() WHERE id = $1`,
    [req.customer.id, `deleted-${req.customer.id}-${randomBytes(4).toString('hex')}@invalid`, `deleted:${randomBytes(16).toString('hex')}`],
  )
  await pool.query('DELETE FROM password_resets WHERE customer_id = $1', [req.customer.id])
  setCookie(res, COOKIE, '', 0)
  console.log(`[account] 회원 탈퇴 #${req.customer.id}`)
  res.status(204).end()
})

// 비밀번호 찾기: 가입 여부와 관계없이 같은 답을 준다 (이메일로 가입 여부를 알아내지 못하게)
accountRouter.post('/password-reset/request', async (req, res) => {
  const email = text(req.body.email).toLowerCase()
  if (!isEmail(email)) return res.status(400).json({ error: '이메일을 확인해 주세요.' })
  if (tooManyResets(req)) return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  const { rows } = await pool.query('SELECT id, name FROM customers WHERE email = $1 AND deleted_at IS NULL', [email])
  if (rows.length) {
    const token = randomBytes(32).toString('base64url')
    await pool.query('DELETE FROM password_resets WHERE customer_id = $1', [rows[0].id])
    await pool.query("INSERT INTO password_resets (token_hash, customer_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')", [sha256(token), rows[0].id])
    queueMail({
      kind: 'password_reset', to: email, subject: '비밀번호 다시 정하기',
      body: `${rows[0].name}님, 아래 링크에서 30분 안에 새 비밀번호를 정해 주세요.\n${publicUrl()}/account/reset?token=${token}\n\n직접 요청하지 않았다면 이 메일은 무시해도 돼요.\n`,
    })
  }
  res.json({ message: '가입한 이메일이라면 비밀번호를 다시 정하는 링크를 보냈어요. 메일함을 확인해 주세요.' })
})

accountRouter.post('/password-reset/confirm', async (req, res) => {
  const token = text(req.body.token)
  const { rows } = await pool.query(
    `UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING customer_id`,
    [sha256(token)],
  )
  if (!rows.length) return res.status(400).json({ error: '링크가 만료됐거나 이미 썼어요. 비밀번호 찾기를 다시 해 주세요.' })
  const customer = (await pool.query('SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL', [rows[0].customer_id])).rows[0]
  if (!customer) return res.status(400).json({ error: '계정을 찾지 못했어요.' })
  const weak = checkPassword(req.body.password, customer.email)
  if (weak) {
    await pool.query('UPDATE password_resets SET used_at = NULL WHERE token_hash = $1', [sha256(token)]) // 비밀번호만 다시 정하면 되게
    return res.status(400).json({ error: weak })
  }
  const { rows: updated } = await pool.query(
    'UPDATE customers SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING *',
    [customer.id, await hashPassword(req.body.password)],
  )
  clearFails(`c:${customer.email}`)
  startSession(res, updated[0])
  res.json(me(updated[0]))
})

// ---------- 내 주문 ----------
accountRouter.get('/orders', requireCustomer, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.order_no, o.status, o.total_amount, o.created_at, o.courier, o.tracking_no,
           (SELECT string_agg(oi.name || ' ×' || oi.quantity, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id) AS summary
    FROM orders o WHERE o.customer_id = $1 AND o.status NOT IN ('pending', 'failed', 'expired')
    ORDER BY o.created_at DESC LIMIT 100`, [req.customer.id])
  res.json(rows)
})

export { requireCustomer }
