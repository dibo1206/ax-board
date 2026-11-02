// 농가 판매 자사몰 백엔드. 개발: 화면(Vite, $PORT) → 이 서버($PORT + 100) → PostgreSQL
// 배포(npm run build → npm start): 이 서버 하나가 $PORT 에서 화면(dist)과 API를 함께 보낸다
// 1단계: 데이터 읽기 / 2단계: 관리자 상품 관리 / 4단계: 상품 Q&A·기업 구매 문의 / 5단계: AI 상담 / 6단계: 추천 / 판매자(농가) 화면 / 7단계: 자체 주문·결제
import 'dotenv/config'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { accountRouter } from './account.js'
import { accessLogger, adminAccessLogRouter } from './accessLog.js'
import { dashboardRouter } from './dashboard.js'
import { adminRouter, UPLOAD_DIR } from './admin.js'
import { bannedRouter, loadBanned } from './banned.js'
import { cached, clearCache } from './cache.js'
import { currentStaff, login, logout, requireAdmin } from './auth.js'
import { listMails } from './mailer.js'
import { adminChatRouter, chatRouter } from './chat.js'
import { initDb, isTransientDbError, pool } from './db.js'
import { adminInquiryRouter, maskName, publicInquiryRouter } from './inquiry.js'
import { publicItem } from './items.js'
import { buildNotice } from './notice.js'
import { adminOrderRouter, memberOrderRouter, publicOrderRouter, sellerOrderRouter, startOrderSweeper } from './orders.js'
import { recommendRouter } from './recommend.js'
import { adminReviewRouter, reviewRouter } from './reviews.js'
import { sellerRouter } from './seller.js'
import { adminSellerRouter, sellerSignupRouter } from './sellers.js'
import { groupWhere, shopGroupRouter } from './shopGroups.js'
import { seoRouter, serveDist } from './web.js'

if (!process.env.PORT && process.env.BACKEND_PORT === undefined) {
  console.error('[server] PORT 환경변수가 없어요. 실습서버 내 계정 터미널에서 실행해 주세요. (echo $PORT 로 확인)')
  process.exit(1)
}
const SERVE = process.argv.includes('--serve') // 배포 모드: 화면까지 이 서버가 보낸다
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
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))
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

// 무언가 바뀌면(관리자·판매자 수정, 주문, 후기·문의 남기기) 기억해 둔 상품 목록·상세를 지운다. AI 상담은 상품을 바꾸지 않아서 뺀다
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.path.startsWith('/api/chat')) {
    res.on('finish', () => { if (res.statusCode < 400) clearCache() })
  }
  next()
})

