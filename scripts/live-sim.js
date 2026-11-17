// 실시간 운영 시뮬레이션: 정한 시간(기본 30분) 동안 손님·농가·관리자가 실제 API로 움직인다
//   npm run live-sim                    30분, 손님 50명(그중 10명 구매, 15명 챗봇), 기존 농가 상품 10개, 새 농가 1곳 상품 3개
//   npm run live-sim -- --minutes 5     짧게 돌려 보기
// 백엔드 사본을 빈 포트로 띄우고 같은 DB를 쓴다. 결제는 시험 결제(mock), 챗봇은 [AI에게 물어보기]를 누르지 않는다 (토큰 0).
// 만든 주문·상품·문의·상담 기록은 남긴다 (관리자 화면에서 볼 수 있게). 승인만 하는 임시 관리자는 끝나면 지운다.
// 농가 계정은 npm run onboard-farms 가 만든 .farm-accounts.local.json 을 쓴다 (비밀번호는 화면·로그에 쓰지 않는다)
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import sharp from 'sharp'
import { hashPassword } from '../server/auth.js'
import { parseCsv } from './csv.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}
const MINUTES = arg('minutes', 30)
const VISITORS = 50
const BUYERS = 10
const CHATTERS = 15
const SEED = 'yoonju-live-2026-11-06'
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=farm', max: 1 })
const ACCOUNTS_FILE = new URL('../.farm-accounts.local.json', import.meta.url)
const REPORT = new URL('../docs/live_simulation.md', import.meta.url)
const BRIX_PHOTO = await sharp(fileURLToPath(new URL('../public/product-photos/brix-example.svg', import.meta.url))).png().toBuffer()

