// 농가별 부분 취소·전체 취소·반품 환불을 실제 DB와 가짜 결제 서버로 시험한다
//   npm run test-refund
// scripts/resilience-test.js 와 같은 방식: 가짜 토스 결제 서버와 우리 백엔드 사본을 빈 포트에 따로 띄운다 (실제 결제·운영 서버와 무관).
// 시험용 관리자·판매자·회원 계정과 시험 주문은 끝나면 지우고, 상품·옵션 재고가 시작 전과 같은지 확인한다.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import http from 'node:http'
import { promisify } from 'node:util'
import pg from 'pg'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm' })
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- 가짜 토스 결제 서버 ----------
// 승인(ok_ 로 시작하는 paymentKey), 조회, 취소(cancelAmount 가 있으면 부분 취소)를 흉내 낸다.
// cancelMode 로 다음 취소 요청의 상황을 고른다: ok 정상, drop 취소하고 답하기 전에 연결 끊음,
// down 취소하고 늦게 답함 + 조회도 장애, reject 취소하지 않고 거절(확실한 실패)
const payments = new Map() // orderId → 결제
const idem = new Map() // Idempotency-Key → 첫 응답
let cancelMode = 'ok'
let lookupDown = false
let cancelCalls = 0 // 실제로 돈을 돌려준 횟수

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
    if (req.method === 'POST' && path === '/confirm') {
      const { paymentKey, orderId, amount } = JSON.parse(raw)
      const payment = { paymentKey, orderId, status: 'DONE', method: '카드', totalAmount: amount, balanceAmount: amount, cancels: [], approvedAt: new Date().toISOString() }
      payments.set(orderId, payment)
      return remember(200, payment)
    }
    if (req.method === 'POST' && path.endsWith('/cancel')) {
      const found = [...payments.values()].find((p) => `/${p.paymentKey}/cancel` === path)
      if (!found) return send(404, { code: 'NOT_FOUND_PAYMENT', message: '결제 없음' })
      const mode = cancelMode
      if (mode === 'reject') return remember(400, { code: 'REJECT_CANCEL', message: '취소 거절 (시험)' })
      const { cancelAmount, cancelReason } = JSON.parse(raw)
      const amount = cancelAmount ?? found.balanceAmount
      if (amount > found.balanceAmount || amount <= 0) return remember(400, { code: 'NOT_CANCELABLE_AMOUNT', message: '취소할 수 없는 금액' })
      found.balanceAmount -= amount
      found.status = found.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'
      found.cancels.push({ cancelAmount: amount, cancelReason, canceledAt: new Date().toISOString() })
      cancelCalls += 1
      const body = { ...found }
      if (key) idem.set(key, [200, body])
      if (mode === 'drop') return req.socket.destroy() // 취소했는데 답을 보내기 전에 연결이 끊김
      if (mode === 'down') {
        lookupDown = true
        await sleep(3000) // 우리 서버의 시간 제한보다 늦게 답함
      }
      return send(200, body)
    }
    send(404, { code: 'NOT_FOUND', message: '없는 주소' })
  })
})
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
const FAKE = `http://127.0.0.1:${fake.address().port}/v1/payments`

// ---------- 우리 백엔드 사본 ----------
function startBackend() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      env: {
        ...process.env, BACKEND_PORT: '0', NODE_ENV: 'development', TOSS_API_BASE: FAKE, TOSS_TIMEOUT_MS: '1500', DB_POOL_MAX: '3',
        TOSS_CLIENT_KEY: 'test_gck_refund', TOSS_SECRET_KEY: 'test_gsk_refund', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '',
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
    child.on('exit', (code) => { if (!child.port) reject(new Error(`백엔드가 켜지지 않음 (${code}): ${child.logs}`)) })
  })
}

let ip = 0
let child
// who: 쿠키 상자 (로그인한 사람마다 하나)
async function call(who, method, path, body) {
  ip += 1
  const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.88.${Math.floor(ip / 250)}.${ip % 250}`,
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  if (who) {
    const cookies = response.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
    if (cookies.length) who.cookie = cookies.join('; ')
  }
  return { status: response.status, data: await response.json().catch(() => null) }
}

const scrypt = promisify(scryptCb)
async function hash(password) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`
}
const PASSWORD = `rt-${randomBytes(9).toString('hex')}`
const tag = randomBytes(3).toString('hex')
const ACCOUNTS = [[`rt_admin_${tag}`, 'admin', null], [`rt_sunny_${tag}`, 'seller', 'farm_sunny'], [`rt_green_${tag}`, 'seller', 'farm_green']]

