// 관리자·농가 시뮬레이션: 예시 농가가 가입한 뒤(npm run onboard-farms), 관리자와 농가가 하는 일을 실제 API로 해 보고 화면 숫자와 DB가 어긋나는지 본다
//   npm run sim-admin   → docs/admin_simulation.md
// 백엔드 사본을 빈 포트로 띄워 시험 결제(mock)로 돌린다. AI는 부르지 않는다.
// 시험 계정·주문·문의 기록·상품 수정 기록은 끝나면 지우고, 재고·가격·품목 상태는 처음 값으로 되돌린다
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'
import { codeSets, itemRanges, noticeProblem } from '../server/admin.js'
import { hashPassword } from '../server/auth.js'
import { maskOrderNo } from '../server/orders.js'
import { findBanned, loadBanned } from '../server/banned.js'
import { SHIPPING } from '../server/policy.js'
import { validateProduct } from '../server/validate.js'

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })

function startBackend() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, BACKEND_PORT: '0', RAG_ENABLED: '0', NODE_ENV: 'development', DB_POOL_MAX: '1', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '', TOSS_CLIENT_KEY: '', TOSS_SECRET_KEY: '', OPENROUTER_API_KEY: '' }
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
      'Content-Type': 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.78.${Math.floor(ip / 250)}.${ip % 250 + 1}`,
      ...(who?.cookie ? { Cookie: who.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  if (who) {
    const cookies = response.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
    if (cookies.length) who.cookie = cookies.join('; ')
  }
  return { status: response.status, data: response.status === 204 ? null : await response.json().catch(() => null) }
}

// ok: true 통과, false 어긋남(고쳐야 함), 'warn' 확인 필요(정책·운영 판단)
const results = []
function record(area, name, actual, ok, detail = '') {
  results.push({ area, name, actual, ok, detail })
  console.log(`${ok === true ? '✓' : ok === 'warn' ? '△' : '✗'} [${area}] ${name} — ${actual}`)
}

const tag = randomBytes(3).toString('hex')
const PASSWORD = `sa-${randomBytes(9).toString('hex')}`
// 시험 계정: 관리자 1개 + 가입한 해남·남원 농가의 시험용 판매자 계정 (농가 코드는 가입할 때 서버가 만들어서 실제 농가 계정으로 찾는다)
const ACCOUNTS = [[`sa_admin_${tag}`, 'admin', null]]
const PLAN = JSON.parse(readFileSync(new URL('../data/sample_farms.json', import.meta.url), 'utf8'))
const SIM_CODES = PLAN.products.map((x) => x.product_code)
const PHONE = '01055668800'
const orderBody = (items, phone = PHONE) => ({
  items, buyerName: '시험', buyerPhone: phone, receiverName: '시험', receiverPhone: '01055660000', zipcode: '31066', address1: '시험로 1', agreeTerms: true, agreePrivacy: true,
})
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

const createdOrders = []
const askedQuestions = []
const touchedProducts = new Map() // 코드 → { stock, price }
const touchedOptions = new Map() // id → stock
const itemsToRestore = []
let started = null
let outboxBefore = 0
let exitCode = 0

async function remember(code) {
  if (touchedProducts.has(code)) return
  const p = (await db.query('SELECT stock, price FROM products WHERE product_code = $1', [code])).rows[0]
  touchedProducts.set(code, p)
  for (const o of (await db.query('SELECT id, stock FROM product_options WHERE product_code = $1', [code])).rows) touchedOptions.set(o.id, o.stock)
}
async function placeOrder(body) {
  for (const line of body.items) await remember(line.productCode)
  const response = await call(null, 'POST', '/orders', body)
  if (response.data?.orderNo) createdOrders.push(response.data.orderNo)
  return response
}
async function pay(order) {
  return call(null, 'POST', `/orders/${order.orderNo}/confirm`, { paymentKey: `mock_${order.orderNo}`, amount: order.amount })
}

try {
  started = (await db.query('SELECT now() AS t')).rows[0].t
  outboxBefore = (await db.query('SELECT COALESCE(max(id), 0) AS id FROM email_outbox')).rows[0].id
  child = await startBackend()
  const sellerOf = async (login) => (await db.query('SELECT seller_code FROM admins WHERE login_id = $1', [login])).rows[0]?.seller_code
  const HAENAM = await sellerOf('haenam_deulnyeok')
  const NAMWON = await sellerOf('namwon_gyul')
  const UISEONG = await sellerOf('uiseong_garlic')
  if (!HAENAM || !NAMWON || !UISEONG) throw new Error('가입한 예시 농가가 없어요. 먼저 npm run onboard-farms 를 돌려 주세요')
  ACCOUNTS.push([`sa_haenam_${tag}`, 'seller', HAENAM], [`sa_namwon_${tag}`, 'seller', NAMWON])
  const hashed = await hashPassword(PASSWORD)
  for (const [login, role, seller] of ACCOUNTS) {
    await db.query('INSERT INTO admins (login_id, password_hash, role, seller_code) VALUES ($1, $2, $3, $4)', [login, hashed, role, seller])
  }
  const admin = {}
  const haenam = {}
  const namwon = {}
  await call(admin, 'POST', '/admin/login', { loginId: ACCOUNTS[0][0], password: PASSWORD })
  await call(haenam, 'POST', '/admin/login', { loginId: ACCOUNTS[1][0], password: PASSWORD })
  await call(namwon, 'POST', '/admin/login', { loginId: ACCOUNTS[2][0], password: PASSWORD })

  // ---------- 1. 관리자 상품 화면 ----------
  const adminProducts = (await call(admin, 'GET', '/admin/products')).data
  const dbCounts = (await db.query("SELECT count(*)::int AS all, count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'active' AND product_code = ANY($1))::int AS sim FROM products", [SIM_CODES])).rows[0]
  record('상품', '관리자 상품 목록 수 = DB 상품 수, 가입한 농가 상품 100개 판매 중', `화면 ${adminProducts.length}개, DB ${dbCounts.all}개 (가입 농가 상품 판매 중 ${dbCounts.sim}/${SIM_CODES.length})`, adminProducts.length === dbCounts.all && dbCounts.sim === SIM_CODES.length)

  const sim = adminProducts.filter((p) => SIM_CODES.includes(p.product_code))
  const missing = sim.filter((p) => p.notice_missing?.length)
  record('상품', '시뮬레이션 상품의 상품 정보 고시 빈칸', missing.length ? missing.map((p) => `${p.name}: ${p.notice_missing.join(', ')}`).slice(0, 6).join(' / ') : '없음', missing.length === 0)

  // 옵션 상품: 상품 가격 = 판매 중 옵션 최저가, 재고 = 옵션 재고 합
  const optRows = (await db.query("SELECT product_code, min(price) FILTER (WHERE status = 'active') AS price, sum(stock) FILTER (WHERE status = 'active')::int AS stock FROM product_options GROUP BY product_code")).rows
  const optMismatch = optRows.filter((o) => { const p = adminProducts.find((x) => x.product_code === o.product_code); return p && (p.price !== o.price || p.stock !== o.stock) })
  record('상품', '옵션 상품 가격·재고 = 옵션 최저가·재고 합', optMismatch.length ? optMismatch.map((o) => o.product_code).join(', ') : `${optRows.length}개 모두 맞음`, optMismatch.length === 0)

  // 판매자 화면에서 그대로 저장할 수 있는 상품인지 (판매자 수정 검사를 시뮬레이션 상품에 돌린다)
  await loadBanned()
  const sets = await codeSets()
  const ranges = await itemRanges()
  const rejected = []
  for (const p of sim) {
    const { errors } = validateProduct({ ...p }, { ...sets, isNew: false, findBanned, itemRanges: ranges })
    const problem = errors ? errors.join(' ') : await noticeProblem({ ...p, category: p.category })
    if (problem) rejected.push(`${p.name}: ${problem}`)
  }
  record('상품', '판매자 저장 검사를 통과하는 시뮬레이션 상품', `${sim.length - rejected.length}/${sim.length}${rejected.length ? ` — ${rejected.slice(0, 5).join(' / ')}` : ''}`, rejected.length === 0)

  // ---------- 2. 품목 검수 ----------
  const review = (await call(admin, 'GET', '/admin/items/review')).data
  const pending = review.filter((i) => i.status === 'pending')
  const blockers = pending.filter((i) => i.issues.some((x) => x.level === 'error'))
  // 예시 데이터(data/items.csv)에서 검수자 칸이 빈 품목은 18개. 관리자가 검수할수록 줄어든다
  record('품목', '검수 기다리는 품목 (예시 데이터 18개 이하)', `${pending.length}개 (${pending.map((i) => i.name).join(', ')})`, pending.length <= 18)
  record('품목', '검수 버튼이 막히는 품목 (1차 검사 오류)', blockers.length ? blockers.map((i) => `${i.name}: ${i.issues.filter((x) => x.level === 'error').map((x) => `${x.field} ${x.problem}`).join(', ')}`).join(' / ') : '없음', blockers.length === 0)
  const warnCount = pending.reduce((n, i) => n + i.issues.filter((x) => x.level === 'warn').length, 0)
  record('품목', '검수 화면 확인 경고', `${warnCount}건 (기간·온도 숫자, 당도 범위 등 담당자가 볼 것)`, 'warn')
  const summary = (await call(admin, 'GET', '/admin/inquiries/summary')).data
  record('품목', '알림의 검수 대기 수 = 검수 목록 수', `알림 ${summary?.pending_items}, 목록 ${pending.length}`, summary?.pending_items === pending.length)

  // 검수 전 품목 상품은 손님 화면에 보관·안전 정보가 없어야 한다
  const pendingProduct = sim.find((p) => p.item_status === 'pending' && p.status === 'active')
  const pendingDetail = (await call(null, 'GET', `/products/${pendingProduct.product_code}`)).data
  record('품목', '검수 전 품목 상품: 손님 화면에 보관·안전 정보 숨김', `${pendingProduct.name}: pending ${pendingDetail.item?.pending}, 보관법 ${pendingDetail.item?.storage_method ? '보임' : '숨김'}, 당도 표시 ${pendingDetail.item?.show_brix}`, pendingDetail.item?.pending === true && !pendingDetail.item?.storage_method)

  // 관리자가 감귤을 검수하면 바로 손님 화면에 나오는지 (끝나면 검수 전으로 되돌린다)
  const mandarin = pending.find((i) => i.item_code === 'mandarin')
  if (mandarin) {
    itemsToRestore.push('mandarin')
    const approved = await call(admin, 'POST', '/admin/items/mandarin/approve')
    const product = sim.find((p) => p.item_code === 'mandarin' && p.status === 'active' && !p.sold_out)
    const after = (await call(null, 'GET', `/products/${product.product_code}`)).data
    record('품목', '감귤 검수 → 손님 화면에 보관법·당도가 나옴', `검수 ${approved.status}, 보관법 ${after.item?.storage_method ? '보임' : '숨김'}, 당도 표시 ${after.item?.show_brix}`, approved.status === 200 && Boolean(after.item?.storage_method))
  }

  // ---------- 3. 농가 ----------
  const sellers = (await call(admin, 'GET', '/admin/sellers')).data
  const realIds = (s) => (s.login_ids ?? '').split(', ').filter((id) => id && !id.startsWith('sa_'))
  const noLogin = sellers.filter((s) => !s.is_company && (s.products ?? 0) > 0 && !realIds(s).length)
  record('농가', '상품은 있는데 농가 로그인 계정이 없는 농가 (회사 직영 제외)', noLogin.length ? `${noLogin.length}곳 (${noLogin.map((s) => s.name.replace('[예시] ', '')).join(', ')})` : `없음 (농가 ${sellers.filter((s) => !s.is_company && (s.products ?? 0) > 0).length}곳 모두 계정 있음)`, noLogin.length === 0)
  const joined = sellers.filter((s) => PLAN.farms.some((f) => realIds(s).includes(f.login)))
  record('농가', '가입 신청으로 들어온 농가: 승인됨·상품 있음', `${joined.length}/${PLAN.farms.length}곳, 승인 ${joined.filter((s) => s.status === 'active').length}곳, 가입 신청 날짜 있음 ${joined.filter((s) => s.applied_at).length}곳, 상품 ${joined.reduce((n, s) => n + s.products, 0)}개`,
    joined.length === PLAN.farms.length && joined.every((s) => s.status === 'active' && s.applied_at && s.products > 0))

  // ---------- 4. 대시보드·문의 ----------
  const dash = (await call(admin, 'GET', '/admin/dashboard')).data
  const low = (await db.query("SELECT count(*)::int AS n FROM products WHERE status = 'active' AND stock <= 5")).rows[0].n
  record('대시보드', '재고 부족 목록 = DB 재고 5개 이하', `화면 ${dash.lowStock.length}개, DB ${low}개 (${dash.lowStock.map((p) => `${p.name.replace('[예시] ', '')} ${p.stock}`).join(', ')})`, dash.lowStock.length === low)
  const unanswered = (await db.query('SELECT count(*)::int AS n FROM questions WHERE answer IS NULL AND NOT hidden')).rows[0].n
  record('대시보드', '답변 대기 문의 = DB', `화면 ${dash.todo.unanswered}, DB ${unanswered}`, dash.todo.unanswered === unanswered)

  // ---------- 5. 손님 화면과 관리자 화면 ----------
  const catalog = (await call(null, 'GET', '/catalog?size=50')).data
  record('손님 화면', '상품 목록 수 = 판매 중 상품 수', `손님 ${catalog.total}개, 판매 중 ${dbCounts.active}개, 페이지 ${catalog.pages}쪽`, catalog.total === dbCounts.active)
  const lastPage = (await call(null, 'GET', `/catalog?size=50&page=${catalog.pages}`)).data
  const soldLast = lastPage.items.slice(-1)[0]
  record('손님 화면', '품절 상품은 목록 맨 뒤', `마지막 상품 ${soldLast?.name} (품절 ${soldLast?.sold_out})`, soldLast?.sold_out === true)
  const options = (await call(null, 'GET', '/recommend/options')).data
  record('손님 화면', '추천받기 선택지 상품 수 = 살 수 있는 상품 수', `${options.products.length}개, 품절 ${options.soldOut}개`, options.products.length + options.soldOut === dbCounts.active)

  // ---------- 6. 주문: 여러 농가를 한 번에 ----------
  const pick = (code) => adminProducts.find((p) => p.product_code === code)
  const carrot = pick('namwon_carrot_3kg')
  const onion = pick('haenam_green_onion_1kg')
  const garlic = pick('uiseong_garlic_peeled_1kg')
  const multi = await placeOrder(orderBody([{ productCode: carrot.product_code, quantity: 1 }, { productCode: onion.product_code, quantity: 2 }, { productCode: garlic.product_code, quantity: 5 }]))
  const lines = [[carrot, 1], [onion, 2], [garlic, 5]]
  const byFarm = new Map()
  for (const [p, q] of lines) byFarm.set(p.seller_code, (byFarm.get(p.seller_code) ?? 0) + p.price * q)
  const expectFee = [...byFarm.values()].reduce((n, amount) => n + (amount >= SHIPPING.freeOver ? 0 : SHIPPING.fee), 0)
  const expectTotal = [...byFarm.values()].reduce((n, v) => n + v, 0) + expectFee
  record('주문', '농가 3곳 주문: 배송비가 농가마다 붙음', `결제 금액 ${won(multi.data?.amount ?? 0)}, 기대 ${won(expectTotal)} (배송비 ${won(expectFee)} — 의성은 ${won(byFarm.get(UISEONG))}라 무료)`, multi.data?.amount === expectTotal)
  const paid = await pay(multi.data)
  const stocks = (await db.query('SELECT product_code, stock FROM products WHERE product_code = ANY($1)', [lines.map(([p]) => p.product_code)])).rows
  const stockOk = lines.every(([p, q]) => stocks.find((s) => s.product_code === p.product_code)?.stock === touchedProducts.get(p.product_code).stock - q)
  record('주문', '결제 후 세 상품 재고가 주문 수만큼 줄어듦', `결제 ${paid.status}, ${lines.map(([p, q]) => `${p.name.replace('[예시] ', '')} ${touchedProducts.get(p.product_code).stock}→${stocks.find((s) => s.product_code === p.product_code)?.stock} (-${q})`).join(', ')}`, paid.status === 200 && stockOk)

  // 농가 화면: 해남은 해남 상품만 보인다
  const haenamOrders = (await call(haenam, 'GET', '/seller/orders')).data
  const mine = haenamOrders.find((o) => o.order_label === maskOrderNo(multi.data.orderNo)) // 농가 화면에는 주문번호 전체 대신 가린 번호만 온다
  record('농가', '해남 농가 화면: 이 주문에서 해남 상품만 보임', `상품 ${mine?.items.map((i) => i.name.replace('[예시] ', '')).join(', ')}, 농가 수 ${mine?.farms}, 배송비 ${won(mine?.shipping_fee ?? 0)}`, mine && mine.items.length === 1 && mine.items[0].name === onion.name && mine.farms === 3)

  // 해남: 배송 준비 → 배송 중(송장) → 배송 완료. 다른 농가 배송은 그대로
  const step1 = await call(haenam, 'PATCH', `/seller/orders/${multi.data.orderNo}`, { status: 'preparing' })
  const step2 = await call(haenam, 'PATCH', `/seller/orders/${multi.data.orderNo}`, { status: 'shipping', courier: 'CJ대한통운', trackingNo: '123456789012' })
  const step3 = await call(admin, 'PATCH', `/admin/orders/${multi.data.orderNo}`, { status: 'delivered', sellerCode: HAENAM })
  const detail = (await call(admin, 'GET', `/admin/orders/${multi.data.orderNo}`)).data
  const shipments = (detail.shipments ?? []).map((s) => `${s.seller_name ?? s.seller_code}: ${s.status}`)
  record('주문', '해남만 배송 완료, 나머지 농가는 결제 완료 그대로', `단계 ${step1.status}/${step2.status}/${step3.status}, 주문 상태 ${detail.status}, ${shipments.join(', ')}`,
    [step1.status, step2.status].every((s) => s === 204) && step3.status === 200 && (detail.shipments ?? []).filter((s) => s.status === 'delivered').length === 1)

  // 남원 농가가 해남 배송을 바꾸려 하면 막혀야 한다 (남원 상품도 이 주문에 있으니 남원 몫만 바뀌어야)
  const namwonTry = await call(namwon, 'PATCH', `/seller/orders/${multi.data.orderNo}`, { status: 'preparing', sellerCode: HAENAM })
  const after = (await call(admin, 'GET', `/admin/orders/${multi.data.orderNo}`)).data
  const haenamShip = after.shipments?.find((s) => s.seller_code === HAENAM)
  const namwonShip = after.shipments?.find((s) => s.seller_code === NAMWON)
  record('농가', '남원이 sellerCode로 해남을 고르면 남원 몫만 바뀜', `응답 ${namwonTry.status}, 해남 ${haenamShip?.status}, 남원 ${namwonShip?.status}`, haenamShip?.status === 'delivered' && namwonShip?.status === 'preparing')

  // 관리자 할 일: 아직 준비 안 한 농가 배송이 있는 주문이 "준비할 주문"에 남아 있어야 한다
  const todo = (await call(admin, 'GET', '/admin/dashboard')).data.todo
  const waitingShipments = (await db.query(`SELECT count(DISTINCT o.id)::int AS n FROM orders o JOIN order_shipments sh ON sh.order_id = o.id
    WHERE sh.status = 'paid' AND o.status NOT IN ('pending', 'failed', 'expired', 'cancelled') AND (sh.ship_from IS NULL OR sh.ship_from <= (now() AT TIME ZONE 'Asia/Seoul')::date)`)).rows[0].n
  const listed = (await call(admin, 'GET', '/admin/orders?status=paid')).data
  const inList = listed.some((o) => o.order_no === multi.data.orderNo)
  record('대시보드', '준비 안 한 농가 배송이 있는 주문 = "준비할 주문" (주문 상태가 배송 중이어도)', `대시보드 ${todo.to_prepare}건, 실제 ${waitingShipments}건, 결제 완료 목록에 이 주문 ${inList ? '있음' : '없음'} (이 주문: ${after.status}, 남원 ${namwonShip?.status}, 의성 ${after.shipments?.find((s) => s.seller_code === UISEONG)?.status})`,
    todo.to_prepare === waitingShipments && inList, '고침: 할 일과 결제 완료·배송 준비 목록을 농가 배송 기준으로 센다')

  // ---------- 7. 주문: 옵션·품절·예약 ----------
  const mandarinS = (await call(null, 'GET', '/products/namwon_mandarin_s_5kg')).data
  const opt10 = mandarinS.options?.find((o) => o.name.startsWith('10kg'))
  const optOrder = await placeOrder(orderBody([{ productCode: 'namwon_mandarin_s_5kg', optionId: opt10?.id, quantity: 1 }], '01055668801'))
  await pay(optOrder.data)
  const optNow = (await db.query('SELECT o.stock AS option_stock, p.stock FROM product_options o JOIN products p USING (product_code) WHERE o.id = $1', [opt10?.id])).rows[0]
  record('주문', '옵션(10kg) 주문: 옵션 재고와 상품 재고가 함께 줄어듦', `옵션 ${touchedOptions.get(opt10?.id)}→${optNow?.option_stock}, 상품 ${touchedProducts.get('namwon_mandarin_s_5kg').stock}→${optNow?.stock}, 결제 금액 ${won(optOrder.data?.amount ?? 0)} (옵션 ${won(opt10?.price ?? 0)})`,
    optNow?.option_stock === touchedOptions.get(opt10?.id) - 1 && optNow?.stock === touchedProducts.get('namwon_mandarin_s_5kg').stock - 1)

  const soldOut = sim.find((p) => p.status === 'active' && p.sold_out && !p.options?.length)
  const soldTry = await placeOrder(orderBody([{ productCode: soldOut.product_code, quantity: 1 }], '01055668802'))
  record('주문', '품절 상품 주문은 막힘', `${soldOut.name}: 응답 ${soldTry.status}`, soldTry.status === 409)

  // 예약 상품: 절임배추(11/20부터) + 같은 농가 무 + 다른 농가 당근을 한 주문으로
  const preorder = pick('haenam_salted_10kg')
  const radish = pick('haenam_radish_3')
  const preDetail = (await call(null, 'GET', `/products/${preorder.product_code}`)).data
  record('예약', '상품 화면: 예약 상품 표시와 출고 시작일', `preorder ${preDetail.preorder}, 출고 시작일 ${preDetail.ship_from}`, preDetail.preorder === true && preDetail.ship_from === preorder.ship_from)
  const before = (await call(admin, 'GET', '/admin/dashboard')).data.todo
  const preTry = await placeOrder(orderBody([{ productCode: preorder.product_code, quantity: 1 }, { productCode: radish.product_code, quantity: 1 }, { productCode: carrot.product_code, quantity: 1 }], '01055668803'))
  const prePaid = await pay(preTry.data)
  const looked = (await call(null, 'POST', '/orders/lookup', { orderNo: preTry.data?.orderNo, phone: '01055668803' })).data
  const hShip = looked?.shipments?.find((s) => s.seller_code === HAENAM)
  const nShip = looked?.shipments?.find((s) => s.seller_code === NAMWON)
  const hItems = (await db.query('SELECT name, ship_from FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.order_no = $1 ORDER BY oi.id', [preTry.data?.orderNo])).rows
  record('예약', '예약 상품 주문: 주문 상품·농가 배송에 출고 시작일 저장 (같은 농가는 함께, 다른 농가는 바로)', `결제 ${prePaid.status}, 해남 배송 ${hShip?.ship_from ?? '-'}, 남원 배송 ${nShip?.ship_from ?? '없음'}, 주문 상품 ${hItems.map((i) => `${i.name.replace('[예시] ', '')} ${i.ship_from ?? '-'}`).join(', ')}`,
    prePaid.status === 200 && hShip?.ship_from === preorder.ship_from && !nShip?.ship_from && hItems.filter((i) => i.ship_from).length === 1)
  record('예약', '주문 조회의 출고 안내', String(looked?.shipping_note ?? '').replace(/\n/g, ' / '), /11월 20일부터/.test(looked?.shipping_note ?? '') && /나머지 상품은 결제 후 1~3일/.test(looked?.shipping_note ?? ''))
  const afterPre = (await call(admin, 'GET', '/admin/dashboard')).data.todo
  record('예약', '대시보드: 예약 대기 주문은 따로, 남원 몫은 준비할 주문으로', `예약 대기 ${before.preorders_waiting}→${afterPre.preorders_waiting} (가장 빠른 출고 ${afterPre.next_ship_from}), 준비할 주문 ${before.to_prepare}→${afterPre.to_prepare}`,
    afterPre.preorders_waiting === before.preorders_waiting + 1 && afterPre.to_prepare === before.to_prepare + 1)
  const haenamList = (await call(haenam, 'GET', '/seller/orders')).data
  const hRow = haenamList.find((o) => o.order_label === maskOrderNo(preTry.data?.orderNo))
  const adminRow = (await call(admin, 'GET', '/admin/orders')).data.find((o) => o.order_no === preTry.data?.orderNo)
  record('예약', '농가·관리자 주문 목록에 예약 출고일 표시', `해남 화면 ${hRow?.ship_from ?? '-'}, 관리자 목록 ${adminRow?.ship_from ?? '-'}`, hRow?.ship_from === preorder.ship_from && adminRow?.ship_from === preorder.ship_from)

  // ---------- 8. 농가 상품 수정 ----------
  const own = pick('namwon_broccoli_1kg')
  await remember(own.product_code)
  const edit = await call(namwon, 'PATCH', `/seller/products/${own.product_code}`, { price: String(own.price + 500) })
  const changes = (await call(admin, 'GET', `/admin/products/${own.product_code}/changes`)).data
  const other = await call(namwon, 'PATCH', `/seller/products/${pick('haenam_radish_3').product_code}`, { price: '1' })
  record('농가', '남원이 자기 상품 가격 수정 → 관리자 변경 기록에 남음 / 남의 상품은 막힘', `수정 ${edit.status}${edit.data?.error ? ` (${edit.data.error})` : ''}, 변경 기록 ${Array.isArray(changes) ? changes.length : '-'}건, 남의 상품 ${other.status}`,
    edit.status === 200 && Array.isArray(changes) && changes.length > 0 && other.status === 404)
  const settlement = (await call(haenam, 'GET', '/seller/orders/settlement')).data
  record('농가', '해남 정산: 다른 농가가 아직 안 보내도 배송을 마친 해남 몫은 확정 대기로', `확정 대기 ${won(settlement?.waiting_amount ?? 0)} (대파 ${won(onion.price * 2)}), 배송비 ${won(settlement?.waiting_shipping ?? 0)}`, settlement?.waiting_amount === onion.price * 2,
    '고침: 정산 대기는 내 농가 배송이 끝났으면 센다. 구매 확정은 주문 전체 기준 그대로')

  // ---------- 9. 상담 챗봇 (AI 없이) ----------
  const ask = async (message) => { askedQuestions.push(message); return (await call(null, 'POST', '/chat', { message })).data }
  const price = await ask('감귤 얼마예요?')
  const mandarinPrices = sim.filter((p) => p.item_code === 'mandarin' && p.status === 'active').map((p) => p.price)
  record('상담', '"감귤 얼마예요?" → 판매 중인 감귤 가격으로 바로 답함', String(price.answer).slice(0, 120),
    !/찾지 못했어요/.test(price.answer) && mandarinPrices.some((v) => String(price.answer).replaceAll(',', '').includes(String(v))))
  const storage = await ask('표고버섯 보관 어떻게 해요?')
  record('상담', '검수 전 품목 보관법 질문 → 초안을 답하지 않고 담당자 확인 중이라고 함', String(storage.answer).slice(0, 90), /확인하고 있어요|확인 중/.test(storage.answer))
  const where = await ask('절임배추 언제 받을 수 있어요?')
  record('상담', '"절임배추 언제 받을 수 있어요?" → 예약 출고일', String(where.answer).slice(0, 120), /11월 20일부터/.test(where.answer))
  const gotgam = await ask('곶감 언제 보내요?')
  record('상담', '"곶감 언제 보내요?" → 예약 곶감과 바로 보내는 곶감을 나눠 답함', String(gotgam.answer).slice(0, 160), /12월/.test(gotgam.answer) && /1~3일/.test(gotgam.answer))
  const list = await ask('예약 판매하는 거 있어요?')
  record('상담', '"예약 판매하는 거 있어요?" → 예약 상품 목록', String(list.answer).slice(0, 160), /예약 판매하는 상품은 \d+개/.test(list.answer))
  const normal = await ask('사과 언제 와요?')
  record('상담', '"사과 언제 와요?" → 결제 후 1~3일', String(normal.answer).slice(0, 120), /1~3일/.test(normal.answer) && !/예약 상품이라/.test(normal.answer))
} catch (error) {
  console.error(`시뮬레이션 중단: ${error.stack}`)
  exitCode = 1
} finally {
  child?.kill()
  // 되돌리기: 하나가 실패해도 나머지는 계속한다 (시험 계정이 남지 않게)
  const undo = [
    ['주문', () => db.query('DELETE FROM orders WHERE order_no = ANY($1)', [createdOrders])],
    ['재고·가격', async () => { for (const [code, p] of touchedProducts) await db.query('UPDATE products SET stock = $2, price = $3 WHERE product_code = $1', [code, p.stock, p.price]) }],
    ['옵션 재고', async () => { for (const [id, stock] of touchedOptions) await db.query('UPDATE product_options SET stock = $2 WHERE id = $1', [id, stock]) }],
    ['품목 상태', async () => { for (const code of itemsToRestore) await db.query("UPDATE items SET status = 'pending', reviewed_by = NULL WHERE item_code = $1", [code]) }],
    ['변경 기록', () => started && db.query('DELETE FROM product_changes WHERE product_code = ANY($1) AND changed_at >= $2', [[...touchedProducts.keys()], started])],
    ['메일', () => db.query('DELETE FROM email_outbox WHERE id > $1', [outboxBefore])],
    ['상담 기록', () => db.query('DELETE FROM chat_logs WHERE question = ANY($1)', [askedQuestions])],
    ['접속 기록', () => db.query('DELETE FROM access_logs WHERE login_id = ANY($1)', [ACCOUNTS.map((a) => a[0])])],
    ['시험 계정', () => db.query('DELETE FROM admins WHERE login_id = ANY($1)', [ACCOUNTS.map((a) => a[0])])],
  ]
  for (const [name, run] of undo) {
    try { await run() } catch (error) { console.error(`되돌리기 실패 (${name}): ${error.message}`); exitCode = 1 }
  }
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const mark = (ok) => (ok === true ? '맞음' : ok === 'warn' ? '확인 필요' : '어긋남')
await writeFile(new URL('../docs/admin_simulation.md', import.meta.url), `# 관리자·농가 시뮬레이션

- 실행: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · \`npm run sim-admin\`
- 예시 농가 데이터(\`npm run simulate-farms\`)를 넣은 뒤, 관리자와 농가가 하는 일을 시험 계정과 시험 결제(mock)로 해 보고 화면 숫자와 DB를 맞춰 봤다
- 시험 계정·주문·기록은 끝나고 지웠고, 재고·가격·품목 상태는 처음 값으로 되돌렸다
- 맞음 ${results.filter((r) => r.ok === true).length} · 어긋남 ${results.filter((r) => r.ok === false).length} · 확인 필요 ${results.filter((r) => r.ok === 'warn').length}

| 영역 | 확인한 것 | 결과 | 판정 | 메모 |
|---|---|---|---|---|
${results.map((r) => `| ${r.area} | ${cell(r.name)} | ${cell(r.actual)} | ${mark(r.ok)} | ${cell(r.detail)} |`).join('\n')}
`)
console.log(`\n맞음 ${results.filter((r) => r.ok === true).length} · 어긋남 ${results.filter((r) => r.ok === false).length} · 확인 필요 ${results.filter((r) => r.ok === 'warn').length} → docs/admin_simulation.md`)
await db.end()
process.exit(exitCode)
