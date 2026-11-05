// 통신이 끊기는 상황을 일부러 만들어 돈과 주문이 어긋나지 않는지 확인한다
//   npm run test-resilience
// 가짜 토스 결제 서버와 우리 백엔드 사본을 빈 포트에 따로 띄운다 (실제 결제·운영 중인 서버와 무관).
// 만든 시험 주문은 끝나면 지우고, 상품 재고가 시작 전과 같은지 확인한다.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import http from 'node:http'
import pg from 'pg'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm' })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- 가짜 토스 결제 서버 ----------
// paymentKey 앞부분으로 상황을 고른다: ok_ 정상, slow_ 승인 후 늦게 답함, drop_ 승인 후 연결 끊음,
// err500_ 승인 안 하고 500, reject_ 카드 거절, lookupdown_ 승인 후 늦게 답하고 조회도 안 됨,
// forged_ 이 주문의 결제가 아닌 키(주문번호만 아는 사람이 지어낸 키 — 토스는 결제 없음으로 거절)
const payments = new Map() // orderId → 결제
const idem = new Map() // Idempotency-Key → 첫 응답
let lookupDown = false

function done(orderId, paymentKey, amount) {
  const payment = { paymentKey, orderId, status: 'DONE', method: '카드', totalAmount: amount, approvedAt: new Date().toISOString() }
  payments.set(orderId, payment)
  return payment
}

const fake = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', async () => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    const key = req.headers['idempotency-key']
    if (key && idem.has(key)) return send(...idem.get(key)) // 같은 요청은 첫 응답 그대로 (토스 멱등키 동작)
    const remember = (status, body) => { if (key) idem.set(key, [status, body]); send(status, body) }
    const path = req.url.replace(/^\/v1\/payments/, '')
    if (req.method === 'GET' && path.startsWith('/orders/')) {
      if (lookupDown) return send(503, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: '조회 장애' })
      const found = payments.get(decodeURIComponent(path.slice('/orders/'.length)))
      return found ? send(200, found) : send(404, { code: 'NOT_FOUND_PAYMENT', message: '결제 없음' })
    }
    if (req.method === 'POST' && path.endsWith('/cancel')) {
      const found = [...payments.values()].find((p) => `/${p.paymentKey}/cancel` === path)
      if (found) found.status = 'CANCELED'
      return remember(200, { ...found, cancels: [{ canceledAt: new Date().toISOString() }] })
    }
    if (req.method === 'POST' && path === '/confirm') {
      const { paymentKey, orderId, amount } = JSON.parse(raw)
      if (paymentKey.startsWith('ok_')) return remember(200, done(orderId, paymentKey, amount))
      if (paymentKey.startsWith('reject_')) { // 토스처럼 거절된 결제도 조회하면 ABORTED로 남는다
        payments.set(orderId, { paymentKey, orderId, status: 'ABORTED', method: '카드', totalAmount: amount })
        return remember(400, { code: 'REJECT_CARD_PAYMENT', message: '한도 초과' })
      }
      if (paymentKey.startsWith('forged_')) return remember(404, { code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제 정보' })
      if (paymentKey.startsWith('err500_')) return remember(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: '일시 오류' })
      const payment = done(orderId, paymentKey, amount) // 아래는 모두 "토스에서는 승인됨"
      if (key) idem.set(key, [200, payment])
      if (paymentKey.startsWith('drop_')) return req.socket.destroy() // 승인했는데 답을 보내기 전에 연결이 끊김
      if (paymentKey.startsWith('lookupdown_')) lookupDown = true
      await sleep(Number(process.env.FAKE_DELAY_MS || 3000)) // 우리 서버의 시간 제한보다 늦게 답함
      return send(200, payment)
    }
    send(404, { code: 'NOT_FOUND', message: '없는 주소' })
  })
})
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
const FAKE = `http://127.0.0.1:${fake.address().port}/v1/payments`

// ---------- 우리 백엔드 사본 ----------
function startBackend(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      env: {
        ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', TOSS_API_BASE: FAKE, TOSS_TIMEOUT_MS: '1500', DB_POOL_MAX: '1',
        TOSS_CLIENT_KEY: 'test_gck_resilience', TOSS_SECRET_KEY: 'test_gsk_resilience', ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.logs = ''
    const onData = (chunk) => {
      child.logs += chunk
      const m = child.logs.match(/\[server\] http:\/\/127\.0\.0\.1:(\d+)/)
      if (m && !child.port) {
        child.port = Number(m[1])
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => { child.exitCode_ = code; if (!child.port) reject(new Error(`백엔드가 켜지지 않음: ${child.logs}`)) })
  })
}

let ip = 0
async function call(child, method, path, body, timeout = 20_000) {
  ip += 1
  const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.77.${Math.floor(ip / 250)}.${ip % 250}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  })
  return { status: response.status, data: await response.json().catch(() => null) }
}