const created = []
const PHONE = '01066660000'
async function newPaidOrder(items, who = null) {
  const r = await call(who, 'POST', '/orders', {
    items, buyerName: '환불시험', buyerPhone: PHONE, receiverName: '환불시험', receiverPhone: PHONE, email: `refund-test-${tag}@example.com`,
    zipcode: '31066', address1: '시험로 1', agreeTerms: true, agreePrivacy: true,
  })
  if (r.status !== 201) throw new Error(`주문 생성 실패 ${r.status} ${JSON.stringify(r.data)}`)
  created.push(r.data.orderNo)
  const paid = await call(who, 'POST', `/orders/${r.data.orderNo}/confirm`, { paymentKey: `ok_${r.data.orderNo}`, amount: r.data.amount })
  if (paid.status !== 200) throw new Error(`결제 실패 ${paid.status} ${JSON.stringify(paid.data)}`)
  return { ...r.data, order: paid.data }
}
const shipment = async (orderNo, seller) => (await db.query(
  'SELECT sh.* FROM order_shipments sh JOIN orders o ON o.id = sh.order_id WHERE o.order_no = $1 AND sh.seller_code = $2', [orderNo, seller])).rows[0]
const orderRow = async (orderNo) => (await db.query('SELECT * FROM orders WHERE order_no = $1', [orderNo])).rows[0]
const refunds = async (orderNo) => (await db.query('SELECT r.* FROM order_refunds r JOIN orders o ON o.id = r.order_id WHERE o.order_no = $1 ORDER BY r.id', [orderNo])).rows
const stock = async (code) => (await db.query('SELECT stock FROM products WHERE product_code = $1', [code])).rows[0].stock
const optionStock = async (id) => (await db.query('SELECT stock FROM product_options WHERE id = $1', [id])).rows[0].stock
const toss = (orderNo) => payments.get(orderNo)
async function ship(admin, orderNo, seller, until = 'delivered') {
  for (const status of ['preparing', 'shipping', 'delivered']) {
    const r = await call(admin, 'PATCH', `/admin/orders/${orderNo}`, { status, sellerCode: seller, courier: 'CJ대한통운', trackingNo: '123456789012' })
    if (r.status !== 200) throw new Error(`배송 단계 실패 ${status} ${r.status} ${JSON.stringify(r.data)}`)
    if (status === until) return
  }
}

const snapshot = async () => (await db.query(`SELECT
  (SELECT string_agg(product_code || '=' || stock || '/' || price, ',' ORDER BY product_code) FROM products) AS products,
  (SELECT string_agg(id || '=' || stock, ',' ORDER BY id) FROM product_options) AS options`)).rows[0]
const before = await snapshot()
const outboxBefore = (await db.query('SELECT COALESCE(max(id), 0) AS id FROM email_outbox')).rows[0].id
const { rows: [apple5] } = await db.query("SELECT id, price FROM product_options WHERE product_code = 'apple_10kg' AND name LIKE '5kg%'")
const customerBefore = (await db.query('SELECT COALESCE(max(id), 0) AS id FROM customers')).rows[0].id

