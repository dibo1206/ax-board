// 농가 판매 자사몰 백엔드. 개발: 화면(Vite, $PORT) → 이 서버($PORT + 100) → PostgreSQL
// 배포(npm run build → npm start): 이 서버 하나가 $PORT 에서 화면(dist)과 API를 함께 보낸다
// 1단계: 데이터 읽기 / 2단계: 관리자 상품 관리 / 4단계: 상품 Q&A·기업 구매 문의 / 5단계: AI 상담 / 6단계: 추천 / 판매자(농가) 화면 / 7단계: 자체 주문·결제
import 'dotenv/config'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { accountRouter } from './account.js'
import { oauthRouter } from './oauth.js'
import { accessLogger, adminAccessLogRouter } from './accessLog.js'
import { dashboardRouter } from './dashboard.js'
import { adminRouter, UPLOAD_DIR } from './admin.js'
import { bannedRouter, loadBanned } from './banned.js'
import { cached, clearCache } from './cache.js'
import { scheduleRagSync, startRag } from './rag.js'
import { currentStaff, firstTwoFactor, login, logout, requireAdmin } from './auth.js'
import { listMails } from './mailer.js'
import { adminChatRouter, chatRouter } from './chat.js'
import { initDb, isTransientDbError, pool } from './db.js'
import { adminInquiryRouter, maskName, publicInquiryRouter } from './inquiry.js'
import { publicItem } from './items.js'
import { GRADE_LABEL } from './brix.js'
import { checkDataKey } from './crypto.js'
import { orderingOpen, paymentMode } from './payments.js'
import { encryptExisting, openQuestion } from './pii.js'
import { startRetention } from './retention.js'
import { buildNotice } from './notice.js'
import { ACTIVE_OPTIONS_SQL } from './options.js'
import { adminOrderRouter, KOREA_TODAY, memberOrderRouter, publicOrderRouter, sellerOrderRouter, startOrderSweeper } from './orders.js'
import { SHIPPING } from './policy.js'
import { recommendRouter } from './recommend.js'
import { restockRouter, sweepRestock } from './restock.js'
import { searchWhere, searchWords } from './search.js'
import { adminPostRouter, publicPostRouter } from './posts.js'
import { adminSettingsRouter, loadSettings } from './settings.js'
import { adminStaffRouter } from './staff.js'
import { adminSiteRouter, publicSiteRouter } from './siteContent.js'
import { adminReturnRouter, memberReturnRouter, publicReturnRouter, sellerReturnRouter } from './returns.js'
import { isPreorder } from './preorder.js'
import { adminReviewRouter, reviewRouter } from './reviews.js'
import { sellerRouter } from './seller.js'
import { adminSellerRouter, sellerSignupRouter } from './sellers.js'
import { groupWhere, shopGroupRouter } from './shopGroups.js'
import { seoRouter, serveDist } from './web.js'

if (!process.env.PORT && process.env.BACKEND_PORT === undefined) {
  console.error('[server] PORT 환경변수가 없어요. 실습서버 내 계정 터미널에서 실행해 주세요. (echo $PORT 로 확인)')
  process.exit(1)
}
try {
  checkDataKey()
} catch (error) {
  console.error(`[server] ${error.message}. 개인정보를 암호화할 수 없어서 켜지 않아요.`)
  process.exit(1)
}
const SERVE = process.argv.includes('--serve') // 배포 모드: 화면까지 이 서버가 보낸다
// NODE_ENV 를 빠뜨리면 가짜 결제·시험 로그인이 켜지고 2단계 인증·Secure 쿠키가 꺼진다 → 배포 모드는 켜지 않는다 (2026-11-11 보안 점검)
if (SERVE && process.env.NODE_ENV !== 'production') {
  console.error('[server] 배포 모드(npm start)는 NODE_ENV=production 이 있어야 켜져요. 없으면 가짜 결제와 시험 로그인이 켜져서 위험해요. 예: NODE_ENV=production npm start')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_ALLOWED_IPS) {
  console.warn('[server] ADMIN_ALLOWED_IPS 가 없어서 관리자 로그인이 인터넷 전체에 열려 있어요. 회사 IP를 넣어 주세요')
}
if (paymentMode() !== 'off' && !orderingOpen()) {
  console.warn('[server] 운영에 테스트 결제 키가 들어 있어 주문을 받지 않아요. 라이브 키를 넣거나, 리허설이면 ALLOW_TEST_PAYMENTS=1')
}
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL) {
  console.warn('[server] PUBLIC_URL 이 없어요. 운영에서는 꼭 넣어 주세요 (메일 링크·sitemap·요청 출처 확인에 쓰임)')
}
// BACKEND_PORT: 시험 스크립트가 빈 포트(0)로 따로 띄울 때만 쓴다
const PORT = process.env.BACKEND_PORT !== undefined ? Number(process.env.BACKEND_PORT) : Number(process.env.PORT) + (SERVE ? 0 : 100)
const app = express()

