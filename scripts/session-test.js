// 관리자 로그인 보안 시험 (2026-11-19 OWASP 점검): npm run test-session
//  1) 관리자 쿠키: HttpOnly · SameSite=Strict
//  2) 보안 머리말: Permissions-Policy (카메라·마이크·위치 끔)
//  3) 세션 타임아웃: 마지막으로 쓴 지 2시간이 지난 쿠키는 401, 방금 쓴 쿠키는 통과
//  4) 로그인 잠금: 비밀번호를 계속 틀리면 429 + 계정 주인에게 잠금 알림(알림 기록)이 쌓인다
// 임시 관리자 계정을 만들고, 끝나면 만든 번호(id)로만 지운다. 백엔드 사본은 빈 포트로 따로 띄운다.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { hashPassword, signToken } from '../server/auth.js'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })
const loginId = `owasp_test_${randomBytes(4).toString('hex')}`
const password = `T${randomBytes(12).toString('hex')}!`
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '통과' : '실패'} ${name}${detail ? `  (${detail})` : ''}`)
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', DB_POOL_MAX: '1', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '', ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'owasp-test@example.invalid' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    const onData = (chunk) => {
      logs += chunk
      const m = logs.match(/\[server\] http:\/\/127\.0\.0\.1:(\d+)/)
      if (m && !child.port) { child.port = Number(m[1]); resolve(child) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', () => { if (!child.port) reject(new Error(`백엔드가 켜지지 않음: ${logs.slice(-500)}`)) })
  })
}

const created = (await db.query(`INSERT INTO admins (login_id, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, session_version`, [loginId, await hashPassword(password)])).rows[0]
const mailBefore = Number((await db.query('SELECT COALESCE(max(id), 0) AS id FROM email_outbox')).rows[0].id)
const logBefore = Number((await db.query('SELECT COALESCE(max(id), 0) AS id FROM access_logs')).rows[0].id)
const backend = await startBackend()
const base = `http://127.0.0.1:${backend.port}`
let n = 0
const call = (method, path, { body, cookie, ip } = {}) => {
  n += 1
  return fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': ip ?? `10.99.0.${n % 250}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

try {
  // 1) 로그인 쿠키
  const res = await call('POST', '/api/admin/login', { body: { loginId, password }, ip: '10.99.1.1' })
  const setCookie = res.headers.get('set-cookie') ?? ''
  check('관리자 로그인 성공', res.status === 200, String(res.status))
  check('쿠키 HttpOnly', /HttpOnly/i.test(setCookie))
  check('쿠키 SameSite=Strict', /SameSite=Strict/i.test(setCookie), setCookie.match(/SameSite=\w+/i)?.[0])
  const cookie = setCookie.split(';')[0]

  // 2) 보안 머리말
  const pp = res.headers.get('permissions-policy') ?? ''
  check('Permissions-Policy: 카메라·마이크·위치 끔', /camera=\(\)/.test(pp) && /microphone=\(\)/.test(pp) && /geolocation=\(\)/.test(pp))

  // 3) 세션 타임아웃
  check('방금 로그인한 쿠키로 관리자 API 통과', (await call('GET', '/api/admin/dashboard', { cookie })).status === 200)
  const base_ = { kind: 'staff', id: created.id, sv: created.session_version, loginId, role: 'admin', sellerCode: null, mfa: false, exp: Date.now() + 6 * 3_600_000 }
  const idle = `admin_session=${encodeURIComponent(signToken({ ...base_, seen: Date.now() - 121 * 60_000 }))}`
  const recent = `admin_session=${encodeURIComponent(signToken({ ...base_, seen: Date.now() - 30 * 60_000 }))}`
  check('2시간 넘게 안 쓴 쿠키는 401 (세션 타임아웃)', (await call('GET', '/api/admin/dashboard', { cookie: idle })).status === 401)
  const r30 = await call('GET', '/api/admin/dashboard', { cookie: recent })
  check('30분 전에 쓴 쿠키는 통과', r30.status === 200)
  check('쓰면 마지막으로 쓴 시각을 새로 적은 쿠키를 준다', /admin_session=/.test(r30.headers.get('set-cookie') ?? ''))

  // 4) 로그인 잠금 + 알림
  let last = 0
  for (let i = 0; i < 6; i++) last = (await call('POST', '/api/admin/login', { body: { loginId, password: 'wrong-password' }, ip: '10.99.2.2' })).status
  check('비밀번호 6번 틀리면 잠김 (429)', last === 429, String(last))
  await new Promise((r) => setTimeout(r, 1500)) // 알림은 응답 뒤에 쌓인다
  const mails = (await db.query("SELECT id FROM email_outbox WHERE id > $1 AND kind = 'security_login_locked'", [mailBefore])).rows
  check('잠금 알림이 알림 기록에 쌓임', mails.length === 1, `${mails.length}건`)
  for (let i = 0; i < 2; i++) await call('POST', '/api/admin/login', { body: { loginId, password: 'wrong-password' }, ip: '10.99.2.2' })
  await new Promise((r) => setTimeout(r, 800))
  const again = (await db.query("SELECT id FROM email_outbox WHERE id > $1 AND kind = 'security_login_locked'", [mailBefore])).rows
  check('잠긴 동안 다시 틀려도 알림은 한 번만', again.length === 1, `${again.length}건`)
} finally {
  backend.kill('SIGTERM')
  // 만든 것만 번호로 지운다
  const mails = (await db.query("SELECT id FROM email_outbox WHERE id > $1 AND kind = 'security_login_locked'", [mailBefore])).rows.map((r) => r.id)
  if (mails.length) await db.query('DELETE FROM email_outbox WHERE id = ANY($1::int[])', [mails])
  const logs = (await db.query('SELECT id FROM access_logs WHERE id > $1 AND login_id = $2', [logBefore, loginId])).rows.map((r) => r.id)
  if (logs.length) await db.query('DELETE FROM access_logs WHERE id = ANY($1::bigint[])', [logs])
  await db.query('DELETE FROM admins WHERE id = $1', [created.id])
  await db.end()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${results.length} 통과`)
process.exit(ok === results.length ? 0 : 1)