try {
  for (const [loginId, role, sellerCode] of ACCOUNTS) {
    await db.query('INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, $3, $4)', [loginId, await hash(PASSWORD), role, sellerCode])
  }
  child = await startBackend()
  console.log(`가짜 결제 서버 ${FAKE} · 백엔드 사본 127.0.0.1:${child.port}\n`)
  const admin = {}
  const sunny = {}
  const green = {}
  for (const [who, [loginId]] of [[admin, ACCOUNTS[0]], [sunny, ACCOUNTS[1]], [green, ACCOUNTS[2]]]) {
    const r = await call(who, 'POST', '/admin/login', { loginId, password: PASSWORD })
    if (r.status !== 200) throw new Error(`로그인 실패 ${loginId} ${r.status} ${JSON.stringify(r.data)}`)
  }

  // 1. 관리자 부분 취소: 사과(옵션, farm_sunny) + 당근(farm_green) 주문에서 당근 농가만 취소
  let carrot0 = await stock('carrot_3kg')
  let option0 = await optionStock(apple5.id)
  let o = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 1 }, { productCode: 'carrot_3kg', quantity: 2 }])
  let sh = await shipment(o.orderNo, 'farm_green')
  let r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '농가 재고 부족' })
  let ord = await orderRow(o.orderNo)
  check('관리자 부분 취소 → 그 농가 상품 금액 + 배송비만 토스 부분 취소, 주문은 유지',
    r.status === 200 && (await shipment(o.orderNo, 'farm_green')).status === 'cancelled' && ord.status === 'paid'
      && toss(o.orderNo).balanceAmount === o.amount - (sh.items_amount + sh.shipping_fee) && toss(o.orderNo).status === 'PARTIAL_CANCELED',
    `돌려줌 ${sh.items_amount + sh.shipping_fee}원, 주문 ${ord.status}, 토스 남은 금액 ${toss(o.orderNo).balanceAmount}`)
  check('부분 취소 → 그 농가 재고만 복구 (다른 농가 옵션 재고는 그대로)',
    (await stock('carrot_3kg')) === carrot0 && (await optionStock(apple5.id)) === option0 - 1, `당근 ${await stock('carrot_3kg')}/${carrot0}, 사과 5kg ${await optionStock(apple5.id)}/${option0 - 1}`)
  const rows1 = await refunds(o.orderNo)
  check('돌려준 돈 기록: 누가·언제·얼마', rows1.length === 1 && rows1[0].status === 'done' && rows1[0].processed_by === `관리자 ${ACCOUNTS[0][0]}` && rows1[0].done_at && rows1[0].amount === sh.items_amount + sh.shipping_fee)

  // 2. 같은 요청 두 번 (동시에) → 돈은 한 번만
  let calls0 = cancelCalls
  const [a, b] = await Promise.all([
    call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_sunny/cancel`, { reason: '손님 요청' }),
    call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_sunny/cancel`, { reason: '손님 요청' }),
  ])
  ord = await orderRow(o.orderNo)
  check('같은 농가 취소를 동시에 두 번 → 토스 취소 1번, 기록 1줄',
    a.status === 200 && b.status === 200 && cancelCalls - calls0 === 1 && (await refunds(o.orderNo)).filter((x) => x.status === 'done').length === 2,
    `응답 ${a.status}·${b.status}, 토스 취소 ${cancelCalls - calls0}번`)
  check('모든 농가를 취소하면 주문도 취소 상태, 옵션 재고 복구',
    ord.status === 'cancelled' && ord.cancelled_at && toss(o.orderNo).balanceAmount === 0 && (await optionStock(apple5.id)) === option0,
    `주문 ${ord.status}, 토스 남은 금액 ${toss(o.orderNo).balanceAmount}, 사과 5kg ${await optionStock(apple5.id)}/${option0}`)
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_sunny/cancel`, { reason: '다시 요청' })
  check('끝난 취소를 다시 요청 → 다시 보내지 않음', r.status === 200 && cancelCalls - calls0 === 1)

  // 3. 판매자: 자기 농가 몫만 (옵션 재고 복구), 다른 농가 주문은 못 건드림
  option0 = await optionStock(apple5.id)
  const appleStock0 = await stock('apple_10kg')
  o = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 2 }, { productCode: 'carrot_3kg', quantity: 1 }])
  const mixed = o.orderNo // 사과 농가는 취소, 당근 농가는 배송 → 정산 시험에 쓴다
  r = await call(sunny, 'POST', `/seller/orders/${o.orderNo}/cancel`, { reason: '수확 지연' })
  check('판매자가 자기 농가 몫 취소 → 옵션 재고와 상품 재고 합 복구',
    r.status === 204 && (await optionStock(apple5.id)) === option0 && (await stock('apple_10kg')) === appleStock0 && (await orderRow(o.orderNo)).status === 'paid',
    `사과 5kg ${await optionStock(apple5.id)}/${option0}, 상품 재고 ${await stock('apple_10kg')}/${appleStock0}`)
  const onlySunny = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 1 }])
  r = await call(green, 'POST', `/seller/orders/${onlySunny.orderNo}/cancel`, { reason: '남의 농가' })
  const r2 = await call(green, 'POST', `/admin/orders/${onlySunny.orderNo}/shipments/farm_sunny/cancel`, { reason: '관리자 흉내' })
  check('다른 농가 판매자 → 남의 주문 취소 403, 관리자 주소 403, 돈 안 나감',
    r.status === 403 && r2.status === 403 && toss(onlySunny.orderNo).balanceAmount === onlySunny.amount, `${r.status}·${r2.status}`)

  // 4. 이미 보낸 농가는 취소 못 함
  await ship(admin, o.orderNo, 'farm_green', 'shipping')
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '보낸 뒤' })
  check('이미 보낸 농가 취소 → 409, 돈 안 나감', r.status === 409 && toss(o.orderNo).balanceAmount === o.amount - (await refunds(o.orderNo))[0].amount, `${r.status} ${r.data?.error}`)

  // 5. 기존 전체 취소 그대로 + 부분 취소 뒤 전체 취소는 남은 금액만, 재고는 한 번만 복구
  carrot0 = await stock('carrot_3kg')
  o = await newPaidOrder([{ productCode: 'carrot_3kg', quantity: 1 }])
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/cancel`, { reason: '전체 취소 시험' })
  check('기존 전체 취소 → 주문 취소, 토스 전액 취소, 재고 복구, 기록 남김',
    r.status === 200 && (await orderRow(o.orderNo)).status === 'cancelled' && toss(o.orderNo).status === 'CANCELED' && (await stock('carrot_3kg')) === carrot0
      && (await refunds(o.orderNo)).some((x) => x.kind === 'full' && x.amount === o.amount))
  carrot0 = await stock('carrot_3kg')
  option0 = await optionStock(apple5.id)
  o = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 1 }, { productCode: 'carrot_3kg', quantity: 3 }])
  await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '먼저 한 농가' })
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/cancel`, { reason: '나머지 전체' })
  const sum = (await refunds(o.orderNo)).reduce((s, x) => s + x.amount, 0)
  check('부분 취소 뒤 전체 취소 → 남은 금액만 취소, 누적 = 결제 금액, 재고 한 번만 복구',
    r.status === 200 && toss(o.orderNo).balanceAmount === 0 && sum === o.amount && (await stock('carrot_3kg')) === carrot0 && (await optionStock(apple5.id)) === option0,
    `누적 ${sum}/${o.amount}, 당근 ${await stock('carrot_3kg')}/${carrot0}`)

  // 6. 통신 끊김
  o = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 1 }, { productCode: 'carrot_3kg', quantity: 1 }])
  cancelMode = 'drop'
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '끊김 시험' })
  cancelMode = 'ok'
  check('취소 후 연결 끊김 → 조회로 확인해 취소 완료', r.status === 200 && (await shipment(o.orderNo, 'farm_green')).status === 'cancelled', `응답 ${r.status}`)
  calls0 = cancelCalls
  cancelMode = 'down'
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_sunny/cancel`, { reason: '장애 시험' })
  cancelMode = 'ok'
  const pendingRows = (await refunds(o.orderNo)).filter((x) => x.status === 'requested')
  const blocked = await call(sunny, 'PATCH', `/seller/orders/${o.orderNo}`, { status: 'preparing' })
  const blockedFull = await call(admin, 'POST', `/admin/orders/${o.orderNo}/cancel`, { reason: '끼어들기' })
  check('응답·조회 모두 장애 → 실패로 처리하지 않고 결과 확인 중(202), 그동안 배송 시작·전체 취소 막음',
    r.status === 202 && r.data?.pending && pendingRows.length === 1 && (await shipment(o.orderNo, 'farm_sunny')).status === 'paid' && blocked.status === 409 && blockedFull.status === 409,
    `응답 ${r.status}, 배송 시작 ${blocked.status}, 전체 취소 ${blockedFull.status}`)
  lookupDown = false
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_sunny/cancel`, { reason: '장애 시험' })
  check('장애가 풀린 뒤 다시 확인 → 같은 멱등키로 확인, 돈은 한 번만',
    r.status === 200 && cancelCalls - calls0 === 1 && (await orderRow(o.orderNo)).status === 'cancelled' && toss(o.orderNo).balanceAmount === 0,
    `토스 취소 ${cancelCalls - calls0}번, 주문 ${(await orderRow(o.orderNo)).status}`)
  o = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 1 }, { productCode: 'carrot_3kg', quantity: 1 }])
  cancelMode = 'reject'
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '거절 시험' })
  cancelMode = 'ok'
  const failedRows = await refunds(o.orderNo)
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '거절 시험' })
  check('결제사가 확실히 거절 → failed 기록·배송 그대로, 다시 하면 새 멱등키로 취소',
    failedRows.length === 1 && failedRows[0].status === 'failed' && r.status === 200 && (await refunds(o.orderNo)).filter((x) => x.status === 'done').length === 1
      && failedRows[0].idempotency_key !== (await refunds(o.orderNo)).at(-1).idempotency_key)

  // 7. 금액 초과: 누적이 결제 금액을 넘으면 막는다 (다른 경로로 돌려준 돈이 있는 경우를 기록으로 만든다)
  o = await newPaidOrder([{ productCode: 'apple_10kg', optionId: apple5.id, quantity: 1 }, { productCode: 'carrot_3kg', quantity: 1 }])
  ord = await orderRow(o.orderNo)
  await db.query("INSERT INTO order_refunds (order_id, kind, amount, status, idempotency_key, processed_by, done_at) VALUES ($1, 'full', $2, 'done', $3, '시험', now())",
    [ord.id, o.amount - 1000, `test-over-${o.orderNo}`])
  calls0 = cancelCalls
  r = await call(admin, 'POST', `/admin/orders/${o.orderNo}/shipments/farm_green/cancel`, { reason: '초과 시험' })
  check('누적 환불이 결제 금액을 넘는 요청 → 409, 토스에 보내지 않음', r.status === 409 && cancelCalls === calls0, `${r.status} ${r.data?.error}`)
  await db.query('DELETE FROM order_refunds WHERE idempotency_key = $1', [`test-over-${o.orderNo}`])

  // 8. 반품 신청 (비회원·회원), 다른 손님 접근
  const member = {}
  const other = {}
  for (const [who, n] of [[member, 1], [other, 2]]) {
    r = await call(who, 'POST', '/account/signup', { email: `rt-${tag}-${n}@example.com`, password: PASSWORD, name: `반품시험${n}`, phone: `0106666000${n}`, agreeTerms: true, agreePrivacy: true })
    if (r.status !== 201) throw new Error(`가입 실패 ${r.status} ${JSON.stringify(r.data)}`)
  }
  o = await newPaidOrder([{ productCode: 'carrot_3kg', quantity: 2 }])
  const memberOrder = await newPaidOrder([{ productCode: 'carrot_3kg', quantity: 1 }], member)
  r = await call(null, 'POST', '/orders/lookup/returns', { orderNo: o.orderNo, phone: PHONE, sellerCode: 'farm_green', reasonType: 'change_mind', reason: '마음이 바뀌었어요' })
  check('배송 완료 전 반품 신청 → 409', r.status === 409, `${r.status}`)
  await ship(admin, o.orderNo, 'farm_green')
  await ship(admin, memberOrder.orderNo, 'farm_green')
  r = await call(null, 'POST', '/orders/lookup/returns', { orderNo: o.orderNo, phone: '01012340000', sellerCode: 'farm_green', reasonType: 'defect', reason: '다른 손님이 신청' })
  const r3 = await call(other, 'POST', `/account/orders/${memberOrder.orderNo}/returns`, { sellerCode: 'farm_green', reasonType: 'defect', reason: '남의 주문에 신청' })
  const r4 = await call(null, 'POST', `/account/orders/${memberOrder.orderNo}/returns`, { sellerCode: 'farm_green', reasonType: 'defect', reason: '로그인 없이' })
  check('다른 손님 접근 → 휴대폰 다름 404, 다른 회원 404, 로그인 없음 401', r.status === 404 && r3.status === 404 && r4.status === 401, `${r.status}·${r3.status}·${r4.status}`)
  const shipRow = await shipment(o.orderNo, 'farm_green')
  await db.query("UPDATE order_shipments SET delivered_at = now() - interval '10 days' WHERE id = $1", [shipRow.id])
  r = await call(null, 'POST', '/orders/lookup/returns', { orderNo: o.orderNo, phone: PHONE, sellerCode: 'farm_green', reasonType: 'change_mind', reason: '마음이 바뀌었어요' })
  check('단순 변심인데 받은 지 10일 → 409 (정책 7일)', r.status === 409, `${r.status} ${r.data?.error}`)
  await db.query("UPDATE order_shipments SET delivered_at = now() - interval '2 days' WHERE id = $1", [shipRow.id])
  r = await call(null, 'POST', '/orders/lookup/returns', { orderNo: o.orderNo, phone: PHONE, sellerCode: 'farm_green', reasonType: 'change_mind', reason: '마음이 바뀌었어요', lines: [{ line: 0, quantity: 2 }] })
  const dup = await call(null, 'POST', '/orders/lookup/returns', { orderNo: o.orderNo, phone: PHONE, sellerCode: 'farm_green', reasonType: 'change_mind', reason: '마음이 바뀌었어요' })
  const guestView = JSON.stringify(r.data)
  check('비회원 반품 신청 → 신청 상태, 같은 신청 두 번 → 409', r.status === 201 && r.data.returns?.[0]?.status === 'requested' && dup.status === 409, `${r.status}·${dup.status}`)
  check('손님 응답에 내부 값·관리자 아이디 없음',
    !/processed_by|idempotency|payment_key|seller_note|item_id|decided_by|rt_admin|buyer_phone_hash|"id":/.test(guestView), guestView.match(/processed_by|idempotency|payment_key|seller_note|item_id|decided_by|rt_admin|buyer_phone_hash|"id":/)?.[0] ?? '')
  r = await call(member, 'POST', `/account/orders/${memberOrder.orderNo}/returns`, { sellerCode: 'farm_green', reasonType: 'defect', reason: '상자를 여니 물러 있었어요' })
  check('회원 반품 신청 (상품 하자)', r.status === 201 && r.data.returns?.[0]?.reason_type === 'defect', `${r.status}`)

  // 9. 승인 전 환불 불가, 판매자는 의견만, 관리자 승인 → 한도 확인 → 환불
  const { rows: [ret] } = await db.query('SELECT r.* FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE o.order_no = $1', [o.orderNo])
  calls0 = cancelCalls
  r = await call(admin, 'POST', `/admin/returns/${ret.id}/refund`, { amount: 1000 })
  check('신청만 한 반품은 환불 불가 (승인 먼저) → 409, 돈 안 나감', r.status === 409 && cancelCalls === calls0, `${r.status}`)
  r = await call(green, 'PATCH', `/seller/returns/${ret.id}`, { note: '받은 상자 상태 확인했어요' })
  const sellerRefund = await call(green, 'POST', `/admin/returns/${ret.id}/refund`, { amount: 1000 })
  const sunnyNote = await call(sunny, 'PATCH', `/seller/returns/${ret.id}`, { note: '남의 농가' })
  const sunnyList = await call(sunny, 'GET', '/seller/returns')
  check('판매자: 자기 농가 신청에 의견 남김(204), 환불 실행 403, 다른 농가 의견 404·목록에 안 보임',
    r.status === 204 && sellerRefund.status === 403 && sunnyNote.status === 404 && !sunnyList.data.some((x) => x.id === ret.id), `${r.status}·${sellerRefund.status}·${sunnyNote.status}`)
  r = await call(admin, 'POST', `/admin/returns/${ret.id}/approve`, { note: '돌려보낼 방법을 문자로 안내해 드려요' })
  const list = (await call(admin, 'GET', '/admin/returns?status=approved')).data
  const mine = list.find((x) => x.id === ret.id)
  const carrot = await db.query("SELECT price FROM products WHERE product_code = 'carrot_3kg'")
  const expected = carrot.rows[0].price * 2 - 3000 // 단순 변심: 상품 − 돌려보내는 배송비 (처음 배송비 3,000원은 손님이 이미 냄)
  check('관리자 승인 → 환불 한도는 정책대로 (단순 변심: 상품 금액 − 돌려보내는 배송비)', r.status === 200 && mine?.refund_limit === expected && mine.seller_note, `한도 ${mine?.refund_limit} / 예상 ${expected}`)
  r = await call(admin, 'POST', `/admin/returns/${ret.id}/refund`, { amount: expected + 1 })
  check('한도를 넘는 환불 → 400, 돈 안 나감', r.status === 400 && cancelCalls === calls0, `${r.status} ${r.data?.error}`)
  cancelMode = 'drop'
  const [x1, x2] = await Promise.all([
    call(admin, 'POST', `/admin/returns/${ret.id}/refund`, { amount: expected }),
    call(admin, 'POST', `/admin/returns/${ret.id}/refund`, { amount: expected }),
  ])
  cancelMode = 'ok'
  const again = await call(admin, 'POST', `/admin/returns/${ret.id}/refund`, { amount: expected })
  const retRow = (await db.query('SELECT * FROM order_returns WHERE id = $1', [ret.id])).rows[0]
  check('반품 환불 (동시에 두 번 + 연결 끊김) → 조회로 확인, 돈은 한 번만, 환불 완료',
    [x1.status, x2.status].includes(200) && again.status === 200 && cancelCalls - calls0 === 1 && retRow.status === 'refunded' && retRow.refund_amount === expected
      && toss(o.orderNo).balanceAmount === o.amount - expected,
    `응답 ${x1.status}·${x2.status}·${again.status}, 토스 취소 ${cancelCalls - calls0}번`)
  const { rows: [mret] } = await db.query('SELECT r.* FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE o.order_no = $1', [memberOrder.orderNo])
  r = await call(admin, 'POST', `/admin/returns/${mret.id}/reject`, { note: '사진 확인 결과 정상 상품이에요' })
  const memberView = await call(member, 'GET', `/account/orders/${memberOrder.orderNo}`)
  check('거절 → 사유가 손님 화면에 보이고 돈은 안 나감', r.status === 200 && memberView.data.returns[0].status === 'rejected' && memberView.data.returns[0].admin_note && toss(memberOrder.orderNo).balanceAmount === memberOrder.amount)

  // 10. 정산·매출에서 취소·환불액 빼기
  const settleBefore = (await call(green, 'GET', '/seller/orders/settlement')).data
  await db.query('UPDATE orders SET confirmed_at = now() WHERE order_no = $1', [o.orderNo])
  const settleAfter = (await call(green, 'GET', '/seller/orders/settlement')).data
  const greenAmount = shipRow.items_amount + shipRow.shipping_fee
  const before10 = settleBefore.waiting_amount + settleBefore.waiting_shipping - settleBefore.waiting_refunds
  const after10 = settleAfter.confirmed_amount + settleAfter.confirmed_shipping - settleAfter.confirmed_refunds - settleAfter.late_refunds
  check('판매자 정산: 반품 환불액을 빼고, 취소한 농가 몫은 안 셈',
    settleAfter.confirmed_refunds - settleBefore.confirmed_refunds === expected && settleBefore.waiting_refunds >= expected && after10 >= greenAmount - expected,
    `확정 정산 ${after10}원 (이 주문 ${greenAmount} − 환불 ${expected}), 확정 전 ${before10}원`)
  // 사과 농가는 취소하고 당근 농가만 배송 완료된 주문: 당근 농가 정산에만 들어간다
  const sunny0 = (await call(sunny, 'GET', '/seller/orders/settlement')).data
  const green0 = (await call(green, 'GET', '/seller/orders/settlement')).data
  await call(admin, 'PATCH', `/admin/orders/${mixed}`, { status: 'delivered', sellerCode: 'farm_green' })
  const sunny1 = (await call(sunny, 'GET', '/seller/orders/settlement')).data
  const green1 = (await call(green, 'GET', '/seller/orders/settlement')).data
  const mixedGreen = await shipment(mixed, 'farm_green')
  check('취소한 농가 배송은 정산에 안 들어감 (같은 주문의 다른 농가만)',
    (await orderRow(mixed)).status === 'delivered' && sunny1.waiting_amount === sunny0.waiting_amount && sunny1.waiting_shipping === sunny0.waiting_shipping
      && green1.waiting_amount + green1.waiting_shipping - green0.waiting_amount - green0.waiting_shipping === mixedGreen.items_amount + mixedGreen.shipping_fee,
    `사과 농가 ${sunny0.waiting_amount}→${sunny1.waiting_amount}, 당근 농가 +${green1.waiting_amount + green1.waiting_shipping - green0.waiting_amount - green0.waiting_shipping}`)
  const dash = (await call(admin, 'GET', '/admin/dashboard?days=7')).data
  const { rows: [netRow] } = await db.query(`SELECT COALESCE(sum(o.total_amount - COALESCE((SELECT sum(amount) FROM order_refunds r WHERE r.order_id = o.id AND r.status = 'done'), 0)), 0)::int AS net
    FROM orders o WHERE o.status IN ('paid', 'preparing', 'shipping', 'delivered')
      AND date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')`)
  check('매출 화면: 이번 달 매출 = 결제 금액 − 돌려준 돈', dash.summary.month_sales === netRow.net && dash.summary.month_refunded > 0, `매출 ${dash.summary.month_sales} / 계산 ${netRow.net}, 뺀 금액 ${dash.summary.month_refunded}`)

  // 11. 손님 메일
  const { rows: mails } = await db.query('SELECT kind, count(*)::int AS n FROM email_outbox WHERE id > $1 GROUP BY kind', [outboxBefore])
  const kinds = Object.fromEntries(mails.map((m) => [m.kind, m.n]))
  check('손님에게 결과 메일 (농가 취소·반품 신청·승인·거절·환불)',
    ['order_farm_cancelled', 'return_requested', 'return_approved', 'return_rejected', 'return_refunded'].every((k) => kinds[k] > 0) && kinds.return_refunded === 1,
    JSON.stringify(kinds))
} catch (error) {
  check('시험 진행', false, error.stack)
  if (child?.logs) console.log(child.logs.split('\n').slice(-20).join('\n'))
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM')
  // 시험 주문 정리: 아직 재고를 잡고 있는 줄(취소하지 않은 농가)은 재고를 돌려놓고 지운다
  const holding = `FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.order_no = ANY($1) AND o.status IN ('pending', 'paid', 'preparing', 'shipping', 'delivered')
      AND NOT EXISTS (SELECT 1 FROM order_shipments sh WHERE sh.order_id = oi.order_id AND sh.seller_code = oi.seller_code AND sh.status = 'cancelled')`
  await db.query(`UPDATE product_options p SET stock = p.stock + q.n FROM (SELECT oi.option_id, sum(oi.quantity) AS n ${holding} AND oi.option_id IS NOT NULL GROUP BY oi.option_id) q
    WHERE p.id = q.option_id`, [created])
  await db.query(`UPDATE products p SET stock = p.stock + q.n FROM (SELECT oi.product_code, sum(oi.quantity) AS n ${holding} AND oi.option_id IS NULL GROUP BY oi.product_code) q
    WHERE p.product_code = q.product_code`, [created])
  // 옵션 상품의 재고 합을 옵션에 다시 맞춘다 (server/options.js 의 syncOptionTotals 와 같은 계산)
  await db.query(`UPDATE products p SET stock = COALESCE(s.stock, 0) FROM (SELECT product_code, sum(stock) FILTER (WHERE status = 'active')::int AS stock
    FROM product_options GROUP BY product_code) s WHERE p.product_code = s.product_code`)
  await db.query('DELETE FROM orders WHERE order_no = ANY($1)', [created])
  await db.query('DELETE FROM email_outbox WHERE id > $1', [outboxBefore])
  await db.query('DELETE FROM customers WHERE id > $1', [customerBefore])
  await db.query('DELETE FROM access_logs WHERE login_id = ANY($1)', [ACCOUNTS.map((x) => x[0])])
  await db.query('DELETE FROM admins WHERE login_id = ANY($1)', [ACCOUNTS.map((x) => x[0])])
  const after = await snapshot()
  check('시험 후 상품·옵션 재고가 시작 전과 같음', before.products === after.products && before.options === after.options)
  await db.end()
  fake.close()
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 통과`)
  process.exit(failed ? 1 : 0)
}