// 끄는 중에는 새 요청을 받지 않는다 (처리 중인 요청은 마저 끝낸다)
let shuttingDown = false
app.use((req, res, next) => {
  if (!shuttingDown) return next()
  res.set('Connection', 'close')
  res.status(503).json({ error: '서버를 잠시 다시 켜는 중이에요. 몇 초 뒤에 다시 시도해 주세요.' })
})
// 글자로 된 응답(화면 파일·상품 목록 JSON)은 압축해서 보낸다 (사진은 이미 압축돼 있어 그대로)
app.use(compression())
// 손님 IP(글 남기기 횟수 제한용)는 앞단 프록시가 붙인 값만 믿는다. 개발: Vite 1단, 배포 시 프록시 수에 맞게 TRUST_PROXY_HOPS
// 이 서버는 127.0.0.1 에서만 받으므로 손님은 항상 앞단(nginx·Vite) 한 단을 거친다 → 값을 안 적으면 1 (2026-11-11 보안 점검).
// 전에는 배포 모드 기본이 0이라, 값을 빠뜨리면 모든 손님이 127.0.0.1 한 명으로 잡혀 주문 횟수 제한·로그인 잠금을 다 같이 맞았다.
// 앞단이 둘이면(CDN + nginx) 2, 앞단 없이 이 컴퓨터에서만 쓰면 0
const hops = process.env.TRUST_PROXY_HOPS
app.set('trust proxy', hops !== undefined && hops !== '' ? Number(hops) : 1)
app.disable('x-powered-by')

// 기본 보안 헤더: 파일 종류를 바꿔 해석하지 않기, 다른 사이트의 틀(iframe) 안에 넣지 않기
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' })
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000') // HTTPS로 들어온 손님은 1년 동안 HTTPS로만
  next()
})

// 공유 서버라 같은 서버의 다른 사용자도 이 포트(127.0.0.1)에 직접 접속할 수 있다.
// 화면 서버(Vite·웹 서버)만 아는 PROXY_SECRET을 붙인 요청만 받아서, 직접 접속해 IP를 속이거나 AI 한도를 쓰는 걸 막는다.
// 배포 모드는 이 서버가 맨 앞이라(앞단 화면 서버가 없음) 이 검사를 하지 않는다
const PROXY_SECRET = SERVE ? '' : (process.env.PROXY_SECRET ?? '')
if (!PROXY_SECRET && !SERVE) console.warn('[server] PROXY_SECRET이 없어서 누구나 이 포트로 직접 요청할 수 있어요. .env에 넣어 주세요.')
app.use((req, res, next) => {
  if (!PROXY_SECRET) return next()
  const got = Buffer.from(req.get('x-proxy-secret') ?? '')
  const want = Buffer.from(PROXY_SECRET)
  if (got.length === want.length && timingSafeEqual(got, want)) return next()
  res.status(403).json({ error: '허용되지 않은 접근이에요.' })
})