// 상품 + 품목·농가 정보를 함께 읽는다. 품절은 재고 0으로 계산한다.
const PRODUCT_SELECT = `
  SELECT p.*, (p.stock = 0) AS sold_out,
         i.name AS item_name, i.category, i.show_brix,
         s.name AS seller_name, s.region AS seller_region, s.is_company,
         rv.rating, COALESCE(rv.review_count, 0) AS review_count, COALESCE(sales.sold, 0) AS sold_30d,
         -- 후기에서 '표시 정보와 달랐어요'가 3개 이상이고 답한 사람의 절반 이상이면 당도 표시를 내린다
         (COALESCE(rv.info_no, 0) >= 3 AND rv.info_no * 2 >= rv.info_answers) AS info_disputed
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
const publicProduct = ({ review_note: _n, review_reason: _r, rejected_at: _x, admin_approved_at: _a, auto_approved_at: _o, auto_checked_at: _c, ...p }) => p

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
}

app.get('/api/catalog', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 50)
  const sort = Object.hasOwn(SORTS, req.query.sort) ? req.query.sort : 'recommended'
  const size = Math.min(48, Math.max(1, Number(req.query.size) || 12))
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
  // 단어마다 상품 이름·품목·소개·농가·태그 중 하나에 들어 있어야 한다 (%·_는 글자 그대로 찾게)
  for (const word of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
    params.push(`%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    const n = `$${params.length}`
    where += ` AND (p.name ILIKE ${n} OR i.name ILIKE ${n} OR p.summary ILIKE ${n} OR s.name ILIKE ${n}
               OR EXISTS (SELECT 1 FROM tags t WHERE t.tag_code = ANY(p.tags) AND t.label ILIKE ${n}))`
  }
  params.push(size, (page - 1) * size)
  // 같은 검색·정렬·페이지는 15초 동안 DB를 다시 읽지 않는다 (재고는 주문할 때 서버가 다시 확인)
  res.json(await cached(`catalog:${JSON.stringify(params)}:${sort}:${group ? req.query.group : ''}`, 15_000, async () => {
    const { rows } = await pool.query(
      `SELECT x.*, count(*) OVER () AS total FROM (${PRODUCT_SELECT} ${where}) x
       ORDER BY (x.stock = 0), ${SORTS[sort]} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    const total = Number(rows[0]?.total ?? 0)
    return { items: rows.map(({ total: _t, ...p }) => publicProduct(p)), total, page, pages: Math.max(1, Math.ceil(total / size)), sort }
  }))
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
      'SELECT id, author, question, answer, created_at, answered_at FROM questions WHERE product_code = $1 AND NOT hidden ORDER BY created_at DESC',
      [product.product_code],
    ),
  ])
  return {
    ...product,
    notice_table: buildNotice(product, publicItem(item.rows[0]), seller.rows[0]), // 상품정보 제공 고시 표
    item: publicItem(item.rows[0]), // 검수 전 품목은 보관·안전 정보를 빼고 보낸다
    seller: seller.rows[0],
    questions: questions.rows.map((q) => ({ ...q, author: maskName(q.author) })),
  }
}

app.get('/api/tags', async (req, res) => {
  res.json(await cached('tags', 5 * 60_000, async () => (await pool.query('SELECT * FROM tags ORDER BY tag_group, tag_code')).rows))
})

// ---------- 관리자 (2단계) ----------
// 관리자·판매자 화면에서 한 일은 모두 접속 기록에 남긴다
app.use(['/api/admin', '/api/seller'], accessLogger)
app.post('/api/admin/login', login)
app.post('/api/admin/logout', logout)
app.get('/api/admin/me', async (req, res) => {
  const admin = await currentStaff(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  res.json({ loginId: admin.loginId, role: admin.role ?? 'admin', sellerCode: admin.sellerCode ?? null, mfa: Boolean(admin.mfa) })
})
app.use('/api/admin/inquiries', adminInquiryRouter)
app.use('/api/admin/chat-logs', adminChatRouter)
app.use('/api/admin/orders', adminOrderRouter)
app.use('/api/admin/access-logs', adminAccessLogRouter)
app.use('/api/admin/reviews', adminReviewRouter)
app.use('/api/admin/dashboard', dashboardRouter)
app.use('/api/admin/banned-words', bannedRouter)
app.use('/api/admin/sellers', adminSellerRouter)
app.use('/api/seller-signup', sellerSignupRouter)
app.get('/api/admin/notifications', requireAdmin, async (req, res) => res.json(await listMails()))
app.use('/api/admin', adminRouter)
app.use('/api/seller/orders', sellerOrderRouter)
app.use('/api/seller', sellerRouter)
app.use('/api', publicInquiryRouter)
app.use('/api', chatRouter)
app.use('/api', recommendRouter)
app.use('/api', publicOrderRouter)
app.use('/api', reviewRouter)
app.use('/api', shopGroupRouter)
app.use('/api/account/orders', memberOrderRouter)
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
  if (error.status === 404) return res.status(404).json({ error: '없는 주소예요.' }) // 없는 화면 파일(/assets/...)
  if (isTransientDbError(error)) {
    // DB가 잠깐 끊기거나 느린 경우: 트랜잭션은 자동으로 되돌려졌으니 다시 시도하면 된다
    console.warn(`[server] ${req.method} ${req.path} · DB 연결 불안정 ${error.code ?? ''}`)
    return res.status(503).json({ error: '잠시 연결이 불안정해요. 몇 초 뒤에 다시 시도해 주세요.' })
  }
  console.error(`[server] ${req.method} ${req.path} · ${error.message}`)
  res.status(500).json({ error: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' })
})

await initDb()
await loadBanned()
startOrderSweeper()
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${server.address().port}${SERVE ? ' (배포 모드: 화면 + API)' : ''}`)
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
