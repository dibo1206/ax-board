// 배송 달력·소비기한·찜·단골·판매자 정보 시험 (2026-11-20): npm run test-extras
//   1) 날짜 계산 (DB 없이): 마감 전·후, 주말, 공휴일, 당일 출고, 일요일 배송 없음, 예약 상품
//   2) 소비기한 글 읽기: 받은 날 기준 숫자만 읽고, 제조일·익은 뒤·[예시]·상태 안내는 읽지 않음
//   3) 설정 검사: 새 칸이 없으면 지금 값 유지, 잘못된 요일·날짜·판매 방식은 막음
//   4) API: 찜·단골은 로그인해야 되고, 여러 번 눌러도 같고, 없는 상품·농가는 404, 탈퇴하면 지워짐
//   5) 판매자 정보: 사업자 농가만 대표자·사업자번호, 개인 농가는 상호·지역만, 회사 직영은 null. 연락처·이메일은 어디에도 없음
// 만든 회원은 끝나고 번호(id)로만 지운다. 백엔드 사본은 빈 포트로 따로 띄운다.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { lookupHash } from '../server/crypto.js'
import { openSeller } from '../server/pii.js'
import { DEFAULT_SHIPPING, validateSettings } from '../server/policy.js'
import { deliveryPlan, expiryDate, expiryDays } from '../src/shop/delivery.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '통과' : '실패'} ${name}${detail ? `  (${detail})` : ''}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// 한국 시간 'YYYY-MM-DD HH:MM' → Date
const kst = (s) => new Date(`${s.replace(' ', 'T')}:00+09:00`)

// ---------- 1) 날짜 계산 ----------
const S = { ...DEFAULT_SHIPPING, cutoffHour: 14, leadDays: 1, transitDays: 1, noShipDays: [0, 6], holidays: ['2026-12-25', '2027-01-01'] }
const plan = (now, extra = {}, opts = {}) => {
  const p = deliveryPlan({ ...S, ...extra }, { now: kst(now), ...opts })
  return [p.shipDate, p.arriveDate]
}
check('금 10시 주문 → 월 출고·화 도착', same(plan('2026-11-20 10:00'), ['2026-11-23', '2026-11-24']), plan('2026-11-20 10:00').join(' '))
check('금 15시(마감 뒤) 주문 → 화 출고·수 도착', same(plan('2026-11-20 15:00'), ['2026-11-24', '2026-11-25']), plan('2026-11-20 15:00').join(' '))
check('토요일 주문 → 월요일 주문으로 쳐서 화 출고', same(plan('2026-11-21 10:00'), ['2026-11-24', '2026-11-25']), plan('2026-11-21 10:00').join(' '))
check('당일 출고(0일) 금 10시 → 금 출고·토 도착', same(plan('2026-11-20 10:00', { leadDays: 0 }), ['2026-11-20', '2026-11-21']))
check('성탄절 건너뜀: 12/24(목) 주문 → 12/28(월) 출고', same(plan('2026-12-24 10:00'), ['2026-12-28', '2026-12-29']), plan('2026-12-24 10:00').join(' '))
check('일요일엔 배송 안 함: 토 출고 → 월 도착', same(plan('2026-11-21 10:00', { leadDays: 0, noShipDays: [0] }), ['2026-11-21', '2026-11-23']))
check('자정 바로 전(23:59 KST)도 한국 날짜로 계산', same(plan('2026-11-23 23:59', { cutoffHour: 24, leadDays: 0 }), ['2026-11-23', '2026-11-24']))
const pre = deliveryPlan(S, { now: kst('2026-11-20 10:00'), shipFrom: '2026-12-05' })
check('예약 상품: 출고 시작일(토) 뒤 첫 출고일(월)에 출고', pre.preorder && pre.shipDate === '2026-12-07' && pre.arriveDate === '2026-12-08', `${pre.shipDate} ${pre.arriveDate}`)
const past = deliveryPlan(S, { now: kst('2026-11-20 10:00'), shipFrom: '2026-11-01' })
check('출고 시작일이 지났으면 예약 아님', !past.preorder && past.shipDate === '2026-11-23')
check('설정이 비어도 기본값(14시 마감·당일 출고)으로 계산', same(deliveryPlan({}, { now: kst('2026-11-20 10:00') }).shipDate, '2026-11-20'))
const def = deliveryPlan(DEFAULT_SHIPPING, { now: kst('2026-11-23 13:59') })
check('기본 설정: 월 13:59 주문 → 월 출고·화 도착 (회사 안내 "오후 2시까지 결제하면 그날")', def.shipDate === '2026-11-23' && def.arriveDate === '2026-11-24', `${def.shipDate} ${def.arriveDate}`)
const late = deliveryPlan(DEFAULT_SHIPPING, { now: kst('2026-11-23 14:00') })
check('기본 설정: 월 14:00 주문 → 화 출고', late.shipDate === '2026-11-24', late.shipDate)