app.use(express.json({ limit: '100kb' }))
// JSON 이 아닌 몸통(text/plain 폼 등)이나 몸통 없이 오면 req.body 가 비어 있어서, req.body.loginId 를 읽다 500 이 났다 (2026-11-08 보안 점검).
// 빈 객체로 두면 각 주소의 입력 검사가 400·401 로 답한다. 사진 올리기는 주소마다 붙은 express.raw 가 다시 채운다
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {}
  next()
})

// PostgreSQL 글자 칸에는 NUL 문자(\u0000)를 넣을 수 없어서, 주소나 보낸 내용에 섞여 오면 DB가 거절하고 500이 났다 (2026-11-07 보안 점검).
// 들어올 때 400으로 막는다. 깊게 중첩된 JSON에도 재귀가 터지지 않게 스택으로 훑고, 사진(Buffer)은 보지 않는다
function hasNul(value) {
  const stack = [value]
  while (stack.length) {
    const v = stack.pop()
    if (typeof v === 'string') {
      if (v.includes('\u0000')) return true
    } else if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
      for (const [key, child] of Object.entries(v)) {
        if (key.includes('\u0000')) return true
        stack.push(child)
      }
    }
  }
  return false
}
app.use((req, res, next) => {
  let url
  try {
    url = decodeURIComponent(req.originalUrl)
  } catch {
    return res.status(400).json({ error: '주소를 읽지 못했어요.' })
  }
  if (url.includes('\u0000') || hasNul(req.body)) return res.status(400).json({ error: '보낸 내용에 쓸 수 없는 글자가 있어요.' })
  next()
})

// 다른 사이트가 손님 브라우저를 시켜 몰래 주문 취소·정보 변경 요청을 보내지 못하게(CSRF):
// 무언가 바꾸는 요청은 브라우저가 붙이는 Origin 이 우리 주소일 때만 받는다 (쿠키 SameSite=Lax 와 함께 이중으로)
const OWN_HOST = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : null
app.use('/api', (req, res, next) => {
  const origin = req.get('origin')
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !origin) return next() // Origin 이 없으면 브라우저 요청이 아니다
  let host = null
  try {
    host = new URL(origin).host
  } catch {
    // 잘못된 Origin 은 아래에서 거절
  }
  if (host && (host === req.host || host === OWN_HOST)) return next()
  res.status(403).json({ error: '허용되지 않은 요청이에요.' })
})

// 로그인한 사람의 응답(주문·배송지·관리자 화면)은 브라우저·중간 서버에 남기지 않는다
app.use(['/api/account', '/api/admin', '/api/seller', '/api/orders'], (req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
})

// 무언가 바뀌면(관리자·판매자 수정, 주문, 후기·문의 남기기) 기억해 둔 상품 목록·상세를 지운다. AI 상담은 상품을 바꾸지 않아서 뺀다
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.path.startsWith('/api/chat')) {
    res.on('finish', () => {
      if (res.statusCode >= 400) return
      clearCache()
      // 상품·품목·Q&A를 바꾸는 곳은 관리자와 판매자 화면이다. 벡터 검색 자료도 맞춘다
      if (/^\/api\/(admin|seller)/.test(req.originalUrl)) {
        scheduleRagSync()
        sweepRestock().catch((e) => console.error(`[restock] 알림 실패 · ${e.message}`)) // 재고가 다시 생겼으면 알림
      }
    })
  }
  next()
})

