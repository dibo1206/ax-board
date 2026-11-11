// 관리자 계정 관리 (2026-11-08): 서버 명령어(npm run create-admin · admin-2fa) 없이 관리자 화면 [관리자 계정]에서
//  - 내 비밀번호 바꾸기 · 내 2단계 인증(인증 앱) 등록·해제
//  - 관리자 추가 · 다른 관리자의 비밀번호 다시 정하기 · 2단계 인증 풀기(휴대폰을 잃어버렸을 때) · 계정 지우기
// 계정에 손대는 일은 모두 "내 비밀번호"를 한 번 더 받는다(자리를 비운 사이 다른 사람이 못 하게). 틀리면 로그인과 같은 잠금 규칙.
// 비밀번호·2단계 인증이 바뀐 계정은 session_version 을 올려서 이미 로그인한 곳도 바로 끊긴다 (내 것이면 이 브라우저는 새 쿠키로 이어 간다)
import express from 'express'
import { writeAccessLog } from './accessLog.js'
import { hashPassword, issueStaffSession, passwordMatches, requireAdmin, reserveAttempt, signToken, twoFactorRequired, undoAttempt, verifyToken } from './auth.js'
import { decrypt, encrypt, newTotpSecret, otpauthUri, verifyTotp } from './crypto.js'
import { pool } from './db.js'

const LOGIN_ID = /^[a-z0-9_]{3,20}$/
// 2단계 인증을 처음 등록할 수 있는 기간 (계정을 만들거나 등록을 다시 연 뒤). server/auth.js 의 login 참고
const ENROLL_WINDOW = "now() + interval '3 days'"