// ---------- 씨앗이 있는 난수 ----------
function rngFrom(text) {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rngFrom(SEED)
const pick = (list) => list[Math.floor(rand() * list.length)]
const between = (lo, hi) => lo + (hi - lo) * rand()
const shuffle = (list) => list.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- 백엔드 사본 ----------
function startBackend() {
  return new Promise((resolve, reject) => {
    // 벡터 검색은 켜 둔다 (손님 질문에 실제와 같게 답하게). AI 답변은 손님이 버튼을 누를 때만이라 부르지 않는다
    const env = { ...process.env, BACKEND_PORT: '0', NODE_ENV: 'development', DB_POOL_MAX: '1', REQUIRE_2FA: '0', ADMIN_ALLOWED_IPS: '', TOSS_CLIENT_KEY: '', TOSS_SECRET_KEY: '' }
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
const stats = { requests: 0, errors: [] }
// who.ip: 손님·농가마다 고정된 가상 주소 (요청 수 제한이 사람마다 걸리게)
async function call(who, method, path, body, raw = null) {
  for (let attempt = 1; ; attempt += 1) {
    stats.requests += 1
    const response = await fetch(`http://127.0.0.1:${child.port}/api${path}`, {
      method,
      headers: {
        'Content-Type': raw ? raw.type : 'application/json', 'x-proxy-secret': process.env.PROXY_SECRET ?? '', 'X-Forwarded-For': who?.ip ?? '10.80.0.1',
        ...(who?.cookie ? { Cookie: who.cookie } : {}),
      },
      body: raw ? raw.buffer : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    if (who) {
      const cookies = response.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
      if (cookies.length) who.cookie = cookies.join('; ')
    }
    const data = response.status === 204 ? null : await response.json().catch(() => null)
    // DB 연결이 잠깐 모자라면(503) 조금 기다렸다 다시 (실습 계정은 DB 연결이 5개뿐)
    if (response.status === 503 && attempt < 4) {
      await wait(1500 * attempt)
      continue
    }
    if (response.status >= 500) stats.errors.push(`${method} ${path} → ${response.status} ${data?.error ?? ''}`)
    return { status: response.status, data }
  }
}

// ---------- 기록 ----------
const started = Date.now()
const timeline = []
const clock = () => {
  const s = Math.round((Date.now() - started) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
function note(actor, action, result, ok = true) {
  timeline.push({ at: clock(), actor, action, result, ok })
  console.log(`[${clock()}] ${ok ? '✓' : '✗'} ${actor} · ${action} — ${result}`)
}
const label = (name) => String(name ?? '').replace(/\[예시\]\s*/g, '')
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`
const metrics = { visits: 0, pageViews: 0, details: 0, searches: 0, recommends: 0, carts: 0, orders: 0, paid: 0, revenue: 0, preorders: 0, chats: 0, chatModels: {}, handoffs: 0, aiButton: 0, registered: 0, autoApproved: 0, reviewed: 0, prepared: 0, shipped: 0 }

// ---------- 등장인물 ----------
const accounts = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {}
const SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍'
const GIVEN = ['민준', '서연', '지훈', '하은', '도윤', '수아', '예준', '지민', '현우', '유진', '은서', '준호', '미경', '영숙', '정희', '상철', '경자', '순자', '태호', '다은']
const person = (i) => `${SURNAMES[i % SURNAMES.length]}${GIVEN[(i * 7) % GIVEN.length]}`
const visitors = Array.from({ length: VISITORS }, (_, i) => ({ no: i + 1, name: person(i), ip: `10.81.${Math.floor(i / 200)}.${(i % 200) + 10}`, phone: `0105566${String(9100 + i).padStart(4, '0')}` }))
const buyers = new Set(shuffle(visitors).slice(0, BUYERS).map((v) => v.no))
const chatters = new Set(shuffle(visitors).slice(0, CHATTERS).map((v) => v.no))

// 손님 질문: 팀 밖 사람들이 실제로 쓴 질문(data/chat_eval_outside.csv) + 예약·배송 질문. 1~3개를 이어서 묻는다
const [header, ...outsideRows] = parseCsv(readFileSync(new URL('../data/chat_eval_outside.csv', import.meta.url), 'utf8'))
const outside = outsideRows.map((r) => r[header.indexOf('question')]).filter(Boolean)
const FOLLOW_UPS = ['그럼 언제 받을 수 있어요?', '배송비는 얼마예요?', '선물용으로 괜찮아요?', '더 싼 건 없어요?', '10kg도 있어요?', '예약 판매하는 거 있어요?', '절임배추 언제 와요?', '곶감 지금 주문하면 언제 와요?']

// 기존 농가가 새로 올리는 상품 10개 (농가 아이디 → 상품). 값은 시세 시뮬레이션(data/market_prices.csv) 범위 안의 예시
const fresh = (region, item, unit) => ({ origin: `국내산 (${region})`, expiry: '받은 뒤 상태를 보며 되도록 빨리 드세요 (보관법은 상품 정보 참고)', composition: `${item} ${unit}`, imported: false })
const made = (address, food, ingredients) => ({ food_type: `[예시] ${food}`, address: `[예시] ${address}`, packed: '[예시] 제품 라벨에 표시', expiry: '[예시] 제품 라벨에 표시', ingredients: `[예시] ${ingredients}`, nutrition: '[예시] 제품 라벨에 표시', imported: false })
const NEW_PRODUCTS = [
  ['namwon_gyul', { product_code: 'namwon_mandarin_2_5kg', item_code: 'mandarin', name: '[예시] 노지감귤 맛보기 2.5kg', price: 9900, unit: '2.5kg 1박스', stock: 80, variety: '노지 온주밀감', brix: '11.4', brix_measured_at: '2026-11-05', harvest_date: '2026-11-04', tags: ['home', 'raw', 'sweet', 'season'], summary: '처음 맛보는 분을 위한 작은 상자 노지감귤', notice: fresh('제주특별자치도 서귀포시', '감귤', '2.5kg 1박스') }],
  ['jinyeong_dangam', { product_code: 'jinyeong_persimmon_small_10kg', item_code: 'persimmon', name: '[예시] 단감 소과 10kg (가정용)', price: 39900, unit: '10kg 1박스', stock: 40, variety: '부유', harvest_date: '2026-11-02', tags: ['home', 'raw', 'sweet', 'season'], summary: '알이 작지만 단맛은 같은 가정용 소과 단감', notice: fresh('경상남도 김해시', '단감', '10kg 1박스') }],
  ['sangju_gotgam', { product_code: 'sangju_gotgam_mini_600g', item_code: 'dried_persimmon', name: '[예시] 상주 곶감 미니 선물 600g', price: 24900, unit: '600g 1상자', stock: 60, ship_from: '2026-12-15', tags: ['gift', 'sweet', 'keep_long'], summary: '작은 곶감을 담은 실속 선물. 12월 15일부터 보내요', notice: made('경상북도 상주시 외남면', '과채가공품', '감(국내산 상주) 100%') }],
  ['nonsan_berry', { product_code: 'nonsan_seolhyang_gift_1_5kg', item_code: 'strawberry', name: '[예시] 설향 딸기 선물 1.5kg', price: 42000, unit: '500g 3팩', stock: 30, variety: '설향', brix: '11.2', brix_measured_at: '2026-11-06', harvest_date: '2026-11-06', tags: ['gift', 'raw', 'sweet', 'eat_soon'], summary: '알이 고른 첫물 설향 딸기 선물 상자', notice: fresh('충청남도 논산시', '딸기', '500g 3팩') }],
  ['yeongdong_grape', { product_code: 'yeongdong_shine_gift_2kg', item_code: 'grape', name: '[예시] 샤인머스캣 선물 2kg (2송이)', price: 32900, unit: '2kg 1상자', stock: 25, variety: '샤인머스캣', brix: '18.6', brix_measured_at: '2026-11-04', harvest_date: '2026-10-05', tags: ['gift', 'raw', 'sweet'], summary: '송이 모양이 고른 두 송이를 담은 선물 상자', notice: fresh('충청북도 영동군', '포도', '2kg 1상자') }],
  ['haenam_deulnyeok', { product_code: 'haenam_radish_kimjang_5kg', item_code: 'radish', name: '[예시] 김장용 가을무 5kg', price: 8900, unit: '5kg 1박스', stock: 90, harvest_date: '2026-11-05', tags: ['home', 'cook', 'mild', 'season'], summary: '깍두기·김장 속으로 쓰기 좋은 단단한 가을무', notice: fresh('전라남도 해남군', '무', '5kg 1박스') }],
  ['uiseong_garlic', { product_code: 'uiseong_chili_kimjang_3kg', item_code: 'chili_powder', name: '[예시] 김장용 햇고춧가루 3kg', price: 89000, unit: '1kg 3봉', stock: 30, tags: ['home', 'cook', 'keep_long', 'season'], summary: '김장 20포기 안팎에 알맞은 굵은 햇고춧가루 세 봉', notice: made('경상북도 의성군 단밀면', '고춧가루', '고추(국내산 의성) 100%') }],
  ['jangheung_pyogo', { product_code: 'jangheung_shiitake_soup_500g', item_code: 'shiitake', name: '[예시] 국물용 건표고 500g', price: 32000, unit: '500g 1봉', stock: 40, harvest_date: '2026-10-10', tags: ['home', 'cook', 'keep_long'], summary: '모양이 덜 고른 건표고를 모은 국물용 대용량', notice: fresh('전라남도 장흥군', '표고버섯', '500g 1봉') }],
  ['goheung_yuja', { product_code: 'goheung_kiwi_gold_5kg', item_code: 'kiwi', name: '[예시] 골드키위 가정용 5kg', price: 48000, unit: '5kg 1박스', stock: 25, variety: '골드키위', brix: '15.1', brix_measured_at: '2026-11-05', harvest_date: '2026-11-03', tags: ['home', 'raw', 'sweet', 'season'], summary: '크기를 섞어 담은 가정용 골드키위. 후숙해서 드세요', notice: fresh('전라남도 고흥군', '참다래', '5kg 1박스') }],
  ['geochang_apple', { product_code: 'geochang_fuji_gift_10kg', item_code: 'apple', name: '[예시] 거창 부사 선물 10kg', price: 69000, unit: '10kg 1상자', stock: 20, variety: '후지', brix: '15.0', brix_measured_at: '2026-11-04', harvest_date: '2026-11-02', tags: ['gift', 'raw', 'sweet', 'season'], summary: '큰 부사만 골라 한 알씩 받침에 담은 10kg 선물 상자', notice: fresh('경상남도 거창군', '사과', '10kg 1상자') }],
]
// 시뮬레이션 중에 가입하는 새 농가와 상품 3개
const NEW_FARM = {
  login: 'cheongsong_apple', farmName: '[예시] 청송 꿀사과농원', region: '경상북도 청송군 주왕산면', ownerName: '[예시] 심청송', phone: '0540000021',
  businessNo: '9990000021', email: 'cheongsong_apple@example.com',
  intro: '청송 주왕산 자락에서 부사 사과를 키우는 농원입니다.', story: '일교차가 큰 청송 고지대에서 꿀이 잘 드는 부사를 키웁니다. 흠과는 즙으로 짭니다. [예시 문구]',
  products: [
    { product_code: 'cheongsong_fuji_5kg', item_code: 'apple', name: '[예시] 청송 꿀사과 5kg', price: 27900, unit: '5kg 1박스', stock: 50, variety: '후지', brix: '15.6', brix_measured_at: '2026-11-05', harvest_date: '2026-11-03', tags: ['gift', 'raw', 'sweet', 'season'], summary: '꿀이 잘 드는 청송 부사 5kg', notice: fresh('경상북도 청송군', '사과', '5kg 1박스') },
    { product_code: 'cheongsong_fuji_home_10kg', item_code: 'apple', name: '[예시] 청송 부사 가정용 10kg', price: 44900, unit: '10kg 1박스', stock: 40, variety: '후지', harvest_date: '2026-11-03', tags: ['home', 'raw', 'cook', 'sweet'], summary: '크기를 섞어 담은 가정용 청송 부사', notice: fresh('경상북도 청송군', '사과', '10kg 1박스') },
    { product_code: 'cheongsong_juice_50', item_code: 'apple_juice', name: '[예시] 청송 사과즙 50포', price: 24900, unit: '50포 1박스', stock: 60, count_per_box: '50', tags: ['gift', 'home', 'drink', 'keep_long'], summary: '흠과 사과만 짜서 담은 사과즙', notice: made('경상북도 청송군 주왕산면', '과·채주스', '사과(국내산 청송) 100%') },
  ],
}

// ---------- 할 일 목록 (시각 순서대로 실행) ----------
const SPAN = MINUTES * 60_000
const jobs = []
const at = (ms, fn) => jobs.push({ ms: Math.max(0, Math.min(SPAN, ms)), fn })
const later = (ms, fn) => at(Date.now() - started + ms, fn) // 실행 중에 새 일을 끼워 넣는다

let admin
const sellerSessions = new Map() // seller_code → { who, login }
async function sellerOf(code) {
  if (sellerSessions.has(code)) return sellerSessions.get(code)
  const { rows: [a] } = await db.query("SELECT login_id FROM admins WHERE seller_code = $1 AND role = 'seller' AND login_id NOT LIKE 'sa\\_%' ORDER BY id LIMIT 1", [code])
  const password = a && accounts[a.login_id]?.password
  if (!password) return null
  const who = { ip: `10.82.0.${(sellerSessions.size % 200) + 10}` }
  const login = await call(who, 'POST', '/admin/login', { loginId: a.login_id, password })
  if (login.status !== 200) return null
  const s = { who, login: a.login_id }
  sellerSessions.set(code, s)
  return s
}

// 농가 상품 등록 → (당도계 사진) → 검토 요청 → 바로 판매 또는 관리자 검토
async function registerProduct(farmName, who, product) {
  const created = await call(who, 'POST', '/seller/products', { ...product, price: String(product.price), stock: String(product.stock), status: 'pending' })
  if (created.status !== 201) {
    note(farmName, '상품 등록', `${label(product.name)}: ${created.status} ${created.data?.error ?? ''}`, created.status === 409)
    return
  }
  if (product.brix) await call(who, 'POST', `/seller/products/${product.product_code}/image?role=brix`, null, { buffer: BRIX_PHOTO, type: 'image/png' })
  const submitted = await call(who, 'POST', `/seller/products/${product.product_code}/submit`)
  metrics.registered += 1
  if (submitted.data?.status === 'active') {
    metrics.autoApproved += 1
    note(farmName, '상품 등록', `${label(product.name)} ${won(product.price)} → 바로 판매`)
    return
  }
  const reasons = (submitted.data?.reasons ?? []).map((r) => r.replace(/\s*\(지금까지 \d+개 승인\)/, '')).join(' / ')
  note(farmName, '상품 등록', `${label(product.name)} ${won(product.price)} → 관리자 검토 대기 (${reasons})`)
  later(between(90_000, 240_000), async () => {
    const ok = await call(admin, 'PATCH', `/admin/products/${product.product_code}`, { status: 'active' })
    if (ok.status === 200) metrics.reviewed += 1
    note('관리자', '상품 검토', `${label(product.name)} 승인 ${ok.status}${ok.data?.error ? ` ${ok.data.error}` : ''}`, ok.status === 200)
  })
}

// 손님 한 명의 방문
async function visit(v) {
  metrics.visits += 1
  const catalogQuery = pick(['', '', '?sort=popular', '?category=과일', '?category=채소', `?q=${encodeURIComponent(pick(['사과', '감귤', '절임배추', '딸기', '선물', '고구마', '마늘', '곶감']))}`])
  if (catalogQuery.includes('q=')) metrics.searches += 1
  const list = await call(v, 'GET', `/catalog${catalogQuery}${catalogQuery ? '&' : '?'}size=12`)
  metrics.pageViews += 1
  const items = (list.data?.items ?? []).filter((p) => !p.sold_out)
  const seen = []
  for (let i = 0; i < Math.ceil(between(1, 4)); i += 1) {
    const p = pick(items.length ? items : [])
    if (!p) break
    const detail = await call(v, 'GET', `/products/${p.product_code}`)
    metrics.pageViews += 1
    metrics.details += 1
    if (detail.status === 200) seen.push(detail.data)
    await wait(between(500, 2500))
  }
  if (rand() < 0.3) {
    await call(v, 'GET', '/recommend/options')
    const r = await call(v, 'GET', `/recommend?${new URLSearchParams({ tags: pick(['gift', 'home', 'sweet,home', 'gift,season', 'cook']), limit: 'all' })}`)
    metrics.recommends += 1
    if (r.data?.items?.length) seen.push(...[r.data.items[0]])
  }
  const what = `목록${catalogQuery ? ` (${decodeURIComponent(catalogQuery.slice(1))})` : ''} · 상세 ${seen.length}개`
  if (chatters.has(v.no)) await chatSession(v, seen)
  if (buyers.has(v.no)) await buy(v, seen, items)
  else note(`손님 ${v.no} ${v.name}`, '둘러보기', what)
}

// 챗봇: 1~3개를 이어서 묻는다. 상품 페이지에서 물으면 그 상품 문맥
async function chatSession(v, seen) {
  const history = []
  const page = seen.length && rand() < 0.4 ? seen[0] : null
  const questions = [pick(outside), ...Array.from({ length: Math.floor(between(0, 2.99)) }, () => (rand() < 0.5 ? pick(FOLLOW_UPS) : pick(outside)))]
  for (const q of questions) {
    const r = await call(v, 'POST', '/chat', { message: q, history, productCode: page?.product_code ?? null })
    metrics.chats += 1
    if (r.status !== 200) {
      note(`손님 ${v.no} ${v.name}`, '챗봇', `"${q}" → ${r.status} ${r.data?.error ?? ''}`, r.status === 429)
      continue
    }
    const model = (r.data.model ?? '').split(':')[0] // 응답에 모델이 없으면 기록으로 본다
    const { rows: [logRow] } = await db.query('SELECT model FROM chat_logs WHERE id = $1', [r.data.id])
    const kind = logRow?.model ?? model
    metrics.chatModels[kind] = (metrics.chatModels[kind] ?? 0) + 1
    if (r.data.handoff) metrics.handoffs += 1
    if (r.data.askAi) metrics.aiButton += 1
    note(`손님 ${v.no} ${v.name}`, '챗봇', `${page ? `[${label(page.name)} 페이지] ` : ''}"${q}" → ${kind}${r.data.handoff ? ' · 담당자 안내' : ''} · ${r.data.answer.slice(0, 70).replace(/\n/g, ' ')}…`)
    history.push({ role: 'user', content: q }, { role: 'assistant', content: r.data.answer })
    await wait(between(3000, 9000))
  }
}

// 구매: 본 상품에서 1~3개 (가끔 예약 상품을 일부러 담는다). 시험 결제로 결제
async function buy(v, seen, listed) {
  metrics.carts += 1
  let lines = shuffle(seen.filter((p) => p && !p.sold_out)).slice(0, Math.ceil(between(1, 3)))
  if (rand() < 0.3) {
    const pre = (await call(v, 'GET', `/catalog?q=${encodeURIComponent(pick(['절임배추', '곶감', '유자청']))}&size=12`)).data?.items?.find((p) => p.preorder && !p.sold_out)
    if (pre) lines.push(pre)
  }
  if (!lines.length && listed.length) lines = [pick(listed)]
  const items = []
  for (const p of lines) {
    const d = p.options ? p : (await call(v, 'GET', `/products/${p.product_code}`)).data
    const option = d?.options?.length ? pick(d.options.filter((o) => o.stock > 0)) : null
    if (d?.options?.length && !option) continue
    items.push({ productCode: d.product_code, optionId: option?.id ?? null, quantity: rand() < 0.2 ? 2 : 1, name: label(d.name), preorder: d.preorder })
  }
  if (!items.length) return note(`손님 ${v.no} ${v.name}`, '구매', '살 수 있는 상품이 없어 그만둠', true)
  const order = await call(v, 'POST', '/orders', {
    items: items.map(({ productCode, optionId, quantity }) => ({ productCode, optionId, quantity })),
    buyerName: `[예시] ${v.name}`, buyerPhone: v.phone, receiverName: `[예시] ${v.name}`, receiverPhone: v.phone,
    zipcode: pick(['31066', '06236', '48058', '61470', '35208']), address1: `[예시] ${pick(['충남 천안시', '서울 강남구', '부산 해운대구', '광주 동구', '대전 서구'])} 시험로 ${v.no}`, agreeTerms: true, agreePrivacy: true, agreeAge: true,
  })
  metrics.orders += 1
  if (order.status !== 201) return note(`손님 ${v.no} ${v.name}`, '주문', `${order.status} ${order.data?.error ?? ''}`, order.status === 409)
  await wait(between(5000, 20000)) // 결제창에서 결제하는 시간
  const paid = await call(v, 'POST', `/orders/${order.data.orderNo}/confirm`, { paymentKey: `mock_${order.data.orderNo}`, amount: order.data.amount })
  if (paid.status !== 200) return note(`손님 ${v.no} ${v.name}`, '결제', `${paid.status} ${paid.data?.error ?? ''}`, false)
  metrics.paid += 1
  metrics.revenue += order.data.amount
  if (items.some((i) => i.preorder)) metrics.preorders += 1
  note(`손님 ${v.no} ${v.name}`, '구매', `${items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}${i.preorder ? ' (예약)' : ''}`).join(', ')} · ${won(order.data.amount)} (농가 ${order.data.farms}곳) · ${order.data.orderNo}`)
  for (const s of paid.data?.shipments ?? []) scheduleFarmWork(order.data.orderNo, s)
}

// 주문을 받은 농가: 몇 분 뒤 배송 준비, 또 몇 분 뒤 송장 넣고 보내기. 예약 상품은 날짜 전이라 기다린다. 회사 직영은 관리자가 처리
function scheduleFarmWork(orderNo, shipment) {
  const farm = label(shipment.seller_name)
  if (shipment.ship_from) {
    later(between(60_000, 180_000), () => note(farm, '주문 확인', `${orderNo}: 예약 상품이라 ${shipment.ship_from}까지 기다림`))
    return
  }
  const run = async (status, extra = {}) => {
    const seller = await sellerOf(shipment.seller_code)
    const res = seller
      ? await call(seller.who, 'PATCH', `/seller/orders/${orderNo}`, { status, ...extra })
      : await call(admin, 'PATCH', `/admin/orders/${orderNo}`, { status, sellerCode: shipment.seller_code, ...extra })
    return { res, by: seller ? farm : `관리자(${farm} 대신)` }
  }
  later(between(120_000, 420_000), async () => {
    const { res, by } = await run('preparing')
    if ([200, 204].includes(res.status)) metrics.prepared += 1
    note(by, '배송 준비', `${orderNo} ${res.status}${res.data?.error ? ` ${res.data.error}` : ''}`, [200, 204].includes(res.status))
    later(between(120_000, 480_000), async () => {
      const { res: sent, by: who } = await run('shipping', { courier: pick(['CJ대한통운', '우체국택배', '한진택배', '롯데택배']), trackingNo: String(Math.floor(between(1e11, 9e11))) })
      if ([200, 204].includes(sent.status)) metrics.shipped += 1
      note(who, '송장 넣고 보냄', `${orderNo} ${sent.status}${sent.data?.error ? ` ${sent.data.error}` : ''}`, [200, 204].includes(sent.status))
    })
  })
}

// 손님 방문 시각: 30분 동안 고르게 흩어지되 조금씩 몰리게 (점심시간처럼)
visitors.forEach((v) => at(Math.min(SPAN * 0.95, (rand() < 0.3 ? between(0.35, 0.55) : rand()) * SPAN), () => visit(v)))
// 기존 농가 상품 등록: 30분에 고르게
NEW_PRODUCTS.forEach(([login, product], i) => at(((i + 0.5) / NEW_PRODUCTS.length) * SPAN * 0.85, async () => {
  const { rows: [a] } = await db.query('SELECT seller_code FROM admins WHERE login_id = $1', [login])
  const seller = a && await sellerOf(a.seller_code)
  if (!seller) return note(login, '상품 등록', '농가 계정을 찾지 못함 (npm run onboard-farms 먼저)', false)
  await registerProduct(label((await db.query('SELECT name FROM sellers WHERE seller_code = $1', [a.seller_code])).rows[0].name), seller.who, product)
}))
// 새 농가: 15% 지점에 가입 신청 → 몇 분 뒤 관리자 승인 → 로그인·소개 → 상품 3개
at(SPAN * 0.15, async () => {
  const name = label(NEW_FARM.farmName)
  const exists = (await db.query('SELECT 1 FROM admins WHERE login_id = $1', [NEW_FARM.login])).rowCount
  if (exists) return note(name, '가입 신청', '이미 가입한 아이디라 건너뜀')
  const password = `Yj!${randomBytes(12).toString('base64url')}9a`
  const me = { ip: '10.82.1.10' }
  const signup = await call(me, 'POST', '/seller-signup', { ...NEW_FARM, loginId: NEW_FARM.login, password, agreeTerms: true, agreePrivacy: true, agreeAge: true })
  if (signup.status !== 201) return note(name, '가입 신청', `${signup.status} ${signup.data?.error ?? ''}`, false)
  const all = existsSync(ACCOUNTS_FILE) ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {}
  all[NEW_FARM.login] = { farmName: NEW_FARM.farmName, password, note: '예시 농가 계정 (npm run live-sim). 저장소에 올리지 않는다' }
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
  note(name, '판매자 가입 신청', `${NEW_FARM.region} · 승인 대기`)
  later(between(120_000, 240_000), async () => {
    const { rows: [s] } = await db.query('SELECT seller_code FROM admins WHERE login_id = $1', [NEW_FARM.login])
    const ok = await call(admin, 'POST', `/admin/sellers/${s.seller_code}/approve`)
    note('관리자', '판매자 가입 승인', `${name} ${ok.status}`, ok.status === 200)
    later(between(60_000, 120_000), async () => {
      await call(me, 'POST', '/admin/login', { loginId: NEW_FARM.login, password })
      const profile = await call(me, 'PATCH', '/seller/profile', { intro: NEW_FARM.intro, story: NEW_FARM.story })
      note(name, '로그인·농가 소개', `${profile.status}`, profile.status === 200)
      NEW_FARM.products.forEach((p, i) => later(60_000 * (i + 1) + between(0, 30_000), () => registerProduct(name, me, p)))
    })
  })
})

// ---------- 실행 ----------
const adminLogin = `ls_admin_${randomBytes(3).toString('hex')}`
let exitCode = 0
const before = {}
try {
  before.orders = (await db.query("SELECT count(*)::int AS n FROM orders WHERE status IN ('paid', 'preparing', 'shipping', 'delivered')")).rows[0].n
  child = await startBackend()
  const pw = `Yj!${randomBytes(12).toString('base64url')}9a`
  await db.query("INSERT INTO admins (login_id, password_hash, role) VALUES ($1, $2, 'admin')", [adminLogin, await hashPassword(pw)])
  admin = { ip: '10.82.9.9' }
  await call(admin, 'POST', '/admin/login', { loginId: adminLogin, password: pw })
  before.dash = (await call(admin, 'GET', '/admin/dashboard')).data
  note('시뮬레이션', '시작', `${MINUTES}분 · 손님 ${VISITORS}명 (구매 ${BUYERS}명, 챗봇 ${CHATTERS}명) · 기존 농가 상품 ${NEW_PRODUCTS.length}개 · 새 농가 1곳 상품 ${NEW_FARM.products.length}개`)
  // 시각이 된 일부터 하나씩. 일이 끝나는 사이에 끼워 넣은 일(later)도 시각 순서로
  while (jobs.length) {
    jobs.sort((a, b) => a.ms - b.ms)
    const next = jobs.shift()
    const gap = next.ms - (Date.now() - started)
    if (gap > 0) await wait(gap)
    try {
      await next.fn()
    } catch (error) {
      note('시뮬레이션', '오류', error.message, false)
    }
    if (Date.now() - started > SPAN + 5 * 60_000) break // 너무 늦게 끝나면 멈춘다
  }

  // ---------- 끝나고 맞춰 보기 ----------
  const after = (await call(admin, 'GET', '/admin/dashboard')).data
  // 대시보드와 같은 계산: 결제 완료 이후 상태 주문의 결제 금액 − 돌려준 돈 (한국 날짜 오늘)
  const { rows: [sum] } = await db.query(`SELECT COALESCE(sum(o.total_amount - COALESCE((SELECT sum(r.amount) FROM order_refunds r WHERE r.order_id = o.id AND r.status = 'done'), 0)), 0)::int AS amount,
      count(*)::int AS n FROM orders o
    WHERE o.status IN ('paid', 'preparing', 'shipping', 'delivered') AND (o.paid_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`)
  note('검사', '대시보드 오늘 매출 = DB 결제 합', `화면 ${won(after.summary.today_sales)} (${after.summary.today_orders}건), DB ${won(sum.amount)} (${sum.n}건), 이번 시뮬레이션 ${won(metrics.revenue)}`, after.summary.today_sales === sum.amount)
  const negative = (await db.query('SELECT count(*)::int AS n FROM products WHERE stock < 0')).rows[0].n + (await db.query('SELECT count(*)::int AS n FROM product_options WHERE stock < 0')).rows[0].n
  note('검사', '재고가 0보다 작은 상품·옵션', `${negative}개`, negative === 0)
  const drift = (await db.query(`SELECT count(*)::int AS n FROM products p WHERE EXISTS (SELECT 1 FROM product_options o WHERE o.product_code = p.product_code AND o.status = 'active')
    AND (p.stock <> (SELECT sum(stock) FROM product_options o WHERE o.product_code = p.product_code AND o.status = 'active') OR p.price <> (SELECT min(price) FROM product_options o WHERE o.product_code = p.product_code AND o.status = 'active'))`)).rows[0].n
  note('검사', '옵션 상품 가격·재고 = 옵션 최저가·합', `어긋난 상품 ${drift}개`, drift === 0)
  const catalog = (await call(null, 'GET', '/catalog?size=1')).data
  const active = (await db.query("SELECT count(*)::int AS n FROM products WHERE status = 'active'")).rows[0].n
  note('검사', '손님 목록 상품 수 = 판매 중 상품 수', `손님 ${catalog.total}개, DB ${active}개`, catalog.total === active)
  note('검사', '관리자 할 일', `준비할 주문 ${before.dash.todo.to_prepare}→${after.todo.to_prepare}, 송장 넣을 주문 ${before.dash.todo.to_ship}→${after.todo.to_ship}, 예약 대기 ${before.dash.todo.preorders_waiting}→${after.todo.preorders_waiting}, 검토 대기 상품 ${after.todo.pending_products}, 답변 대기 문의 ${after.todo.unanswered}`)
  note('검사', '서버 오류(5xx)', stats.errors.length ? stats.errors.slice(0, 5).join(' / ') : '없음', stats.errors.length === 0)
} catch (error) {
  console.error(`시뮬레이션 중단: ${error.stack}`)
  exitCode = 1
} finally {
  child?.kill()
  try {
    await db.query('DELETE FROM access_logs WHERE login_id = $1', [adminLogin])
    await db.query('DELETE FROM admins WHERE login_id = $1', [adminLogin])
  } catch (error) {
    console.error(`임시 관리자 정리 실패: ${error.message}`)
    exitCode = 1
  }
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const models = Object.entries(metrics.chatModels).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
writeFileSync(REPORT, `# 실시간 운영 시뮬레이션

- 실행: ${new Date(started).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}부터 ${MINUTES}분 · \`npm run live-sim\` · 씨앗 \`${SEED}\`
- 손님·농가·관리자가 실제 API로 움직였다. 결제는 시험 결제(mock), 챗봇 AI 버튼은 누르지 않았다 (토큰 0)
- 만든 주문·상품·문의·상담 기록은 남겼다. 손님 이름·주소는 [예시]다

## 요약

| 항목 | 결과 |
|---|---|
| 손님 방문 | ${metrics.visits}명 · 화면 ${metrics.pageViews}번 (상세 ${metrics.details}, 검색 ${metrics.searches}, 추천받기 ${metrics.recommends}) |
| 구매 | 주문 ${metrics.orders}건 · 결제 ${metrics.paid}건 · ${won(metrics.revenue)} · 예약 상품이 든 주문 ${metrics.preorders}건 · 구매 전환 ${Math.round((metrics.paid / Math.max(1, metrics.visits)) * 100)}% |
| 챗봇 | 손님 ${CHATTERS}명 · 질문 ${metrics.chats}개 · 답한 방식: ${models} · 담당자 안내 ${metrics.handoffs}개 · AI 버튼이 뜬 답 ${metrics.aiButton}개 |
| 상품 등록 | ${metrics.registered}개 (바로 판매 ${metrics.autoApproved}, 관리자 검토 뒤 ${metrics.reviewed}) |
| 농가 주문 처리 | 배송 준비 ${metrics.prepared}건 · 송장 넣고 보냄 ${metrics.shipped}건 |
| 요청 | ${stats.requests}번 · 서버 오류 ${stats.errors.length}번 |

## 시간순 기록

| 시각 | 누가 | 무엇을 | 결과 | 판정 |
|---|---|---|---|---|
${timeline.map((t) => `| ${t.at} | ${cell(t.actor)} | ${cell(t.action)} | ${cell(t.result)} | ${t.ok ? '맞음' : '어긋남'} |`).join('\n')}

## 한계

- 손님 행동(무엇을 보고 사는지)은 무작위다. 실제 손님 비율이나 시간대 분포를 잰 값이 아니다
- 결제는 시험 결제(mock)라 토스 결제창은 거치지 않았다
- 챗봇 질문은 팀 밖 사람들이 쓴 질문 100개(data/chat_eval_outside.csv)와 미리 정한 이어지는 질문에서 골랐다
`)
console.log(`\n방문 ${metrics.visits} · 결제 ${metrics.paid} (${won(metrics.revenue)}) · 챗봇 질문 ${metrics.chats} · 상품 등록 ${metrics.registered} · 오류 ${stats.errors.length} → docs/live_simulation.md`)
await db.end()
process.exit(exitCode)