const created = []
async function newOrder(child, productCode = 'carrot_3kg', quantity = 1) {
  const r = await call(child, 'POST', '/orders', {
    items: [{ productCode, quantity }], buyerName: '복원시험', buyerPhone: '01077770000', receiverName: '복원시험',
    receiverPhone: '01077770000', zipcode: '31066', address1: '시험로 1', agreeTerms: true, agreePrivacy: true,
  })
  if (r.status !== 201) throw new Error(`주문 생성 실패 ${r.status} ${JSON.stringify(r.data)}`)
  created.push(r.data.orderNo)
  return r.data
}
const orderRow = async (orderNo) => (await db.query('SELECT status, payment_key, fail_reason FROM orders WHERE order_no = $1', [orderNo])).rows[0]
const stock = async (code) => (await db.query('SELECT stock FROM products WHERE product_code = $1', [code])).rows[0].stock
const confirm = (child, order, paymentKey) => call(child, 'POST', `/orders/${order.orderNo}/confirm`, { paymentKey: paymentKey + order.orderNo, amount: order.amount })

const before = (await db.query("SELECT string_agg(product_code || '=' || stock, ',' ORDER BY product_code) AS s FROM products")).rows[0].s
let child
try {
  child = await startBackend()
  console.log(`가짜 결제 서버 ${FAKE} · 백엔드 사본 127.0.0.1:${child.port}\n`)

  // 1. 정상
  let o = await newOrder(child)
  let r = await confirm(child, o, 'ok_')
  check('정상 결제', r.status === 200 && (await orderRow(o.orderNo)).status === 'paid')
  const leaked = ['buyer_name', 'buyer_phone', 'buyer_email', 'receiver_name', 'receiver_phone', 'zipcode', 'address1', 'address2', 'memo'].filter((k) => k in (r.data ?? {}))
  check('결제 승인 응답에 이름·연락처·주소 없음', r.status === 200 && !leaked.length, leaked.join(', '))

  // 2. 승인됐는데 답이 시간 초과로 안 옴 → 조회로 확인해 결제 완료
  o = await newOrder(child)
  r = await confirm(child, o, 'slow_')
  check('승인 후 응답 시간 초과 → 조회로 결제 완료', r.status === 200 && (await orderRow(o.orderNo)).status === 'paid', `응답 ${r.status}`)

  // 3. 승인됐는데 답을 받는 중 연결이 끊김 → 조회로 결제 완료
  o = await newOrder(child)
  r = await confirm(child, o, 'drop_')
  check('승인 후 연결 끊김 → 조회로 결제 완료', r.status === 200 && (await orderRow(o.orderNo)).status === 'paid', `응답 ${r.status}`)

  // 4. 카드 거절(확실한 실패) → 실패·재고 복구
  let s0 = await stock('carrot_3kg')
  o = await newOrder(child)
  r = await confirm(child, o, 'reject_')
  check('카드 거절 → 주문 실패, 재고 복구', r.status === 402 && (await orderRow(o.orderNo)).status === 'failed' && (await stock('carrot_3kg')) === s0)

  // 4-1. 주문번호만 아는 사람이 남의 결제 전 주문을 닫으려 함 (지어낸 결제키, 틀린 금액, 결제용 표 없는 실패 처리)
  //      → 주문은 그대로 결제 전이고 재고도 잡혀 있어서, 주인은 그대로 결제할 수 있다
  s0 = await stock('carrot_3kg')
  o = await newOrder(child)
  const forged = await confirm(child, o, 'forged_')
  const wrongAmount = await call(child, 'POST', `/orders/${o.orderNo}/confirm`, { paymentKey: `ok_${o.orderNo}`, amount: o.amount + 1000 })
  const noToken = await call(child, 'POST', `/orders/${o.orderNo}/fail`, { code: 'PAY_PROCESS_CANCELED' })
  const stillPending = (await orderRow(o.orderNo)).status === 'pending' && (await stock('carrot_3kg')) === s0 - 1
  r = await confirm(child, o, 'ok_')
  check('주문번호만으로는 남의 주문을 못 닫음 → 주인은 그대로 결제', forged.status === 402 && wrongAmount.status === 400 && noToken.status === 403 && stillPending
    && r.status === 200 && (await orderRow(o.orderNo)).status === 'paid', `지어낸 키 ${forged.status}, 틀린 금액 ${wrongAmount.status}, 표 없는 실패 ${noToken.status}, 결제 ${r.status}`)

  // 4-2. 결제창에서 취소하고 돌아옴 (주문을 만든 화면의 결제용 표) → 바로 실패·재고 복구
  s0 = await stock('carrot_3kg')
  o = await newOrder(child)
  r = await call(child, 'POST', `/orders/${o.orderNo}/fail`, { code: 'PAY_PROCESS_CANCELED', token: o.payToken })
  check('결제창 취소 → 결제용 표로 실패 처리, 재고 복구', r.status === 204 && (await orderRow(o.orderNo)).status === 'failed' && (await stock('carrot_3kg')) === s0)

  // 5. 결제사 500(결과 모름) + 조회해도 결제 없음 → 실패로 단정하지 않고 기다림 → 30분 정리 때 만료·재고 복구
  s0 = await stock('carrot_3kg')
  o = await newOrder(child)
  r = await confirm(child, o, 'err500_')
  const waited = r.status === 202 && r.data?.pending && (await orderRow(o.orderNo)).status === 'pending'
  await db.query("UPDATE orders SET created_at = now() - interval '31 minutes' WHERE order_no = $1", [o.orderNo])
  await newOrder(child, 'potato_5kg') // 주문을 만들 때 오래된 결제 전 주문을 정리한다 (옵션 없는 상품으로)
  check('결제사 오류(결과 모름) → 기다렸다가 30분 정리 때 만료·재고 복구', waited && (await orderRow(o.orderNo)).status === 'expired' && (await stock('carrot_3kg')) === s0,
    `처음 응답 ${r.status}`)

  // 6. 승인됐는데 답도 안 오고 조회도 장애 → "확인 중"(202), 장애가 풀린 뒤 [다시 확인] → 결제 완료 (돈 두 번 안 나감)
  o = await newOrder(child)
  r = await confirm(child, o, 'lookupdown_')
  const first = r.status
  lookupDown = false
  r = await confirm(child, o, 'lookupdown_')
  const paidCount = [...payments.values()].filter((p) => p.orderId === o.orderNo).length
  check('승인 응답·조회 모두 장애 → 확인 중, 다시 확인하면 결제 완료', first === 202 && r.status === 200 && (await orderRow(o.orderNo)).status === 'paid' && paidCount === 1,
    `처음 ${first} → 다시 ${r.status}, 토스 결제 ${paidCount}건`)

  // 7. 서버가 승인 직후 DB 저장 전에 죽은 경우: 토스에는 결제, 우리 DB는 결제 전 → 30분 정리 때 만료가 아니라 결제 완료로 되살림
  o = await newOrder(child)
  done(o.orderNo, `crash_${o.orderNo}`, o.amount)
  await db.query("UPDATE orders SET created_at = now() - interval '31 minutes' WHERE order_no = $1", [o.orderNo])
  await newOrder(child, 'potato_5kg')
  check('승인 후 서버가 죽음 → 정리 때 만료 대신 결제 완료로 복구', (await orderRow(o.orderNo)).status === 'paid')

  // 8. DB 연결이 갑자기 끊김 → 서버는 살아 있고 다음 요청은 새 연결로 처리
  await db.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = current_user AND datname = current_database() AND pid <> pg_backend_pid()')
  await sleep(500)
  r = await call(child, 'GET', '/health')
  check('DB 연결 강제 종료 → 서버 안 죽고 다음 요청 정상', child.exitCode_ === undefined && r.status === 200, `health ${r.status}`)

  // 9. 결제 승인 처리 중에 서버를 끔 → 처리 중이던 승인은 끝까지 하고, 새 요청은 받지 않고, 안전하게 꺼짐
  o = await newOrder(child)
  const slow = confirm(child, o, 'slow_') // 가짜 서버가 늦게 답하는 동안
  await sleep(300)
  child.kill('SIGTERM')
  const late = await call(child, 'GET', '/health').then((x) => x.status).catch(() => '연결 거부')
  r = await slow
  await new Promise((resolve) => (child.exitCode_ !== undefined ? resolve() : child.on('exit', resolve)))
  check('승인 중 종료 신호 → 처리 중 승인은 완료, 새 요청 거절, 정상 종료', r.status === 200 && (await orderRow(o.orderNo)).status === 'paid' && child.exitCode === 0 && late !== 200,
    `승인 ${r.status}, 종료 중 새 요청 ${late}, 종료 코드 ${child.exitCode}`)
} catch (error) {
  check('시험 진행', false, error.message)
  if (child?.logs) console.log(child.logs.split('\n').slice(-15).join('\n'))
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM')
  // 시험 주문 정리: 결제까지 간 주문은 줄어든 재고를 돌려놓고 지운다
  await db.query(`UPDATE products p SET stock = p.stock + q.n FROM (
      SELECT oi.product_code, sum(oi.quantity) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.order_no = ANY($1) AND o.status IN ('pending', 'paid', 'preparing', 'shipping', 'delivered') GROUP BY oi.product_code) q
    WHERE p.product_code = q.product_code`, [created])
  await db.query('DELETE FROM orders WHERE order_no = ANY($1)', [created])
  const after = (await db.query("SELECT string_agg(product_code || '=' || stock, ',' ORDER BY product_code) AS s FROM products")).rows[0].s
  check('시험 후 재고가 시작 전과 같음', before === after)
  await db.end()
  fake.close()
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 통과`)
  process.exit(failed ? 1 : 0)
}
