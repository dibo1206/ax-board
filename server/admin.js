// 관리자 API. 모든 주소가 로그인(requireAdmin)을 거친다.
// 상품 저장·사진 올리기 함수는 판매자 API(seller.js)도 같이 쓴다.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import express from 'express'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'
import { validateProduct } from './validate.js'

export const UPLOAD_DIR = new URL('../uploads/', import.meta.url)
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

export const adminRouter = express.Router()
adminRouter.use(requireAdmin)

export async function codeSets() {
  const [items, sellers, tags] = await Promise.all([
    pool.query('SELECT item_code FROM items'),
    pool.query('SELECT seller_code FROM sellers'),
    pool.query('SELECT tag_code FROM tags'),
  ])
  return {
    itemCodes: new Set(items.rows.map((r) => r.item_code)),
    sellerCodes: new Set(sellers.rows.map((r) => r.seller_code)),
    tagCodes: new Set(tags.rows.map((r) => r.tag_code)),
  }
}

// 상품 등록 화면에 필요한 선택지와 품목 기준 정보
adminRouter.get('/options', async (req, res) => {
  const [items, sellers, tags] = await Promise.all([
    pool.query('SELECT * FROM items ORDER BY category, name'),
    pool.query('SELECT seller_code, name, region, is_company FROM sellers ORDER BY is_company DESC, name'),
    pool.query('SELECT * FROM tags ORDER BY tag_group, tag_code'),
  ])
  res.json({ items: items.rows, sellers: sellers.rows, tags: tags.rows })
})

// 임시 저장 상품까지 모두
adminRouter.get('/products', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*, (p.stock = 0) AS sold_out, i.name AS item_name, i.category, s.name AS seller_name
    FROM products p JOIN items i ON i.item_code = p.item_code JOIN sellers s ON s.seller_code = p.seller_code
    ORDER BY (p.status = 'pending') DESC, p.updated_at DESC`)
  res.json(rows)
})

const PRODUCT_FIELDS = ['seller_code', 'item_code', 'name', 'price', 'unit', 'stock', 'weight_g', 'count_per_box',
  'brix', 'brix_measured_at', 'harvest_date', 'summary', 'external_url', 'b2b_available', 'tags', 'status', 'review_note']

// 검사를 통과한 상품을 넣는다. 같은 코드가 있으면 null
export async function insertProduct(product, source) {
  const exists = await pool.query('SELECT 1 FROM products WHERE product_code = $1', [product.product_code])
  if (exists.rowCount) return null
  const columns = ['product_code', ...PRODUCT_FIELDS]
  const { rows } = await pool.query(
    `INSERT INTO products (${columns.join(', ')}, source)
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, $${columns.length + 1}) RETURNING *`,
    [...columns.map((c) => product[c]), source],
  )
  return rows[0]
}

export async function updateProduct(code, product) {
  const { rows } = await pool.query(
    `UPDATE products SET ${PRODUCT_FIELDS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
     WHERE product_code = $${PRODUCT_FIELDS.length + 1} RETURNING *`,
    [...PRODUCT_FIELDS.map((c) => product[c]), code],
  )
  return rows[0]
}

adminRouter.post('/products', async (req, res) => {
  const { product, errors } = validateProduct(req.body, { ...(await codeSets()), isNew: true })
  if (errors) return res.status(400).json({ error: errors.join(' '), errors })
  const row = await insertProduct(product, '관리자 화면 등록')
  if (!row) return res.status(409).json({ error: '같은 상품 코드가 이미 있어요. 다른 코드를 써 주세요.' })
  console.log(`[admin] ${req.admin.loginId} 상품 등록 ${product.product_code} (${product.status})`)
  res.status(201).json(row)
})

adminRouter.patch('/products/:code', async (req, res) => {
  const current = await pool.query('SELECT * FROM products WHERE product_code = $1', [req.params.code])
  if (!current.rowCount) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  const merged = { ...current.rows[0], ...req.body, product_code: req.params.code }
  const { product, errors } = validateProduct(merged, { ...(await codeSets()), isNew: false })
  if (errors) return res.status(400).json({ error: errors.join(' '), errors })
  if (product.status !== 'draft') product.review_note = null // 승인하면 반려 사유는 지운다
  const row = await updateProduct(req.params.code, product)
  const what = current.rows[0].status === 'pending' && product.status !== 'pending'
    ? (product.status === 'active' ? ' (승인)' : ' (반려)') : ''
  console.log(`[admin] ${req.admin.loginId} 상품 수정 ${req.params.code}${what}`)
  res.json(row)
})

// 상품 사진 올리기: jpg·png·webp, 2MB 이하. 파일 이름은 서버가 정한다
export const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES })

export async function storeImage(req, res) {
  const ext = IMAGE_TYPES[req.headers['content-type']]
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: '사진은 jpg, png, webp 파일만 올릴 수 있어요. (2MB 이하)' })
  }
  const current = await pool.query('SELECT 1 FROM products WHERE product_code = $1', [req.params.code])
  if (!current.rowCount) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  await mkdir(UPLOAD_DIR, { recursive: true })
  const fileName = `${req.params.code}-${randomBytes(4).toString('hex')}.${ext}`
  await writeFile(new URL(fileName, UPLOAD_DIR), req.body)
  const { rows } = await pool.query(
    'UPDATE products SET image_url = $1, updated_at = now() WHERE product_code = $2 RETURNING *',
    [`/uploads/${fileName}`, req.params.code],
  )
  res.json(rows[0])
}

adminRouter.post('/products/:code/image', rawImage, storeImage)
