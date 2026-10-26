// 농가 판매 자사몰 백엔드. 화면($PORT) → 이 서버($PORT + 100) → PostgreSQL
// 1단계: 데이터 읽기 / 2단계: 관리자 상품 관리 / 4단계: 상품 Q&A·기업 구매 문의 / 5단계: AI 상담 / 6단계: 추천 / 판매자(농가) 화면 / 7단계: 자체 주문·결제
import 'dotenv/config'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { accountRouter } from './account.js'
import { accessLogger, adminAccessLogRouter } from './accessLog.js'
import { adminRouter, UPLOAD_DIR } from './admin.js'
import { currentAdmin, login, logout, requireAdmin } from './auth.js'
import { listMails } from './mailer.js'
import { adminChatRouter, chatRouter } from './chat.js'
import { initDb, isTransientDbError, pool } from './db.js'
import { adminInquiryRouter, maskName, publicInquiryRouter } from './inquiry.js'
import { adminOrderRouter, memberOrderRouter, publicOrderRouter, sellerOrderRouter, startOrderSweeper } from './orders.js'
import { recommendRouter } from './recommend.js'
import { sellerRouter } from './seller.js'

if (!process.env.PORT && process.env.BACKEND_PORT === undefined) {
  console.error('[server] PORT 환경변수가 없어요. 실습서버 내 계정 터미널에서 실행해 주세요. (echo $PORT 로 확인)')
  process.exit(1)
}
// BACKEND_PORT: 시험 스크립트가 빈 포트(0)로 따로 띄울 때만 쓴다
const PORT = process.env.BACKEND_PORT !== undefined ? Number(process.env.BACKEND_PORT) : Number(process.env.PORT) + 100
const app = express()

// 끄는 중에는 새 요청을 받지 않는다 (처리 중인 요청은 마저 끝낸다)
let shuttingDown = false
app.use((req, res, next) => {
  if (!shuttingDown) return next()
  res.set('Connection', 'close')
  res.status(503).json({ error: '서버를 잠시 다시 켜는 중이에요. 몇 초 뒤에 다시 시도해 주세요.' })
})
// 손님 IP(글 남기기 횟수 제한용)는 앞단 프록시가 붙인 값만 믿는다. 개발: Vite 1단, 배포 시 프록시 수에 맞게 TRUST_PROXY_HOPS
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))
app.disable('x-powered-by')

// 기본 보안 헤더: 파일 종류를 바꿔 해석하지 않기, 다른 사이트의 틀(iframe) 안에 넣지 않기
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' })
  next()
})

// 공유 서버라 같은 서버의 다른 사용자도 이 포트(127.0.0.1)에 직접 접속할 수 있다.
// 화면 서버(Vite·웹 서버)만 아는 PROXY_SECRET을 붙인 요청만 받아서, 직접 접속해 IP를 속이거나 AI 한도를 쓰는 걸 막는다.
const PROXY_SECRET = process.env.PROXY_SECRET ?? ''
if (!PROXY_SECRET) console.warn('[server] PROXY_SECRET이 없어서 누구나 이 포트로 직접 요청할 수 있어요. .env에 넣어 주세요.')
app.use((req, res, next) => {
  if (!PROXY_SECRET) return next()
  const got = Buffer.from(req.get('x-proxy-secret') ?? '')
  const want = Buffer.from(PROXY_SECRET)
  if (got.length === want.length && timingSafeEqual(got, want)) return next()
  res.status(403).json({ error: '허용되지 않은 접근이에요.' })
})

app.use(express.json({ limit: '100kb' }))

// 상품 + 품목·농가 정보를 함께 읽는다. 품절은 재고 0으로 계산한다.
const PRODUCT_SELECT = `
  SELECT p.*, (p.stock = 0) AS sold_out,
         i.name AS item_name, i.category, i.show_brix,
         s.name AS seller_name, s.region AS seller_region, s.is_company
  FROM products p
  JOIN items i ON i.item_code = p.item_code
  JOIN sellers s ON s.seller_code = p.seller_code
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

app.get('/api/products', async (req, res) => {
  const { category } = req.query
  const params = []
  let sql = PRODUCT_SELECT
  if (category) {
    params.push(category)
    sql += ` AND i.category = $${params.length}`
  }
  sql += ' ORDER BY (p.stock = 0), i.category, p.name'
  const { rows } = await pool.query(sql, params)
  res.json(rows)
})

app.get('/api/products/:code', async (req, res) => {
  const { rows } = await pool.query(`${PRODUCT_SELECT} AND p.product_code = $1`, [req.params.code])
  if (rows.length === 0) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  const product = rows[0]
  const [item, seller, questions] = await Promise.all([
    pool.query('SELECT * FROM items WHERE item_code = $1', [product.item_code]),
    pool.query('SELECT * FROM sellers WHERE seller_code = $1', [product.seller_code]),
    pool.query(
      'SELECT id, author, question, answer, created_at, answered_at FROM questions WHERE product_code = $1 AND NOT hidden ORDER BY created_at DESC',
      [product.product_code],
    ),
  ])
  res.json({
    ...product,
    item: item.rows[0],
    seller: seller.rows[0],
    questions: questions.rows.map((q) => ({ ...q, author: maskName(q.author) })),
  })
})

app.get('/api/tags', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tags ORDER BY tag_group, tag_code')
  res.json(rows)
})

// ---------- 관리자 (2단계) ----------
// 관리자·판매자 화면에서 한 일은 모두 접속 기록에 남긴다
app.use(['/api/admin', '/api/seller'], accessLogger)
app.post('/api/admin/login', login)
app.post('/api/admin/logout', logout)
app.get('/api/admin/me', (req, res) => {
  const admin = currentAdmin(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  res.json({ loginId: admin.loginId, role: admin.role ?? 'admin', sellerCode: admin.sellerCode ?? null, mfa: Boolean(admin.mfa) })
})
app.use('/api/admin/inquiries', adminInquiryRouter)
app.use('/api/admin/chat-logs', adminChatRouter)
app.use('/api/admin/orders', adminOrderRouter)
app.use('/api/admin/access-logs', adminAccessLogRouter)
app.get('/api/admin/notifications', requireAdmin, async (req, res) => res.json(await listMails()))
app.use('/api/admin', adminRouter)
app.use('/api/seller/orders', sellerOrderRouter)
app.use('/api/seller', sellerRouter)
app.use('/api', publicInquiryRouter)
app.use('/api', chatRouter)
app.use('/api', recommendRouter)
app.use('/api', publicOrderRouter)
app.use('/api/account/orders', memberOrderRouter)
app.use('/api/account', accountRouter)
// 올린 사진은 그림으로만 쓰이게: 사진 주소를 직접 열어도 스크립트가 돌지 않는다
app.use('/uploads', express.static(fileURLToPath(UPLOAD_DIR), {
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox"),
}))

app.use((error, req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요. 사진은 2MB 이하만 올릴 수 있어요.' })
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '보낸 내용을 읽지 못했어요.' })
  if (isTransientDbError(error)) {
    // DB가 잠깐 끊기거나 느린 경우: 트랜잭션은 자동으로 되돌려졌으니 다시 시도하면 된다
    console.warn(`[server] ${req.method} ${req.path} · DB 연결 불안정 ${error.code ?? ''}`)
    return res.status(503).json({ error: '잠시 연결이 불안정해요. 몇 초 뒤에 다시 시도해 주세요.' })
  }
  console.error(`[server] ${req.method} ${req.path} · ${error.message}`)
  res.status(500).json({ error: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' })
})

await initDb()
startOrderSweeper()
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${server.address().port}`)
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