// 상품 + 품목·농가 정보를 함께 읽는다. 품절은 재고 0으로 계산한다.
// 옵션 상품은 판매 중 옵션(이름·가격·재고)을 options 로 붙인다. 상품 가격·재고는 옵션의 최저가·재고 합이라 품절 계산은 같다
const PRODUCT_SELECT = `
  SELECT p.*, (p.stock = 0) AS sold_out, ${ACTIVE_OPTIONS_SQL},
         i.name AS item_name, i.category, i.show_brix,
         s.name AS seller_name, s.region AS seller_region, s.is_company,
         rv.rating, COALESCE(rv.review_count, 0) AS review_count, COALESCE(sales.sold, 0) AS sold_30d,
         -- 후기에서 '표시 정보와 달랐어요'가 3개 이상이고 답한 사람의 절반 이상이면 당도 표시를 내린다
         (COALESCE(rv.info_no, 0) >= 3 AND rv.info_no * 2 >= rv.info_answers) AS info_disputed,
         COALESCE(rv.info_answers, 0) AS info_answers, COALESCE(rv.info_answers - rv.info_no, 0) AS info_matched,
         std.high AS brix_high, std.top AS brix_top, i.brix_standard_source,
         CASE WHEN std.top IS NULL THEN NULL WHEN p.brix >= std.top THEN 3 WHEN p.brix >= std.high THEN 2 ELSE 1 END AS brix_rank
  FROM products p
  JOIN items i ON i.item_code = p.item_code
  JOIN sellers s ON s.seller_code = p.seller_code
  LEFT JOIN (SELECT product_code, round(avg(rating)::numeric, 1)::float AS rating, count(*)::int AS review_count,
                    count(*) FILTER (WHERE info_match = 'no')::int AS info_no, count(info_match)::int AS info_answers
             FROM reviews WHERE NOT hidden GROUP BY product_code) rv ON rv.product_code = p.product_code
  LEFT JOIN (SELECT oi.product_code, sum(oi.quantity)::int AS sold
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.status IN ('paid', 'preparing', 'shipping', 'delivered') AND o.created_at > now() - interval '30 days'
             GROUP BY oi.product_code) sales ON sales.product_code = p.product_code
  -- 당도 등급: 품목의 품종별 기준으로 정한다. 당도계 사진이 없거나 후기 이의가 많으면 등급을 붙이지 않는다
  LEFT JOIN LATERAL (SELECT (b->>'high')::numeric AS high, (b->>'top')::numeric AS top FROM jsonb_array_elements(i.brix_standards) b
                     WHERE b->'varieties' ? COALESCE(p.variety, '공통') LIMIT 1) std
    ON i.show_brix AND p.brix IS NOT NULL AND p.brix_photo_url IS NOT NULL AND NOT (COALESCE(rv.info_no, 0) >= 3 AND rv.info_no * 2 >= rv.info_answers)
  WHERE p.status = 'active'`

// 상태 확인: DB까지 살아 있으면 200, DB가 안 되면 503 (배포 후 모니터링·자동 재시작이 이 주소를 본다)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: true })
  } catch {
    res.status(503).json({ ok: false, db: false })
  }
})

// 손님에게 보내지 않는 칸 (반려·승인 기록은 내부 정보)
// 수확 며칠째인지와 당도 등급 이름을 붙인다 (신선도 등급은 매기지 않고 사실만 보여 준다)
const koreaToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const harvestDays = (date) => (date ? Math.max(1, Math.floor((Date.parse(koreaToday()) - Date.parse(String(date).slice(0, 10))) / 86_400_000) + 1) : null)
const publicProduct = ({ review_note: _n, review_reason: _r, rejected_at: _x, admin_approved_at: _a, auto_approved_at: _o, auto_checked_at: _c, source: _s, external_url: _u, ...p }) => ({
  ...p,
  brix_grade: GRADE_LABEL[p.brix_rank] ?? null,
  harvest_days: p.category === '가공품' ? null : harvestDays(p.harvest_date),
  preorder: isPreorder(p.ship_from), // 예약 상품 (출고 시작일이 오늘보다 뒤)
})

app.get('/api/products', async (req, res) => {
  const { category } = req.query
  const params = []
  let sql = PRODUCT_SELECT
  if (category) {
    params.push(category)
    sql += ` AND i.category = $${params.length}`
  }
  sql += ' ORDER BY (p.stock = 0), i.category, p.name'
  res.json(await cached(`products:${category ?? ''}`, 15_000, async () => (await pool.query(sql, params)).rows.map(publicProduct)))
})

