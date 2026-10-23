// 농가 판매 자사몰 백엔드. 화면($PORT) → 이 서버($PORT + 100) → PostgreSQL
// 1단계: 데이터 읽기 API / 2단계: 관리자 로그인·상품 등록·수정·사진. 문의·AI 상담은 다음 단계에서 붙인다.
import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { adminRouter, UPLOAD_DIR } from './admin.js'
import { currentAdmin, login, logout } from './auth.js'
import { initDb, pool } from './db.js'

if (!process.env.PORT) {
  console.error('[server] PORT 환경변수가 없어요. 실습서버 내 계정 터미널에서 실행해 주세요. (echo $PORT 로 확인)')
  process.exit(1)
}
const PORT = Number(process.env.PORT) + 100
const app = express()
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
      'SELECT id, author, question, answer, created_at FROM questions WHERE product_code = $1 ORDER BY created_at DESC',
      [product.product_code],
    ),
  ])
  res.json({ ...product, item: item.rows[0], seller: seller.rows[0], questions: questions.rows })
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
app.use('/api/admin', adminRouter)
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