// ---------- 2) 소비기한 글 ----------
for (const [text, want] of [
  ['받은 뒤 상태를 보며 되도록 빨리 드세요 (보관법은 상품 정보 참고)', null],
  ['[예시] 제품 라벨에 표시', null],
  ['제조일로부터 18개월', null],
  ['익은 뒤 냉장해 3~5일 안에 드세요', null],
  ['냉장고 채소 칸에서 1~2주 품질 유지 (참고값)', 7],
  ['수령 후 약 0℃ 냉장에서 2~3주', 14],
  ['받은 날부터 냉장 5일', 5],
  ['', null],
]) check(`소비기한 읽기: "${text || '(빈 글)'}" → ${want ?? '읽지 않음'}`, expiryDays(text) === want, String(expiryDays(text)))
check('소비기한 날짜: 11/24 도착 + 3일 → 11/26 (받은 날이 1일째)', expiryDate('2026-11-24', '받은 날부터 냉장 3일') === '2026-11-26')

// ---------- 3) 설정 검사 ----------
const base = { fee: 4500, freeOver: 30000, courier: 'CJ대한통운', leadTime: '결제 후 1~3일' }
const kept = validateSettings('shipping', base)
check('예전 화면처럼 새 칸 없이 저장해도 달력 값 유지', !kept.errors.length && kept.value.cutoffHour === DEFAULT_SHIPPING.cutoffHour && same(kept.value.noShipDays, DEFAULT_SHIPPING.noShipDays))
const good = validateSettings('shipping', { ...base, cutoffHour: '15', leadDays: '0', transitDays: '2', noShipDays: [6, 0, 0], holidays: '2026-12-31\n2026-12-25, 2026-12-25' })
check('글자 숫자·중복 요일·쉼표/줄바꿈 날짜 정리', !good.errors.length && good.value.cutoffHour === 15 && same(good.value.noShipDays, [0, 6]) && same(good.value.holidays, ['2026-12-25', '2026-12-31']), good.errors.join(' '))
check('7일 모두 쉬면 막음', validateSettings('shipping', { ...base, noShipDays: [0, 1, 2, 3, 4, 5, 6] }).errors.length > 0)
check('없는 날짜(2월 30일)는 막음', validateSettings('shipping', { ...base, holidays: ['2026-02-30'] }).errors.length > 0)
check('이상한 요일 값은 막음', validateSettings('shipping', { ...base, noShipDays: [9] }).errors.length > 0)
check('배송 25일 같은 큰 값은 막음', validateSettings('shipping', { ...base, transitDays: 25 }).errors.length > 0)
const shopBase = { name: '윤주 마켓', company: '회사', ceo: '대표', bizNo: '235-87-03341', mailOrderNo: '1', address: '주소', phone: '041-544-2566', email: 'a@b.co', hours: '평일', privacyOfficer: '담당' }
check('판매 방식은 broker·direct 만', validateSettings('shop', { ...shopBase, saleMode: 'agent' }).errors.length > 0 && !validateSettings('shop', { ...shopBase, saleMode: 'direct', brokerNotice: '' }).errors.length)
check('중개인데 고지 글을 비우면 막음', validateSettings('shop', { ...shopBase, saleMode: 'broker', brokerNotice: ' ' }).errors.length > 0)