// 상품 찾기: 검색어(q, 띄어쓰기로 여러 단어)·카테고리·정렬·페이지. 품절 상품은 항상 뒤로
const SORTS = {
  recommended: `('season' = ANY(x.tags)) DESC, x.rating DESC NULLS LAST, x.sold_30d DESC, x.name`,
  popular: 'x.sold_30d DESC, x.review_count DESC, x.name',
  price_asc: 'x.price, x.name',
  price_desc: 'x.price DESC, x.name',
  new: 'x.created_at DESC, x.name',
  rating: 'x.rating DESC NULLS LAST, x.review_count DESC, x.name',
  brix: 'x.brix_rank DESC NULLS LAST, x.brix DESC NULLS LAST, x.name', // 품종마다 기준이 달라 등급 먼저, 같은 등급은 측정값
  reviews: 'x.review_count DESC, x.rating DESC NULLS LAST, x.name',
}

app.get('/api/catalog', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 50)
  const sort = Object.hasOwn(SORTS, req.query.sort) ? req.query.sort : 'recommended'
  const size = Math.min(60, Math.max(1, Number(req.query.size) || 12))
  const page = Math.min(1000, Math.max(1, Number(req.query.page) || 1))
  const params = []
  let where = ''
  if (req.query.category) {
    params.push(String(req.query.category))
    where += ` AND i.category = $${params.length}`
  }
  // 손님 화면 카테고리(생과일·선물세트 등). 정해 둔 조건만 쓰고 손님이 보낸 글자는 SQL에 넣지 않는다
  const group = groupWhere(String(req.query.group ?? ''))
  if (group) where += ` AND ${group}`
  const highBrix = req.query.brix === 'high' // 높은 당도 이상만
  if (highBrix) where += ' AND p.brix >= std.high'
  // 상품 화면(/products) 걸러 보기: 품목, 1개만 사도 무료배송, 품절 제외, 예약 상품, 가격대. 정해 둔 조건만 SQL에 넣고 값은 $n 으로
  const filters = []
  const itemCode = String(req.query.item ?? '')
  if (/^[a-z][a-z0-9_]{0,39}$/.test(itemCode)) {
    params.push(itemCode)
    where += ` AND p.item_code = $${params.length}`
    filters.push(`item=${itemCode}`)
  }
  if (req.query.free === '1') { where += ` AND p.price >= ${Number(SHIPPING.freeOver)}`; filters.push('free') }
  if (req.query.instock === '1') { where += ' AND p.stock > 0'; filters.push('instock') }
  if (req.query.preorder === '1') { where += ` AND p.ship_from > ${KOREA_TODAY}`; filters.push('preorder') }
  const money = (v) => Math.max(0, Math.min(10_000_000, Math.floor(Number(v) || 0)))
  const [minPrice, maxPrice] = [money(req.query.min), money(req.query.max)]
  if (minPrice) { params.push(minPrice); where += ` AND p.price >= $${params.length}`; filters.push(`min=${minPrice}`) }
  if (maxPrice) { params.push(maxPrice); where += ` AND p.price <= $${params.length}`; filters.push(`max=${maxPrice}`) }
  // 검색어: 띄어쓰기 무시·다른 말·카테고리 말까지 (server/search.js). 단어가 모두 맞는 상품이 없으면 하나라도 맞는 상품을 보여 준다
  const words = searchWords(q)
  const run = (mode) => {
    const all = [...params]
    const filter = where + searchWhere(words, all, mode)
    all.push(size, (page - 1) * size)
    // 같은 검색·정렬·페이지는 15초 동안 DB를 다시 읽지 않는다 (재고는 주문할 때 서버가 다시 확인)
    // 기억 이름은 손님이 보낸 짧은 값으로만 만든다 (늘린 검색 조건 배열을 통째로 넣으면 이름 하나가 커진다)
    return cached(`catalog:${JSON.stringify([words, req.query.category ?? '', size, page, filters])}:${sort}:${group ? req.query.group : ''}:${highBrix}:${mode}`, 15_000, async () => {
      const { rows } = await pool.query(
        `SELECT x.*, count(*) OVER () AS total FROM (${PRODUCT_SELECT} ${filter}) x
         ORDER BY (x.stock = 0), ${SORTS[sort]} LIMIT $${all.length - 1} OFFSET $${all.length}`,
        all,
      )
      const total = Number(rows[0]?.total ?? 0)
      return { items: rows.map(({ total: _t, ...p }) => publicProduct(p)), total, page, pages: Math.max(1, Math.ceil(total / size)), sort }
    })
  }
  let result = await run('all')
  if (result.total === 0 && words.length > 1) {
    const loose = await run('any')
    if (loose.total) result = { ...loose, loose: true }
  }
  res.json(result)
})