// 새 비밀번호 규칙: 10자 이상, 영문·숫자·기호 중 두 가지 이상, 아이디가 들어가면 안 됨
export function passwordProblem(password, loginId) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return '비밀번호는 10자 이상으로 정해 주세요.'
  const kinds = [/[A-Za-z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  if (kinds < 2) return '비밀번호에 영문·숫자·기호 중 두 가지 이상을 섞어 주세요.'
  if (loginId && password.toLowerCase().includes(loginId.toLowerCase())) return '비밀번호에 아이디를 넣지 말아 주세요.'
  return null
}

// 내 비밀번호 다시 확인 (틀리면 로그인 잠금과 같은 규칙으로 센다)
export async function confirmMe(req, res) {
  const password = typeof req.body?.myPassword === 'string' ? req.body.myPassword.slice(0, 200) : ''
  const key = `reauth:${req.admin.loginId}`
  if (!reserveAttempt(key, req.ip)) {
    res.status(429).json({ error: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.' })
    return null
  }
  const { rows } = await pool.query('SELECT * FROM admins WHERE id = $1', [req.admin.id])
  if (!(await passwordMatches(password, rows[0]?.password_hash))) {
    writeAccessLog({ loginId: req.admin.loginId, role: 'admin', action: 'reauth_fail', ip: req.ip })
    res.status(401).json({ error: '내 비밀번호가 맞지 않아요.' })
    return null
  }
  undoAttempt(key, req.ip)
  return rows[0]
}

const log = (req, action, target) => writeAccessLog({ loginId: req.admin.loginId, role: 'admin', action, path: target ? `account:${target}` : null, ip: req.ip })

export const adminStaffRouter = express.Router()
adminStaffRouter.use(requireAdmin)

// 관리자 목록 (판매자 계정은 [판매자 승인]에서)
adminStaffRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.id, a.login_id, a.created_at, a.totp_secret_enc IS NOT NULL AS mfa,
      (SELECT max(created_at) FROM access_logs l WHERE l.login_id = a.login_id AND l.action = 'login_ok') AS last_login
    FROM admins a WHERE a.role = 'admin' ORDER BY a.created_at`)
  res.json({ me: req.admin.id, twoFactorRequired: twoFactorRequired(), accounts: rows })
})

// 관리자 추가 {loginId, password, myPassword}
adminStaffRouter.post('/', async (req, res) => {
  const loginId = typeof req.body?.loginId === 'string' ? req.body.loginId.trim().toLowerCase() : ''
  if (!LOGIN_ID.test(loginId)) return res.status(400).json({ error: '아이디는 영문 소문자·숫자·밑줄 3~20자로 정해 주세요.' })
  const problem = passwordProblem(req.body?.password, loginId)
  if (problem) return res.status(400).json({ error: problem })
  if (!(await confirmMe(req, res))) return
  const hash = await hashPassword(req.body.password)
  const { rowCount } = await pool.query(`INSERT INTO admins (login_id, password_hash, role, totp_enroll_until) VALUES ($1, $2, 'admin', ${ENROLL_WINDOW}) ON CONFLICT (login_id) DO NOTHING`, [loginId, hash])
  if (!rowCount) return res.status(409).json({ error: '이미 있는 아이디예요.' })
  log(req, 'staff_add', loginId)
  console.log(`[staff] ${req.admin.loginId} 관리자 ${loginId} 추가`)
  res.status(201).json({ loginId })
})

// 내 비밀번호 바꾸기 {myPassword, password}
adminStaffRouter.post('/me/password', async (req, res) => {
  const problem = passwordProblem(req.body?.password, req.admin.loginId)
  if (problem) return res.status(400).json({ error: problem })
  const me = await confirmMe(req, res)
  if (!me) return
  if (await passwordMatches(req.body.password, me.password_hash)) return res.status(400).json({ error: '지금 비밀번호와 다른 비밀번호로 정해 주세요.' })
  const { rows } = await pool.query('UPDATE admins SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING *', [me.id, await hashPassword(req.body.password)])
  issueStaffSession(res, rows[0]) // 다른 곳의 로그인은 끊기고 이 브라우저는 이어서
  log(req, 'password_change', me.login_id)
  res.json({ ok: true })
})

// 내 2단계 인증 등록 1) 비밀값 만들기 {myPassword, code?} → 키와 확인용 표(10분)
// 이미 등록돼 있으면 지금 인증 앱의 코드도 받는다: 비밀번호와 켜 둔 화면만으로 인증 앱을 바꿔치기 못 하게 (휴대폰을 잃어버렸으면 다른 관리자가 풀어 준다)
adminStaffRouter.post('/me/2fa/start', async (req, res) => {
  const me = await confirmMe(req, res)
  if (!me) return
  if (me.totp_secret_enc) {
    const used = verifyTotp(decrypt(me.totp_secret_enc), String(req.body?.code ?? '').replace(/\s/g, ''), Number(me.totp_last_counter))
    if (used === null) return res.status(400).json({ error: '지금 쓰는 인증 앱의 6자리 코드가 맞지 않아요. 휴대폰을 잃어버렸으면 다른 관리자에게 풀어 달라고 해 주세요.' })
    await pool.query('UPDATE admins SET totp_last_counter = $2 WHERE id = $1', [me.id, used])
  }
  const secret = newTotpSecret()
  const setup = signToken({ kind: 'totp_setup', id: me.id, sealed: encrypt(secret), exp: Date.now() + 10 * 60_000 })
  res.set('Cache-Control', 'no-store')
  res.json({ key: secret.match(/.{1,4}/g).join(' '), uri: otpauthUri(me.login_id, secret), setup })
})

// 2) 인증 앱의 6자리 코드로 확인 {setup, code} → 저장
adminStaffRouter.post('/me/2fa/confirm', async (req, res) => {
  const token = verifyToken(typeof req.body?.setup === 'string' ? req.body.setup : '')
  if (token?.kind !== 'totp_setup' || token.id !== req.admin.id) return res.status(400).json({ error: '등록 시간이 지났어요. 처음부터 다시 해 주세요.' })
  const secret = decrypt(token.sealed)
  const counter = verifyTotp(secret, String(req.body?.code ?? '').replace(/\s/g, ''))
  if (counter === null) return res.status(400).json({ error: '코드가 맞지 않아요. 휴대폰 시간이 자동으로 맞춰져 있는지 보고, 새 코드로 다시 넣어 주세요.' })
  const { rows } = await pool.query(
    'UPDATE admins SET totp_secret_enc = $2, totp_last_counter = $3, totp_enroll_until = NULL, session_version = session_version + 1 WHERE id = $1 RETURNING *',
    [req.admin.id, encrypt(secret), counter],
  )
  issueStaffSession(res, rows[0])
  log(req, '2fa_on', req.admin.loginId)
  res.json({ ok: true })
})

// 내 2단계 인증 해제 {myPassword, code}. 2단계 인증이 필수인 서버에서는 해제할 수 없다
adminStaffRouter.post('/me/2fa/off', async (req, res) => {
  if (twoFactorRequired()) return res.status(400).json({ error: '이 서버는 2단계 인증이 필수라 해제할 수 없어요. 휴대폰을 바꿨다면 다시 등록해 주세요.' })
  const me = await confirmMe(req, res)
  if (!me) return
  if (me.totp_secret_enc && verifyTotp(decrypt(me.totp_secret_enc), String(req.body?.code ?? '').replace(/\s/g, ''), Number(me.totp_last_counter)) === null) {
    return res.status(400).json({ error: '인증 앱의 6자리 코드가 맞지 않아요.' })
  }
  const { rows } = await pool.query('UPDATE admins SET totp_secret_enc = NULL, totp_last_counter = 0, session_version = session_version + 1 WHERE id = $1 RETURNING *', [me.id])
  issueStaffSession(res, rows[0])
  log(req, '2fa_off', me.login_id)
  res.json({ ok: true })
})

// 다른 관리자 계정 찾기 (나 자신·판매자는 여기서 다루지 않는다)
async function other(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) { res.status(404).json({ error: '계정을 찾지 못했어요.' }); return null }
  if (id === req.admin.id) { res.status(400).json({ error: '내 계정은 위의 [내 계정]에서 바꿔 주세요.' }); return null }
  const { rows } = await pool.query("SELECT id, login_id FROM admins WHERE id = $1 AND role = 'admin'", [id])
  if (!rows.length) { res.status(404).json({ error: '계정을 찾지 못했어요.' }); return null }
  return rows[0]
}

// 다른 관리자 비밀번호 다시 정하기 {myPassword, password} (그 사람의 로그인은 끊긴다. 새 비밀번호는 직접 전해 주고 바꾸게 한다)
adminStaffRouter.post('/:id/password', async (req, res) => {
  const target = await other(req, res)
  if (!target) return
  const problem = passwordProblem(req.body?.password, target.login_id)
  if (problem) return res.status(400).json({ error: problem })
  if (!(await confirmMe(req, res))) return
  await pool.query(`UPDATE admins SET password_hash = $2, session_version = session_version + 1, totp_enroll_until = CASE WHEN totp_secret_enc IS NULL THEN ${ENROLL_WINDOW} ELSE NULL END WHERE id = $1`, [target.id, await hashPassword(req.body.password)])
  log(req, 'staff_password_reset', target.login_id)
  res.json({ ok: true })
})

// 다른 관리자의 2단계 인증 풀기·등록 다시 열기 {myPassword} (휴대폰을 잃어버렸을 때, 등록 기간이 지났을 때. 그 사람은 3일 안에 다시 등록한다)
adminStaffRouter.post('/:id/2fa/reset', async (req, res) => {
  const target = await other(req, res)
  if (!target) return
  if (!(await confirmMe(req, res))) return
  await pool.query(`UPDATE admins SET totp_secret_enc = NULL, totp_last_counter = 0, totp_enroll_until = ${ENROLL_WINDOW}, session_version = session_version + 1 WHERE id = $1`, [target.id])
  log(req, 'staff_2fa_reset', target.login_id)
  res.json({ ok: true })
})

// 관리자 계정 지우기 {myPassword}. 내 계정·마지막 관리자는 지울 수 없다
adminStaffRouter.post('/:id/delete', async (req, res) => {
  const target = await other(req, res)
  if (!target) return
  if (!(await confirmMe(req, res))) return
  const { rowCount } = await pool.query(
    "DELETE FROM admins WHERE id = $1 AND role = 'admin' AND (SELECT count(*) FROM admins WHERE role = 'admin') > 1",
    [target.id],
  )
  if (!rowCount) return res.status(409).json({ error: '마지막 관리자는 지울 수 없어요.' })
  log(req, 'staff_delete', target.login_id)
  console.log(`[staff] ${req.admin.loginId} 관리자 ${target.login_id} 삭제`)
  res.status(204).end()
})
