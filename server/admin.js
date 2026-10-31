// 관리자 API. 모든 주소가 로그인(requireAdmin)을 거친다.
// 상품 저장·사진 올리기 함수는 판매자 API(seller.js)도 같이 쓴다.
import { randomBytes } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import express from 'express'
import sharp from 'sharp'
import { requireAdmin } from './auth.js'
import { findBanned } from './banned.js'
import { fillItem, listTemplates, productDraft } from './content.js'
import { pool } from './db.js'
import { approveItem, listReview, requestItem, saveItem } from './items.js'
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
    findBanned, // 관리자가 고치는 금지어 사전으로 검사
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
    SELECT p.*, (p.stock = 0) AS sold_out, i.name AS item_name, i.category, i.status AS item_status, s.name AS seller_name
    FROM products p JOIN items i ON i.item_code = p.item_code JOIN sellers s ON s.seller_code = p.seller_code
    ORDER BY (p.status = 'pending') DESC, p.updated_at DESC`)
  res.json(rows)
})

const PRODUCT_FIELDS = ['seller_code', 'item_code', 'name', 'price', 'unit', 'stock', 'weight_g', 'count_per_box',
  'brix', 'brix_measured_at', 'harvest_date', 'summary', 'description', 'external_url', 'b2b_available', 'tags', 'status', 'review_note', 'faq']
const value = (product, column) => (column === 'faq' ? JSON.stringify(product.faq ?? []) : product[column])

// 검사를 통과한 상품을 넣는다. 같은 코드가 있으면 null
export async function insertProduct(product, source) {
  const exists = await pool.query('SELECT 1 FROM products WHERE product_code = $1', [product.product_code])
  if (exists.rowCount) return null
  const columns = ['product_code', ...PRODUCT_FIELDS]
  const { rows } = await pool.query(
    `INSERT INTO products (${columns.join(', ')}, source)
     VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, $${columns.length + 1}) RETURNING *`,
    [...columns.map((c) => value(product, c)), source],
  )
  return rows[0]
}

export async function updateProduct(code, product) {
  const { rows } = await pool.query(
    // 가격이 바뀌면 가격 기준일을 오늘로 (오른쪽의 price 는 바꾸기 전 값)
    `UPDATE products SET ${PRODUCT_FIELDS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now(),
       price_updated_at = CASE WHEN price IS DISTINCT FROM $${PRODUCT_FIELDS.indexOf('price') + 1}::int THEN now() ELSE price_updated_at END
     WHERE product_code = $${PRODUCT_FIELDS.length + 1} RETURNING *`,
    [...PRODUCT_FIELDS.map((c) => value(product, c)), code],
  )
  return rows[0]
}

// AI 상세 내용 초안 · 상세페이지 패턴 · 품목 빈 칸 채우기 (content.js)
adminRouter.get('/ai/templates', listTemplates)
adminRouter.post('/ai/product-draft', productDraft)
adminRouter.post('/items/:code/fill', fillItem)
// 새 품목 요청 · 검수 (items.js)
adminRouter.post('/items/request', requestItem)
adminRouter.get('/items/review', listReview)
adminRouter.put('/items/:code', saveItem)
adminRouter.post('/items/:code/approve', approveItem)

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

// 형식마다 파일 맨 앞에 오는 고정된 바이트
function looksLike(type, b) {
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (type === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (type === 'image/webp') return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
  return false
}

// 상품 사진 올리기: jpg·png·webp, 2MB 이하. 파일 이름은 서버가 정한다
// 받은 사진은 방향을 바로잡고, 긴 변 1200px 이하로 줄여 WebP로 바꾸고, 목록용 400px 정사각 썸네일(-thumb.webp)도 만든다.
// 이때 촬영 위치(GPS) 같은 사진 속 정보는 모두 지워진다. ?role=gallery 이면 상세 사진(최대 8장)에 더하고, 아니면 대표 사진을 바꾼다
export const rawImage = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES })
const MAX_GALLERY = 8
const OUR_FILE = (code) => new RegExp(`^/uploads/${code}-[0-9a-f]{12}\\.webp$`)

async function saveOptimized(code, buffer) {
  const base = `${code}-${randomBytes(6).toString('hex')}`
  const image = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate()
  const [large, thumb] = await Promise.all([
    image.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    image.clone().resize({ width: 400, height: 400, fit: 'cover' }).webp({ quality: 78 }).toBuffer(),
  ])
  await mkdir(UPLOAD_DIR, { recursive: true })
  await Promise.all([writeFile(new URL(`${base}.webp`, UPLOAD_DIR), large), writeFile(new URL(`${base}-thumb.webp`, UPLOAD_DIR), thumb)])
  return `/uploads/${base}.webp`
}

// 우리가 만든 사진 파일만 지운다 (주소 형식이 맞을 때만)
async function deleteFiles(code, url) {
  if (!url || !OUR_FILE(code).test(url)) return
  const name = url.slice('/uploads/'.length)
  await Promise.all([name, name.replace(/\.webp$/, '-thumb.webp')].map((n) => unlink(new URL(n, UPLOAD_DIR)).catch(() => {})))
}

export async function storeImage(req, res) {
  const type = req.headers['content-type']
  const ext = IMAGE_TYPES[type]
  // 이름표(Content-Type)만 믿지 않고 파일 앞부분이 진짜 그 사진 형식인지 확인한다
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0 || !looksLike(type, req.body)) {
    return res.status(400).json({ error: '사진은 jpg, png, webp 파일만 올릴 수 있어요. (2MB 이하)' })
  }
  const current = await pool.query('SELECT image_url, images FROM products WHERE product_code = $1', [req.params.code])
  if (!current.rowCount) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  const gallery = req.query.role === 'gallery'
  if (gallery && current.rows[0].images.length >= MAX_GALLERY) return res.status(400).json({ error: `상세 사진은 ${MAX_GALLERY}장까지 올릴 수 있어요.` })
  let url
  try {
    url = await saveOptimized(req.params.code, req.body)
  } catch {
    return res.status(400).json({ error: '사진을 읽지 못했어요. 다른 사진으로 올려 주세요.' })
  }
  const { rows } = gallery
    ? await pool.query('UPDATE products SET images = array_append(images, $1), updated_at = now() WHERE product_code = $2 RETURNING *', [url, req.params.code])
    : await pool.query('UPDATE products SET image_url = $1, updated_at = now() WHERE product_code = $2 RETURNING *', [url, req.params.code])
  if (!gallery) await deleteFiles(req.params.code, current.rows[0].image_url) // 바꾼 대표 사진의 옛 파일 정리
  res.json(rows[0])
}

// 사진 지우기: { url } — 대표 사진이면 비우고, 상세 사진이면 목록에서 뺀다
export async function removeImage(req, res) {
  const url = typeof req.body.url === 'string' ? req.body.url : ''
  const { rows } = await pool.query(
    `UPDATE products SET image_url = CASE WHEN image_url = $1 THEN NULL ELSE image_url END,
       images = array_remove(images, $1), updated_at = now()
     WHERE product_code = $2 AND (image_url = $1 OR $1 = ANY(images)) RETURNING *`,
    [url, req.params.code],
  )
  if (!rows.length) return res.status(404).json({ error: '그 사진을 찾지 못했어요.' })
  await deleteFiles(req.params.code, url)
  res.json(rows[0])
}

adminRouter.post('/products/:code/image', rawImage, storeImage)
adminRouter.delete('/products/:code/image', removeImage)
