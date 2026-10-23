// 농가 판매 자사몰 백엔드. 화면($PORT) → 이 서버($PORT + 100) → PostgreSQL
// 1단계: 데이터 읽기 / 2단계: 관리자 상품 관리 / 4단계: 상품 Q&A·기업 구매 문의 / 5단계: AI 상담
import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { adminRouter, UPLOAD_DIR } from './admin.js'
import { currentAdmin, login, logout } from './auth.js'
import { adminChatRouter, chatRouter } from './chat.js'
import { initDb, pool } from './db.js'
import { adminInquiryRouter, maskName, publicInquiryRouter } from './inquiry.js'

if (!process.env.PORT) {
  console.error('[server] PORT 환경변수가 없어요. 실습서버 내 계정 터미널에서 실행해 주세요. (echo $PORT 로 확인)')
  process.exit(1)
}
const PORT = Number(process.env.PORT) + 100
const app = express()
// 손님 IP(글 남기기 횟수 제한용)는 앞단 프록시가 붙인 값만 믿는다. 개발: Vite 1단, 배포 시 프록시 수에 맞게 TRUST_PROXY_HOPS
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))
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
  res.json({ loginId: admin.loginId })
})
app.use('/api/admin/inquiries', adminInquiryRouter)
app.use('/api/admin/chat-logs', adminChatRouter)
app.use('/api/admin', adminRouter)
app.use('/api', publicInquiryRouter)
app.use('/api', chatRouter)
app.use('/uploads', express.static(fileURLToPath(UPLOAD_DIR)))

app.use((error, req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 커요. 사진은 2MB 이하만 올릴 수 있어요.' })
  console.error(`[server] ${req.method} ${req.path} · ${error.message}`)
  res.status(500).json({ error: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' })
})

await initDb()
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] http://127.0.0.1:${PORT}`)
})