// 제철 달력 카드: 찾을 말(품목 이름)마다 판매 중 상품 수, 살 수 있는 상품의 가장 싼 값, 대표 사진 (60초 캐시)
// 찾을 말은 상품 검색과 같은 방식(server/search.js)으로 SQL 값($n)으로만 넘긴다
app.get('/api/season-items', async (req, res) => {
  const terms = [...new Set(String(req.query.q ?? '').split(',').map((t) => t.trim().slice(0, 20)).filter(Boolean))].slice(0, 30)
  res.json(await cached(`season-items:${terms.join(',')}`, 60_000, async () => {
    const out = {}
    for (const term of terms) {
      const params = []
      const filter = searchWhere(searchWords(term), params, 'all')
      const { rows } = await pool.query(
        `SELECT count(*)::int AS products, count(*) FILTER (WHERE x.stock > 0)::int AS live,
                min(x.price) FILTER (WHERE x.stock > 0) AS price,
                (array_agg(x.image_url ORDER BY (x.stock = 0), x.sold_30d DESC, x.price) FILTER (WHERE x.image_url IS NOT NULL))[1] AS image
         FROM (${PRODUCT_SELECT} ${filter}) x`,
        params,
      )
      out[term] = { products: rows[0].products, live: rows[0].live, price: rows[0].price == null ? null : Number(rows[0].price), image: rows[0].image }
    }
    return out
  }))
})

// ---------- 농가별로 보기 (손님, 2026-11-09) ----------
// 판매 중 상품이 있는 활동 중 농가만. 농가 표의 대표자·연락처·사업자번호·이메일은 보내지 않는다 (이름·지역·소개·이야기만)
const FARM_CODE = /^[a-z0-9_-]{1,40}$/i
app.get('/api/farms', async (req, res) => {
  res.json(await cached('farms', 60_000, async () => (await pool.query(`
    SELECT s.seller_code, s.name, s.region, s.intro, s.is_company,
           count(*)::int AS products,
           count(*) FILTER (WHERE p.stock > 0)::int AS in_stock,
           min(p.price)::int AS min_price,
           max(p.created_at) AS newest_at,
           (array_agg(p.image_url ORDER BY (p.stock = 0), p.created_at DESC) FILTER (WHERE p.image_url IS NOT NULL))[1] AS image_url,
           (array_agg(DISTINCT i.name))[1:6] AS items
    FROM sellers s
    JOIN products p ON p.seller_code = s.seller_code AND p.status = 'active'
    JOIN items i ON i.item_code = p.item_code
    WHERE s.status = 'active'
    GROUP BY s.seller_code
    ORDER BY s.is_company DESC, count(*) DESC, s.name`)).rows))
})

app.get('/api/farms/:code', async (req, res) => {
  const code = req.params.code
  const farm = FARM_CODE.test(code) ? await cached(`farm:${code}`, 15_000, async () => {
    const { rows } = await pool.query("SELECT seller_code, name, region, intro, story, is_company FROM sellers WHERE seller_code = $1 AND status = 'active'", [code])
    if (!rows.length) return null
    const products = await pool.query(`${PRODUCT_SELECT} AND p.seller_code = $1 ORDER BY (p.stock = 0), p.created_at DESC, p.name`, [code])
    return { ...rows[0], products: products.rows.map(publicProduct) }
  }) : null
  if (!farm) return res.status(404).json({ error: '농가를 찾지 못했어요.' })
  res.json(farm)
})

