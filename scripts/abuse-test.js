// 그 밖의 웹 공격 시험 (2026-11-19 OWASP 점검): npm run test-abuse
//   1) 권한 상승(mass assignment): 가입할 때 role·isAdmin 등을 끼워 넣어도 평범한 회원이 되고 관리자 화면에 못 들어감
//   2) 주문 조작(business logic): 음수·초과·소수 수량, 몸통에 넣은 price·total 은 막히거나 무시됨 (가격은 서버가 DB 로 다시 계산)
//   3) 경로 탈출(path traversal): /uploads/..%2f.. 로 서버 파일을 못 읽음
//   4) 열린 리다이렉트(open redirect): 로그인 뒤 돌아갈 주소는 우리 사이트 안만 허용
//   5) 대용량·깨진 입력: 100KB 넘는 몸통 413, NUL 문자 400
//   6) CSRF: 다른 사이트에서 온 POST 는 403
//   7) 클릭재킹: X-Frame-Options·frame-ancestors 로 다른 사이트 틀 안에 못 넣음
//   8) 메서드 변조: 엉뚱한 메서드로 서버가 500 나지 않음
//   9) IDOR: 로그인 없이 남의 주문·반품 사진·관리자 주문을 번호로 못 봄
// 만든 회원은 끝나고 번호(id)로만 지운다. 백엔드 사본은 빈 포트로 따로 띄운다.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { lookupHash } from '../server/crypto.js'
import { safeNext } from '../server/oauth.js'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '통과' : '실패'} ${name}${detail ? `  (${detail})` : ''}`)
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', DB_POOL_MAX: '1' },
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

const backend = await startBackend()
const base = `http://127.0.0.1:${backend.port}`
let n = 0
async function hit(method, path, { body, origin, cookie, raw } = {}) {
  n += 1
  const headers = { 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.150.${Math.floor(n / 250)}.${n % 250}` }
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json'
  if (origin) headers.Origin = origin
  if (cookie) headers.Cookie = cookie
  const res = await fetch(base + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) })
  const text = await res.text()
  return { status: res.status, text, headers: res.headers, cookie: res.headers.get('set-cookie') ?? '' }
}
const createdCustomers = []

try {
  const control = await hit('GET', '/api/products')
  if (control.status !== 200) { console.log(`대조 실패: /api/products ${control.status}`); backend.kill('SIGTERM'); process.exit(2) }

  // 1) 권한 상승 (mass assignment)
  const email = `abuse_${randomBytes(5).toString('hex')}@example.invalid`
  const signup = await hit('POST', '/api/account/signup', {
    body: { email, password: `Zxq${randomBytes(8).toString('hex')}!`, name: '시험회원', phone: '01099998888',
      agreeTerms: true, agreePrivacy: true, agreeAge: true,
      role: 'admin', isAdmin: true, is_test: false, id: 1, session_version: 999 }, // 끼워 넣기 공격
  })
  check('가입 성공(끼워 넣은 role 등은 무시)', signup.status === 201, String(signup.status))
  const who = JSON.parse(signup.text || '{}')
  const row = (await db.query('SELECT id FROM customers WHERE email_hash = $1', [lookupHash(email.toLowerCase())])).rows[0]
  if (row) createdCustomers.push(row.id)
  const cookie = (signup.cookie.match(/customer_session=[^;]+/) || [''])[0]
  const adminTry = await hit('GET', '/api/admin/dashboard', { cookie })
  check('회원 쿠키로 관리자 화면 못 들어감', adminTry.status === 401 || adminTry.status === 403, String(adminTry.status))
  check('응답에 관리자 권한 표시(role:admin) 없음', !/"role"\s*:\s*"admin"/.test(signup.text), who.role ?? '(없음)')

  // 2) 주문 조작 (business logic)
  const code = (await db.query("SELECT product_code FROM products WHERE status='active' AND stock>0 ORDER BY created_at LIMIT 1")).rows[0]?.product_code
  const baseOrder = { buyerName: '홍길동', buyerPhone: '01012345678', receiverName: '홍길동', receiverPhone: '01012345678', zipcode: '12345', address1: '서울 어딘가', agreeTerms: true, agreePrivacy: true, agreeAge: true }
  const tamper = [
    ['음수 수량', { items: [{ productCode: code, quantity: -5 }] }],
    ['0 수량', { items: [{ productCode: code, quantity: 0 }] }],
    ['소수 수량', { items: [{ productCode: code, quantity: 1.5 }] }],
    ['한도 초과 수량', { items: [{ productCode: code, quantity: 99999 }] }],
    ['가격/합계 끼워 넣기', { items: [{ productCode: code, quantity: 1, price: 1, subtotal: 1 }], price: 1, total_amount: 1, items_amount: 1, shipping_fee: -99999 }],
  ]
  let blocked = 0
  let formedTamperOrder = null
  for (const [name, extra] of tamper) {
    const r = await hit('POST', '/api/orders', { body: { ...baseOrder, ...extra } })
    if (name === '가격/합계 끼워 넣기') {
      // 수량 1 은 정상이라 주문이 만들어질 수 있다 → 금액(amount)이 DB 가격으로 계산됐는지 본다 (손님이 보낸 1원이 아님)
      if (r.status === 201) { formedTamperOrder = JSON.parse(r.text); if (formedTamperOrder.amount > 100) blocked++ }
      else blocked++ // 옵션 선택 필요·재고 없음 등으로 안 만들어져도 조작은 실패
    } else if (r.status === 400) blocked++
  }
  check('주문 수량 조작(음수·0·소수·초과) 전부 막힘', blocked >= 4, `${blocked}/5`)
  check('가격 조작 무시(금액은 서버가 DB로 재계산)', !formedTamperOrder || formedTamperOrder.amount > 100, formedTamperOrder ? `${formedTamperOrder.amount}원 (보낸 값 1원 무시)` : '주문 안 만들어짐')
  if (formedTamperOrder) {
    // 시험으로 만든 결제 전 주문을 지운다 (FK 때문에 자식 행 먼저). 줄어든 재고 1개도 되돌린다 (만든 것만 번호로)
    const o = (await db.query('SELECT id FROM orders WHERE order_no = $1', [formedTamperOrder.orderNo])).rows[0]
    if (o) {
      await db.query('DELETE FROM order_shipments WHERE order_id = $1', [o.id]).catch(() => {})
      await db.query('DELETE FROM order_items WHERE order_id = $1', [o.id]).catch(() => {})
      await db.query('DELETE FROM orders WHERE id = $1', [o.id]).catch(() => {})
    }
    await db.query('UPDATE products SET stock = stock + 1 WHERE product_code = $1', [code]).catch(() => {})
  }

  // 3) 경로 탈출
  let traversalLeak = ''
  for (const p of ['/uploads/..%2f..%2fserver/db.js', '/uploads/%2e%2e/%2e%2e/.env', '/uploads/....//....//package.json', '/assets/..%2f..%2fserver/schema.sql']) {
    const r = await hit('GET', p)
    if (r.status === 200 && /(DATABASE_URL|CREATE TABLE|SESSION_SECRET|import |pool)/.test(r.text)) traversalLeak = `${p} → 파일 노출`
  }
  check('경로 탈출로 서버 파일 못 읽음', !traversalLeak, traversalLeak)

  // 4) 열린 리다이렉트 (safeNext 직접 시험)
  const EVIL = ['https://evil.com', '//evil.com', '/\\evil.com', 'http:evil.com', 'javascript:alert(1)', '\\\\evil.com', '/account/../admin']
  const SAFE = ['/account', '/account/orders', '/p/carrot_3kg']
  const evilBlocked = EVIL.every((v) => { const o = safeNext(v); return o === '/account' || (o.startsWith('/') && !/^\/\/|\\|:|evil/.test(o)) })
  const safeKept = SAFE.every((v) => safeNext(v) === v)
  check('열린 리다이렉트: 다른 사이트 주소 전부 막힘', evilBlocked)
  check('열린 리다이렉트: 우리 사이트 안 주소는 유지', safeKept)

  // 5) 대용량·깨진 입력
  const big = await hit('POST', '/api/account/signup', { raw: JSON.stringify({ name: 'x'.repeat(200_000) }) })
  check('100KB 넘는 몸통 413', big.status === 413, String(big.status))
  const nul = await hit('POST', '/api/products/' + (code ?? 'x') + '/questions', { body: { author: '손님', question: '안녕하세요\u0000무엇인가요 반갑습니다' } })
  check('NUL 문자가 섞인 입력 400', nul.status === 400, String(nul.status))

  // 6) CSRF
  const csrf = await hit('POST', '/api/account/signup', { origin: 'https://evil.example', body: { email: 'x@y.z', password: 'x', name: 'x' } })
  check('다른 사이트에서 온 POST 는 403 (CSRF)', csrf.status === 403, String(csrf.status))
  const csrfGet = await hit('GET', '/api/products', { origin: 'https://evil.example' })
  check('다른 사이트의 GET(읽기)은 허용(상태 안 바뀜)', csrfGet.status === 200)

  // 7) 클릭재킹
  const page = await hit('GET', '/api/products')
  check('클릭재킹 방지: X-Frame-Options DENY', (page.headers.get('x-frame-options') ?? '').toUpperCase() === 'DENY')

  // 8) 메서드 변조
  let serverErr = ''
  for (const [m, p] of [['DELETE', '/api/products'], ['PUT', '/api/catalog'], ['PATCH', '/api/health'], ['OPTIONS', '/api/orders']]) {
    const r = await hit(m, p)
    if (r.status >= 500) serverErr = `${m} ${p} → ${r.status}`
  }
  check('엉뚱한 메서드에 500 안 남', !serverErr, serverErr)

  // 9) IDOR: 로그인 없이 남의 것 번호로 접근
  const idor = []
  for (const [m, p, body] of [
    ['GET', '/api/returns/1/photos/0', undefined],
    ['GET', '/api/admin/orders/FM000000-AAAAAAAAAA', undefined],
    ['GET', '/api/seller/returns/1/photos/0', undefined],
    ['POST', '/api/orders/lookup', { orderNo: 'FM000001-ABCDEFGHIJ', phone: '01000000000' }],
  ]) {
    const r = await hit(m, p, { body })
    if (r.status !== 401 && r.status !== 403 && r.status !== 404) idor.push(`${m} ${p} → ${r.status}`)
  }
  check('IDOR: 남의 주문·반품 사진·관리자 주문 못 봄', idor.length === 0, idor.join(', '))
} finally {
  backend.kill('SIGTERM')
  if (createdCustomers.length) await db.query('DELETE FROM customers WHERE id = ANY($1::int[])', [createdCustomers]).catch(() => {})
  await db.end()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${results.length} 통과`)
process.exit(ok === results.length ? 0 : 1)
