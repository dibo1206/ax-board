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
import { noticeMissing } from './notice.js'
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

// 판매로 넘어가려면 상품정보 제공 고시의 필수 칸이 있어야 한다. 비어 있으면 안내 문장을 돌려준다
export async function noticeProblem(product) {
  const { rows } = await pool.query('SELECT category FROM items WHERE item_code = $1', [product.item_code])
  const missing = noticeMissing(rows[0]?.category, product.notice, product)
  return missing.length ? `상품정보 고시에서 ${missing.join(', ')} 칸을 채워 주세요.` : null
}

// 판매자 입력 검사용: 품목별 보통 당도 범위 (비어 있으면 그 품목은 검사하지 않음)
export async function itemRanges() {
  const { rows } = await pool.query('SELECT item_code, name, brix_min, brix_max FROM items WHERE brix_min IS NOT NULL OR brix_max IS NOT NULL')
  return new Map(rows.map((r) => [r.item_code, { name: r.name, min: r.brix_min == null ? null : Number(r.brix_min), max: r.brix_max == null ? null : Number(r.brix_max) }]))
}

// 판매 중인 상품의 가격·당도·수확일이 바뀌면 누가 언제 무엇을 바꿨는지 남긴다 (거짓 표시를 나중에 따져 볼 수 있게)
const WATCHED = [['price', '가격'], ['brix', '당도'], ['brix_measured_at', '당도 잰 날'], ['harvest_date', '수확일'], ['notice.origin', '원산지'], ['notice.expiry', '소비기한']]
const watched = (product, key) => (key.startsWith('notice.') ? product.notice?.[key.slice(7)] : product[key])
export async function recordChanges(before, after, who) {
  if (before.status !== 'active') return
  // 숫자는 숫자로 비교한다 (DB 의 "14.0" 과 화면의 "14" 는 같은 값)
  const norm = (v) => (v == null || v === '' ? null : /^\d+(\.\d+)?$/.test(String(v)) ? String(Number(v)) : String(v))
  for (const [key, label] of WATCHED) {
    if (norm(watched(before, key)) === norm(watched(after, key))) continue
    await pool.query('INSERT INTO product_changes (product_code, field, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [before.product_code, label, norm(watched(before, key)), norm(watched(after, key)), who])
  }
}

// 바로 판매된 상품을 관리자가 확인했다고 표시
adminRouter.post('/products/:code/checked', async (req, res) => {
  const { rowCount } = await pool.query('UPDATE products SET auto_checked_at = now() WHERE product_code = $1 AND auto_approved_at IS NOT NULL', [req.params.code])
  if (!rowCount) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  res.status(204).end()
})

adminRouter.get('/products/:code/changes', async (req, res) => {
  const { rows } = await pool.query('SELECT field, old_value, new_value, changed_by, changed_at FROM product_changes WHERE product_code = $1 ORDER BY changed_at DESC LIMIT 50', [req.params.code])
  res.json(rows)
})

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
    SELECT p.*, (p.stock = 0) AS sold_out, i.name AS item_name, i.category, i.status AS item_status, i.show_brix, s.name AS seller_name,
           (SELECT count(*) FROM reviews r WHERE r.product_code = p.product_code AND r.info_match = 'no' AND NOT r.hidden)::int AS info_no,
           (SELECT count(*) FROM product_changes c WHERE c.product_code = p.product_code)::int AS changes
    FROM products p JOIN items i ON i.item_code = p.item_code JOIN sellers s ON s.seller_code = p.seller_code
    ORDER BY (p.status = 'pending') DESC, p.updated_at DESC`)
  res.json(rows.map((p) => ({ ...p, notice_missing: noticeMissing(p.category, p.notice, p) })))
})

const PRODUCT_FIELDS = ['seller_code', 'item_code', 'name', 'price', 'unit', 'stock', 'weight_g', 'count_per_box',
  'brix', 'brix_measured_at', 'harvest_date', 'summary', 'description', 'external_url', 'b2b_available', 'tags', 'status', 'review_note', 'faq', 'notice']
const value = (product, column) => (column === 'faq' ? JSON.stringify(product.faq ?? []) : column === 'notice' ? JSON.stringify(product.notice ?? {}) : product[column])

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
  const problem = product.status === 'active' ? await noticeProblem(product) : null
  if (problem) return res.status(400).json({ error: problem, errors: [problem] })
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
  // 판매자가 당도를 적어 검토를 요청한 상품은 당도계 사진이 있어야 승인한다 (관리자가 직접 등록한 상품은 해당 없음)
  if (current.rows[0].status === 'pending' && product.status === 'active' && product.brix && !current.rows[0].brix_photo_url && current.rows[0].source?.startsWith('판매자')) {
    return res.status(400).json({ error: '당도를 적은 판매자 상품은 당도계 사진이 있어야 승인할 수 있어요. 판매자에게 사진을 요청해 주세요.' })
  }
  // 판매로 넘어갈 때, 판매 중에 고시를 고칠 때는 필수 칸을 확인한다 (재고만 바꿀 때는 보지 않는다)
  if (product.status === 'active' && (current.rows[0].status !== 'active' || 'notice' in req.body)) {
    const problem = await noticeProblem(product)
    if (problem) return res.status(400).json({ error: problem, errors: [problem] })
  }
  if (product.status !== 'draft') product.review_note = null // 승인하면 반려 사유는 지운다
  await recordChanges(current.rows[0], product, `관리자 ${req.admin.loginId}`)
  const row = await updateProduct(req.params.code, product)
  // 승인 기록 (믿을 만한 농가 판단에 쓴다). 반려·내리기는 관리자가 다시 승인할 때까지 그 농가의 자동 승인을 멈춘다
  const before = current.rows[0]
  if (before.status !== 'active' && product.status === 'active') {
    await pool.query('UPDATE products SET admin_approved_at = now(), rejected_at = NULL, review_reason = NULL WHERE product_code = $1', [req.params.code])
  } else if (product.status === 'draft' && product.review_note && before.review_note !== product.review_note) {
    await pool.query('UPDATE products SET rejected_at = now() WHERE product_code = $1', [req.params.code])
  }
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
  const current = await pool.query('SELECT image_url, images, brix_photo_url FROM products WHERE product_code = $1', [req.params.code])
  if (!current.rowCount) return res.status(404).json({ error: '상품을 찾지 못했어요.' })
  if (req.query.role === 'brix') {
    // 당도계 사진 (?role=brix): 상품 페이지의 당도 옆 [측정 사진]으로 보인다. 새로 올리면 옛 사진은 지운다
    let brixUrl
    try {
      brixUrl = await saveOptimized(req.params.code, req.body)
    } catch {
      return res.status(400).json({ error: '사진을 읽지 못했어요. 다른 사진으로 올려 주세요.' })
    }
    const updated = await pool.query('UPDATE products SET brix_photo_url = $1, updated_at = now() WHERE product_code = $2 RETURNING *', [brixUrl, req.params.code])
    await deleteFiles(req.params.code, current.rows[0].brix_photo_url)
    return res.json(updated.rows[0])
  }
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
       brix_photo_url = CASE WHEN brix_photo_url = $1 THEN NULL ELSE brix_photo_url END,
       images = array_remove(images, $1), updated_at = now()
     WHERE product_code = $2 AND (image_url = $1 OR brix_photo_url = $1 OR $1 = ANY(images)) RETURNING *`,
    [url, req.params.code],
  )
  if (!rows.length) return res.status(404).json({ error: '그 사진을 찾지 못했어요.' })
  await deleteFiles(req.params.code, url)
  res.json(rows[0])
}

adminRouter.post('/products/:code/image', rawImage, storeImage)
adminRouter.delete('/products/:code/image', removeImage)