// ---------- 4·5) API ----------
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })
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
const baseUrl = `http://127.0.0.1:${backend.port}`
let n = 0
async function hit(method, path, { body, cookie } = {}) {
  n += 1
  const headers = { 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': `10.151.${Math.floor(n / 250)}.${n % 250}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  const res = await fetch(baseUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 글자 응답 */ }
  return { status: res.status, text, json, cookie: res.headers.get('set-cookie') ?? '' }
}
const createdCustomers = []

try {
  const control = await hit('GET', '/api/products')
  if (control.status !== 200) { console.log(`대조 실패: /api/products ${control.status}`); process.exitCode = 2; throw new Error('stop') }

  const policy = await hit('GET', '/api/policy')
  check('/api/policy 에 배송 달력·판매 방식 값', Number.isInteger(policy.json?.shipping?.cutoffHour) && Array.isArray(policy.json?.shipping?.noShipDays) && ['broker', 'direct'].includes(policy.json?.shop?.saleMode))

  const product = (await db.query("SELECT product_code, seller_code FROM products WHERE status = 'active' ORDER BY created_at LIMIT 1")).rows[0]
  const farm = (await db.query("SELECT s.seller_code FROM sellers s WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM products p WHERE p.seller_code = s.seller_code AND p.status = 'active') ORDER BY s.seller_code LIMIT 1")).rows[0]

  // 로그인 없이
  const anon = await Promise.all([hit('GET', '/api/account/saved'), hit('PUT', `/api/account/wishlist/${product.product_code}`), hit('PUT', `/api/account/follows/${farm.seller_code}`)])
  check('로그인 없이 찜·단골 못 함 (401)', anon.every((r) => r.status === 401), anon.map((r) => r.status).join(','))

  // 시험 회원 (비밀번호는 만들어 쓰고 출력하지 않는다)
  const email = `extras_${randomBytes(5).toString('hex')}@example.invalid`
  const password = `Zxq${randomBytes(9).toString('hex')}!`
  const signup = await hit('POST', '/api/account/signup', { body: { email, password, name: '시험회원', phone: '01099997777', agreeTerms: true, agreePrivacy: true, agreeAge: true } })
  const row = (await db.query('SELECT id FROM customers WHERE email_hash = $1', [lookupHash(email.toLowerCase())])).rows[0]
  if (row) createdCustomers.push(row.id)
  const cookie = (signup.cookie.match(/customer_session=[^;]+/) || [''])[0]
  check('시험 회원 가입', signup.status === 201 && Boolean(cookie), String(signup.status))

  const put1 = await hit('PUT', `/api/account/wishlist/${product.product_code}`, { cookie })
  const put2 = await hit('PUT', `/api/account/wishlist/${product.product_code}`, { cookie })
  check('찜 담기 두 번 눌러도 204', put1.status === 204 && put2.status === 204, `${put1.status},${put2.status}`)
  const count = (await db.query('SELECT count(*)::int AS n FROM wishlists WHERE customer_id = $1', [row.id])).rows[0].n
  check('찜은 한 줄만 저장', count === 1, String(count))
  const nf = await Promise.all([hit('PUT', '/api/account/wishlist/NO-SUCH-PRODUCT-1', { cookie }), hit('PUT', '/api/account/wishlist/..%2f..%2fetc', { cookie }), hit('PUT', '/api/account/follows/no-such-farm', { cookie })])
  check('없는 상품·이상한 코드·없는 농가는 404', nf.every((r) => r.status === 404), nf.map((r) => r.status).join(','))
  const fol = await hit('PUT', `/api/account/follows/${farm.seller_code}`, { cookie })
  check('단골 맺기 204', fol.status === 204, String(fol.status))
  const saved = await hit('GET', '/api/account/saved', { cookie })
  check('내 찜·단골 목록에 보임', saved.json?.products?.includes(product.product_code) && saved.json?.farms?.includes(farm.seller_code))
  const farmPage = await hit('GET', `/api/farms/${farm.seller_code}`)
  check('농가 페이지에 단골 수', Number.isInteger(farmPage.json?.followers) && farmPage.json.followers >= 1, String(farmPage.json?.followers))
  const del = await hit('DELETE', `/api/account/wishlist/${product.product_code}`, { cookie })
  const del2 = await hit('DELETE', `/api/account/wishlist/${product.product_code}`, { cookie })
  const after = await hit('GET', '/api/account/saved', { cookie })
  check('찜 빼기 (두 번 빼도 204)', del.status === 204 && del2.status === 204 && !after.json?.products?.includes(product.product_code))

  // 다른 회원은 내 목록을 못 본다: 쿠키 없이·가짜 쿠키
  const fake = await hit('GET', '/api/account/saved', { cookie: 'customer_session=abc.def' })
  check('가짜 쿠키로 남의 찜 못 봄', fake.status === 401, String(fake.status))

  // 5) 판매자 정보
  const sellers = (await db.query(`SELECT s.seller_code, s.is_company, s.phone, s.email, s.owner_name, s.business_no,
      (SELECT p.product_code FROM products p WHERE p.seller_code = s.seller_code AND p.status = 'active' ORDER BY p.created_at LIMIT 1) AS product_code
    FROM sellers s WHERE s.status = 'active'`)).rows.map(openSeller).filter((s) => s.product_code)
  const company = sellers.find((s) => s.is_company)
  const business = sellers.find((s) => !s.is_company && s.business_no?.trim())
  const individual = sellers.find((s) => !s.is_company && !s.business_no?.trim())
  const secrets = (s) => [s.phone, s.email].map((v) => String(v ?? '').trim()).filter((v) => v.length >= 5)
  for (const [label, seller, test] of [
    ['회사 직영 → seller_info 없음(회사 정보 사용)', company, (d) => d.seller_info === null],
    ['사업자 농가 → 상호·대표자·사업자번호', business, (d) => d.seller_info?.kind === 'business' && d.seller_info.business_no === business.business_no.trim()],
    ['개인 농가 → 상호·지역만', individual, (d) => d.seller_info?.kind === 'individual' && !('owner' in d.seller_info) && !('business_no' in d.seller_info)],
  ]) {
    if (!seller) { console.log(`건너뜀 ${label} (그런 농가가 없음)`); continue }
    const d = await hit('GET', `/api/products/${encodeURIComponent(seller.product_code)}`)
    check(label, d.status === 200 && test(d.json))
    const leaked = secrets(seller).filter((v) => d.text.includes(v))
    check(`  └ 판매자 연락처·이메일이 응답에 없음`, leaked.length === 0 && !('owner_name' in (d.json?.seller ?? {})) && !('business_no' in (d.json?.seller ?? {})))
  }

  // 탈퇴하면 찜·단골도 지운다
  await hit('PUT', `/api/account/wishlist/${product.product_code}`, { cookie })
  const bye = await hit('DELETE', '/api/account/me', { cookie, body: { password } })
  const left = (await db.query('SELECT (SELECT count(*) FROM wishlists WHERE customer_id = $1)::int + (SELECT count(*) FROM farm_follows WHERE customer_id = $1)::int AS n', [row.id])).rows[0].n
  check('탈퇴하면 찜·단골이 지워짐', bye.status === 204 && left === 0, `${bye.status}, 남은 ${left}`)
} catch (error) {
  if (error.message !== 'stop') { console.log(`오류: ${error.message}`); results.push(false) }
} finally {
  backend.kill('SIGTERM')
  if (createdCustomers.length) await db.query('DELETE FROM customers WHERE id = ANY($1::int[])', [createdCustomers]).catch(() => {})
  await db.end()
}
const ok = results.filter(Boolean).length
console.log(`\n${ok}/${results.length} 통과`)
process.exit(process.exitCode || (ok === results.length ? 0 : 1))