app.get('/api/products/:code', async (req, res) => {
  const detail = await cached(`product:${req.params.code}`, 15_000, () => loadProductDetail(req.params.code))
  if (!detail) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  res.json(detail)
})

async function loadProductDetail(code) {
  const { rows } = await pool.query(`${PRODUCT_SELECT} AND p.product_code = $1`, [code])
  if (rows.length === 0) return null
  const product = publicProduct(rows[0])
  const [item, seller, questions] = await Promise.all([
    pool.query('SELECT * FROM items WHERE item_code = $1', [product.item_code]),
    // 농가 표에는 대표자·연락처·사업자번호도 있다 → 공개 칸만
    pool.query('SELECT seller_code, name, region, intro, story, is_company FROM sellers WHERE seller_code = $1', [product.seller_code]),
    pool.query(
      'SELECT id, author, question, answer, created_at, answered_at, is_private FROM questions WHERE product_code = $1 AND NOT hidden ORDER BY created_at DESC',
      [product.product_code],
    ),
  ])
  return {
    ...product,
    notice_table: buildNotice(product, publicItem(item.rows[0]), seller.rows[0]), // 상품정보 제공 고시 표
    item: publicItem(item.rows[0]), // 검수 전 품목은 보관·안전 정보를 빼고 보낸다
    seller: seller.rows[0],
    // 비밀글은 글쓴이 첫 글자와 답변 여부만 (이 상세는 모두에게 같은 캐시). 내용은 쓴 회원만 /my-questions 로 받는다
    questions: questions.rows.map(openQuestion).map((q) => (q.is_private
      ? { id: q.id, author: maskName(q.author), is_private: true, question: null, answer: null, answered: Boolean(q.answer), created_at: q.created_at, answered_at: q.answered_at }
      : { ...q, author: maskName(q.author) })),
  }
}

app.get('/api/tags', async (req, res) => {
  res.json(await cached('tags', 5 * 60_000, async () => (await pool.query('SELECT * FROM tags ORDER BY tag_group, tag_code')).rows))
})

