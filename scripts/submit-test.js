// 제출용 테스트 10건: 손님·농가·관리자의 주요 흐름을 실제 DB로 돌리고 결과표를 docs/test_results.md 에 쓴다
//   npm run test-submit
// 우리 백엔드 사본을 빈 포트로 띄워 시험 결제(mock)로 돌린다. AI는 부르지 않는다. 시험 계정과 주문은 끝나면 지우고 재고를 되돌린다
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'
import { hashPassword } from '../server/auth.js'
import { SHOP } from '../server/policy.js'

// 공용 DB는 계정당 연결 5개: 메인 서버(3)와 함께 돌 때는 DB_POOL_MAX=1 로 시험 쪽·시험 서버 연결을 줄인다
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: Number(process.env.DB_POOL_MAX) || 2 })

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', DB_POOL_MAX: process.env.DB_POOL_MAX || '2', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '', TOSS_CLIENT_KEY: '', TOSS_SECRET_KEY: '', OPENROUTER_API_KEY: '' }
    const child = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let logs = ''
    const onData = (chunk) => {
      logs += chunk
      const m = logs.match(/\[server\] http:\/\/127\.0\.0\.1:(\d+)/)
      if (m && !child.port) {
        child.port = Number(m[1])
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => { if (!child.port) reject(new Error(`백엔드가 켜지지 않음 (${code}): ${logs}`)) })
  })
}

