// 농가 판매 자사몰 백엔드. 화면($PORT) → 이 서버($PORT + 100) → PostgreSQL
// 1단계: 데이터 읽기 / 2단계: 관리자 상품 관리 / 4단계: 상품 Q&A·기업 구매 문의 / 5단계: AI 상담 / 6단계: 추천 / 판매자(농가) 화면
import 'dotenv/config'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { adminRouter, UPLOAD_DIR } from './admin.js'
import { currentAdmin, login, logout } from './auth.js'
import { adminChatRouter, chatRouter } from './chat.js'
import { initDb, pool } from './db.js'
import { adminInquiryRouter, maskName, publicInquiryRouter } from './inquiry.js'
import { recommendRouter } from './recommend.js'
import { sellerRouter } from './seller.js'

if (!process.env.PORT) {
  console.error('[server] PORT 환경변수가 없어요. 실습서버 내 계정 터미널에서 실행해 주세요. (echo $PORT 로 확인)')
  process.exit(1)
}
const PORT = Number(process.env.PORT) + 100
const app = express()
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

app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
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
app.post('/api/admin/login', login)
app.post('/api/admin/logout', logout)
app.get('/api/admin/me', (req, res) => {
  const admin = currentAdmin(req)
  if (!admin) return res.status(401).json({ error: '관리자 로그인이 필요해요.' })
  res.json({ loginId: admin.loginId, role: admin.role ?? 'admin', sellerCode: admin.sellerCode ?? null })
})
app.use('/api/admin/inquiries', adminInquiryRouter)
app.use('/api/admin/chat-logs', adminChatRouter)
app.use('/api/admin', adminRouter)
app.use('/api/seller', sellerRouter)
app.use('/api', publicInquiryRouter)
app.use('/api', chatRouter)
app.use('/api', recommendRouter)
// 올린 사진은 그림으로만 쓰이게: 사진 주소를 직접 열어도 스크립트가 돌지 않는다
app.use('/uploads', express.static(fileURLToPath(UPLOAD_DIR), {
  setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox"),
}))

app.use((error, req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요. 사진은 2MB 이하만 올릴 수 있어요.' })
  console.error(`[server] ${req.method} ${req.path} · ${error.message}`)
  res.status(500).json({ error: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' })
})

await initDb()
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${PORT}`)
})