// ---------- 관리자 (2단계) ----------
// 관리자·판매자 화면에서 한 일은 모두 접속 기록에 남긴다
app.use(['/api/admin', '/api/seller'], accessLogger)
app.post('/api/admin/login', login)
app.post('/api/admin/2fa-first', firstTwoFactor) // 2단계 인증 필수인데 아직 등록 안 한 계정의 처음 로그인
app.post('/api/admin/logout', logout)
app.get('/api/admin/me', async (req, res) => {
  const admin = await currentStaff(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  res.json({ loginId: admin.loginId, role: admin.role ?? 'admin', sellerCode: admin.sellerCode ?? null, mfa: Boolean(admin.mfa) })
})
app.use('/api/admin/inquiries', adminInquiryRouter)
app.use('/api/admin/chat-logs', adminChatRouter)
app.use('/api/admin/orders', adminOrderRouter)
app.use('/api/admin/returns', adminReturnRouter)
app.use('/api/admin/access-logs', adminAccessLogRouter)
app.use('/api/admin/reviews', adminReviewRouter)
app.use('/api/admin/dashboard', dashboardRouter)
app.use('/api/admin/banned-words', bannedRouter)
app.use('/api/admin/sellers', adminSellerRouter)
app.use('/api/admin/posts', adminPostRouter)
app.use('/api/admin/site-content', adminSiteRouter)
app.use('/api/admin/settings', adminSettingsRouter)
app.use('/api/admin/staff', adminStaffRouter)
app.use('/api/seller-signup', sellerSignupRouter)
app.get('/api/admin/notifications', requireAdmin, async (req, res) => res.json(await listMails()))
app.use('/api/admin', adminRouter)
app.use('/api/seller/orders', sellerOrderRouter)
app.use('/api/seller/returns', sellerReturnRouter)
app.use('/api/seller', sellerRouter)
app.use('/api', publicInquiryRouter)
app.use('/api', chatRouter)
app.use('/api', recommendRouter)
app.use('/api', restockRouter)
app.use('/api', publicOrderRouter)
app.use('/api', publicReturnRouter)
app.use('/api', reviewRouter)
app.use('/api', shopGroupRouter)
app.use('/api', publicPostRouter)
app.use('/api', publicSiteRouter)
app.use('/api/account/orders', memberReturnRouter)
app.use('/api/account/orders', memberOrderRouter)
app.use('/api/account/oauth', oauthRouter)
app.use('/api/account', accountRouter)
// 올린 사진은 그림으로만 쓰이게: 사진 주소를 직접 열어도 스크립트가 돌지 않는다
app.use('/uploads', express.static(fileURLToPath(UPLOAD_DIR), {
  setHeaders: (res) => res.set({ 'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox", 'Cache-Control': 'public, max-age=31536000, immutable' }),
}))
app.use('/api', (req, res) => res.status(404).json({ error: '없는 주소예요.' }))
app.use(seoRouter)
if (SERVE) await serveDist(app)

app.use((error, req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요. 사진은 2MB 이하만 올릴 수 있어요.' })
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '보낸 내용을 읽지 못했어요.' })
  if ([403, 404].includes(error.status)) return res.status(404).json({ error: '없는 주소예요.' }) // 없는 화면 파일, 폴더 밖으로 나가려는 주소(/assets/../)
  if (error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: '보낸 내용을 처리하지 못했어요.' })
  if (isTransientDbError(error)) {
    // DB가 잠깐 끊기거나 느린 경우: 트랜잭션은 자동으로 되돌려졌으니 다시 시도하면 된다
    console.warn(`[server] ${req.method} ${req.path} · DB 연결 불안정 ${error.code ?? ''}`)
    return res.status(503).json({ error: '잠시 연결이 불안정해요. 몇 초 뒤에 다시 시도해 주세요.' })
  }
  console.error(`[server] ${req.method} ${req.path} · ${error.message}`)
  res.status(500).json({ error: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' })
})

await initDb()
await encryptExisting()
await loadSettings() // 관리자가 고친 사업자 정보·배송비·반품 기간·정책 글
await loadBanned()
startOrderSweeper()
startRetention()
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${server.address().port}${SERVE ? ' (배포 모드: 화면 + API)' : ''}`)
  startRag()
})

// 안전하게 끄기: 새 연결은 받지 않고, 처리 중인 요청(결제 승인 포함)을 끝낸 뒤 DB 연결을 닫는다. 20초가 넘으면 강제 종료
async function shutdown(reason, code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] ${reason}: 처리 중인 요청을 마무리하고 꺼요`)
  setTimeout(() => {
    console.error('[server] 20초 안에 끝나지 않아 강제로 꺼요')
    process.exit(1)
  }, 20_000).unref()
  server.close(async () => {
    await pool.end().catch(() => {})
    console.log('[server] 안전하게 꺼졌어요')
    process.exit(code)
  })
  server.closeIdleConnections?.()
}
process.on('SIGTERM', () => shutdown('종료 신호(SIGTERM)'))
process.on('SIGINT', () => shutdown('종료 신호(SIGINT)'))
// 놓친 비동기 오류는 기록만 하고 계속 돈다. 정말 예상 못 한 오류는 상태를 믿을 수 없으니 안전하게 끄고 자동 재시작에 맡긴다
process.on('unhandledRejection', (error) => console.error(`[server] 처리하지 못한 오류 · ${error?.stack ?? error}`))
process.on('uncaughtException', (error) => {
  console.error(`[server] 예상 못 한 오류 · ${error?.stack ?? error}`)
  shutdown('예상 못 한 오류', 1)
})