let child
let ip = 0
async function call(who, method, path, body) {
  ip += 1
  const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.77.${Math.floor(ip / 250)}.${ip % 250 + 1}`,
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

const results = []
function record(no, name, how, expected, actual, ok) {
  results.push({ no, name, how, expected, actual, ok: Boolean(ok) })
  console.log(`${ok ? '✓' : '✗'} ${no}. ${name} — ${actual}`)
}
const PHONE = '01055667788'
const tag = randomBytes(3).toString('hex')
const PASSWORD = `st-${randomBytes(9).toString('hex')}`
const ACCOUNTS = [[`st_admin_${tag}`, 'admin', null], [`st_sunny_${tag}`, 'seller', 'farm_sunny']]
async function ask(message) {
  askedQuestions.push(message)
  return (await call(null, 'POST', '/chat', { message })).data
}
async function placeOrder(body) {
  const response = await call(null, 'POST', '/orders', body)
  if (response.data?.orderNo) createdOrders.push(response.data.orderNo)
  return response
}
const orderBody = (items, phone = PHONE) => ({
  items, buyerName: '시험', buyerPhone: phone, receiverName: '시험', receiverPhone: '01055660000', zipcode: '31066', address1: '시험로 1', agreeTerms: true, agreePrivacy: true,
})

const outboxBefore = (await db.query('SELECT COALESCE(max(id), 0) AS id FROM email_outbox')).rows[0].id
const createdOrders = []
const askedQuestions = []
let stockBefore = null
let exitCode = 0
const newCode = `st_item_${tag}`
try {
  child = await startBackend()
  const hashed = await hashPassword(PASSWORD)
  for (const [login, role, seller] of ACCOUNTS) {
    await db.query('INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, $3, $4)', [login, hashed, role, seller])
  }
  const admin = {}
  const seller = {}
  await call(admin, 'POST', '/admin/login', { loginId: ACCOUNTS[0][0], password: PASSWORD })
  await call(seller, 'POST', '/admin/login', { loginId: ACCOUNTS[1][0], password: PASSWORD })

  const catalog = (await call(null, 'GET', '/catalog?size=50')).data
  const plain = catalog.items.find((p) => !p.has_options && p.stock >= 5)
  const withOption = catalog.items.find((p) => p.has_options)
  const soldOut = catalog.items.find((p) => p.sold_out)
  const detail = (await call(null, 'GET', `/products/${plain.product_code}`)).data
  stockBefore = { code: plain.product_code, stock: plain.stock }
  const plainName = plain.name.replace(/\[예시\]\s*/, '')
  const firstWord = detail.item?.name ?? plainName

  record(1, '상품 목록과 상세', 'GET /catalog, /products/코드', '상품이 나오고 상세에 품목 정보가 있다',
    `상품 ${catalog.total}개, ${plainName} 상세 ${detail.item ? '품목 정보 있음' : '품목 정보 없음'}`, catalog.total > 0 && detail.item)

  const recommend = await call(null, 'GET', '/recommend?want=gift')
  const picked = recommend.data?.items ?? recommend.data ?? []
  record(2, '추천', 'GET /recommend?want=gift', '선물용 상품을 고르고 품절은 뺀다',
    `${picked.length}개 추천, 품절 ${picked.filter((p) => p.sold_out).length}개`, recommend.status === 200 && picked.length > 0 && !picked.some((p) => p.sold_out))

  // 같은 품목 상품이 여럿이라 상품 이름으로 묻는다 (품목 이름만 물으면 가격 범위로 답한다)
  const priceReply = await ask(`${plainName} 얼마예요?`)
  record(3, '챗봇: 가격을 DB 값으로 답함', `"${plainName} 얼마예요?"`, `${plain.price}원이 답에 있고 AI를 부르지 않는다`,
    String(priceReply.answer).slice(0, 40), String(priceReply.answer).replaceAll(',', '').includes(String(plain.price)))

  const healthReply = await ask(`당뇨가 있는데 ${firstWord} 먹어도 되나요?`)
  record(4, '챗봇: 건강 판단을 하지 않음', '"당뇨가 있는데 먹어도 되나요?"', '담당자에게 넘기고 먹어도 된다고 말하지 않는다',
    `넘김 ${healthReply.handoff}`, healthReply.handoff && !/먹어도 돼요/.test(healthReply.answer))

  const unknownReply = await ask('오늘 날씨 어때요')
  record(5, '챗봇: 모르는 질문은 연락처로 넘김', '"오늘 날씨 어때요"', `지어내지 않고 ${SHOP.phone}을 안내한다`,
    String(unknownReply.answer).includes(SHOP.phone) ? '연락처 안내함' : '연락처 없음', String(unknownReply.answer).includes(SHOP.phone))

  const order = await placeOrder(orderBody([{ productCode: plain.product_code, quantity: 2 }]))
  const paid = await call(null, 'POST', `/orders/${order.data.orderNo}/confirm`, { paymentKey: `mock_${order.data.orderNo}`, amount: order.data.amount })
  const stockNow = (await db.query('SELECT stock FROM products WHERE product_code = $1', [plain.product_code])).rows[0].stock
  record(6, '비회원 주문과 시험 결제', `${plainName} 2개 주문 후 결제`, '결제 완료가 되고 재고가 2개 줄어든다',
    `결제 ${paid.status}, 재고 ${plain.stock} → ${stockNow}`, paid.status === 200 && stockNow === plain.stock - 2)

  const right = await call(null, 'POST', '/orders/lookup', { orderNo: order.data.orderNo, phone: PHONE })
  const wrong = await call(null, 'POST', '/orders/lookup', { orderNo: order.data.orderNo, phone: '01000000000' })
  record(7, '주문 조회', '맞는 번호와 틀린 번호로 조회', '맞는 번호만 주문이 보인다', `맞는 번호 ${right.status}, 틀린 번호 ${wrong.status}`, right.status === 200 && wrong.status === 404)

  const forged = await placeOrder(orderBody([{ productCode: plain.product_code, quantity: 1 }], '01055667799'))
  const forgedPay = await call(null, 'POST', `/orders/${forged.data.orderNo}/confirm`, { paymentKey: `mock_${forged.data.orderNo}`, amount: 100 })
  const forgedRow = (await db.query('SELECT status FROM orders WHERE order_no = $1', [forged.data.orderNo])).rows[0]
  record(8, '결제 금액 조작', '100원으로 결제 승인 요청', '거절되고 결제 완료가 되지 않는다', `응답 ${forgedPay.status}, 주문 ${forgedRow.status}`, forgedPay.status === 400 && forgedRow.status !== 'paid')

  const outcomes = []
  if (soldOut) outcomes.push((await placeOrder(orderBody([{ productCode: soldOut.product_code, quantity: 1 }], '01055667701'))).status)
  if (withOption) outcomes.push((await placeOrder(orderBody([{ productCode: withOption.product_code, quantity: 1 }], '01055667702'))).status)
  record(9, '살 수 없는 주문', '품절 상품, 옵션을 안 고른 주문', '둘 다 409로 막힌다', `응답 ${outcomes.join(', ') || '대상 상품 없음'}`, outcomes.length > 0 && outcomes.every((s) => s === 409))

  const created = await call(seller, 'POST', '/seller/products', {
    product_code: newCode, name: '[예시] 시험 당근 1kg', price: '5000', unit: '1kg 1봉', stock: '3', item_code: 'carrot', tags: ['home'], status: 'pending',
    notice: { origin: '국내산', expiry: '수확 후 7일', composition: '당근 1kg', packed: '2026-11-01', imported: false },
  })
  if (created.status !== 201) console.error(`등록 거절: ${created.data?.error}`)
  const code = created.data?.product_code ?? newCode
  const hidden = await call(null, 'GET', `/products/${code}`)
  const approved = await call(admin, 'PATCH', `/admin/products/${code}`, { status: 'active' })
  const shown = await call(null, 'GET', `/products/${code}`)
  const otherFarm = (await db.query("SELECT product_code FROM products WHERE seller_code <> 'farm_sunny' AND status = 'active' LIMIT 1")).rows[0].product_code
  const others = await call(seller, 'PATCH', `/seller/products/${otherFarm}`, { price: '1' })
  const notAdmin = await call(seller, 'GET', '/admin/orders')
  record(10, '농가 상품 등록과 승인, 권한', '판매자 등록 → 관리자 승인, 판매자가 남의 상품·관리자 API 접근', '승인 전에는 안 보이고 승인 뒤 보인다. 남의 상품과 관리자 API는 막힌다',
    `등록 ${created.status}, 승인 전 손님 화면 ${hidden.status}, 승인 ${approved.status}, 승인 뒤 손님 화면 ${shown.status}, 남의 상품 ${others.status}, 관리자 API ${notAdmin.status}`,
    created.status === 201 && hidden.status === 404 && approved.status === 200 && shown.status === 200 && others.status === 404 && [401, 403].includes(notAdmin.status))
} catch (error) {
  console.error(`시험 중단: ${error.stack}`)
  exitCode = 1
} finally {
  child?.kill()
  await db.query('DELETE FROM orders WHERE order_no = ANY($1)', [createdOrders])
  await db.query('DELETE FROM product_changes WHERE product_code = $1', [newCode])
  await db.query('DELETE FROM products WHERE product_code = $1', [newCode])
  await db.query('DELETE FROM email_outbox WHERE id > $1', [outboxBefore])
  await db.query('DELETE FROM chat_logs WHERE question = ANY($1)', [askedQuestions])
  await db.query('DELETE FROM access_logs WHERE login_id = ANY($1)', [ACCOUNTS.map((a) => a[0])])
  await db.query('DELETE FROM admins WHERE login_id = ANY($1)', [ACCOUNTS.map((a) => a[0])])
  if (stockBefore) await db.query('UPDATE products SET stock = $2 WHERE product_code = $1', [stockBefore.code, stockBefore.stock])
}

const cell = (s) => String(s).replace(/\|/g, '\\|')
const passed = results.filter((r) => r.ok).length
await writeFile(new URL('../docs/test_results.md', import.meta.url), `# 테스트 결과표

- 실행: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · ${passed}/${results.length} 통과 · \`npm run test-submit\`
- 시험 결제(mock)와 예시 데이터로 돌린 결과다. 실제 토스 결제와 운영 서버에서 확인한 것은 아니다
- 챗봇 정확도는 \`docs/chat_eval_report.md\`, 환불은 \`npm run test-refund\`, 결제 장애 복구는 \`npm run test-resilience\`로 따로 본다

| 번호 | 시험 | 방법 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|---|---|
${results.map((r) => `| ${r.no} | ${cell(r.name)} | ${cell(r.how)} | ${cell(r.expected)} | ${cell(r.actual)} | ${r.ok ? '통과' : '실패'} |`).join('\n')}
`)
console.log(`\n${passed}/${results.length} 통과 → docs/test_results.md`)
await db.end()
process.exit(exitCode || (passed === results.length ? 0 : 1))
