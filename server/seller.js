// 판매자(농가) API. 로그인한 농가의 상품·질문·소개만 다룬다 (다른 농가 것은 없는 것처럼 404)
// 새 상품은 '검토 대기'로 올라가고 회사 관리자가 승인해야 판매된다. 이미 판매 중인 상품의 수정(가격·재고 등)은 바로 반영된다.
import express from 'express'
import { codeSets, insertProduct, itemRanges, rawImage, recordChanges, removeImage, storeImage, updateProduct } from './admin.js'
import { requireSeller } from './auth.js'
import { bannedMessage, findBanned } from './banned.js'
import { fillItem, listTemplates, productDraft } from './content.js'
import { pool } from './db.js'
import { requestItem } from './items.js'
import { validateProduct } from './validate.js'

export const sellerRouter = express.Router()
sellerRouter.use(requireSeller)

const text = (v) => (typeof v === 'string' ? v.trim() : '')

// AI 상세 내용 초안 (농가는 자기 농가로 고정) · 상세페이지 패턴 · 품목 빈 칸 채우기
sellerRouter.get('/ai/templates', listTemplates)
sellerRouter.post('/ai/product-draft', productDraft)
sellerRouter.post('/items/:code/fill', fillItem)
sellerRouter.post('/items/request', requestItem) // 목록에 없는 품목 요청 → 관리자 검수 (items.js)
const mine = (req) => req.seller.sellerCode

// 상품이 내 농가 것인지 확인하고 req.product에 담는다
async function ownProduct(req, res, next) {
  const { rows } = await pool.query('SELECT * FROM products WHERE product_code = $1 AND seller_code = $2', [req.params.code, mine(req)])
  if (!rows.length) return res.status(404).json({ error: '내 농가 상품 중에서 찾지 못했어요.' })
  req.product = rows[0]
  next()
}

// 판매자가 정할 수 있는 상태: 임시 저장(draft) / 검토 요청(pending). 판매 중(active)인 상품은 판매 중으로 두거나 판매 중지(draft)만
function nextStatus(requested, current) {
  if (requested === 'draft') return 'draft'
  if (current === 'active') return 'active'
  return 'pending'
}

sellerRouter.get('/me', async (req, res) => {
  const { rows } = await pool.query('SELECT seller_code, name, region, intro, story FROM sellers WHERE seller_code = $1', [mine(req)])
  res.json({ loginId: req.seller.loginId, role: 'seller', seller: rows[0], mfa: Boolean(req.seller.mfa) })
})

sellerRouter.patch('/profile', async (req, res) => {
  const intro = text(req.body.intro)
  const story = text(req.body.story)
  const errors = []
  if (intro.length > 100) errors.push('한 줄 소개는 100자 안으로 적어 주세요.')
  if (story.length > 1500) errors.push('농가 이야기는 1500자 안으로 적어 주세요.')
  const bad = findBanned(`${intro} ${story}`)
  if (bad.length) errors.push(bannedMessage(bad))
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  const { rows } = await pool.query(
    'UPDATE sellers SET intro = $1, story = $2 WHERE seller_code = $3 RETURNING seller_code, name, region, intro, story',
    [intro || null, story || null, mine(req)],
  )
  console.log(`[seller] ${req.seller.loginId} 농가 소개 수정`)
  res.json(rows[0])
})

sellerRouter.get('/options', async (req, res) => {
  const [items, tags] = await Promise.all([
    pool.query('SELECT * FROM items ORDER BY category, name'),
    pool.query('SELECT * FROM tags ORDER BY tag_group, tag_code'),
  ])
  res.json({ items: items.rows, tags: tags.rows })
})

sellerRouter.get('/products', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*, (p.stock = 0) AS sold_out, i.name AS item_name, i.category
    FROM products p JOIN items i ON i.item_code = p.item_code
    WHERE p.seller_code = $1
    ORDER BY (p.status = 'draft' AND p.review_note IS NOT NULL) DESC, p.updated_at DESC`, [mine(req)])
  res.json(rows)
})

sellerRouter.post('/products', async (req, res) => {
  const body = { ...req.body, seller_code: mine(req), status: nextStatus(req.body.status, null), review_note: null }
  const { product, errors } = validateProduct(body, { ...(await codeSets()), isNew: true, itemRanges: await itemRanges() })
  if (errors) return res.status(400).json({ error: errors.join(' '), errors })
  const row = await insertProduct(product, `판매자 화면 등록 (${req.seller.loginId})`)
  if (!row) return res.status(409).json({ error: '같은 상품 코드가 이미 있어요. 다른 코드를 써 주세요.' })
  console.log(`[seller] ${req.seller.loginId} 상품 등록 ${product.product_code} (${product.status})`)
  res.status(201).json(row)
})

sellerRouter.patch('/products/:code', ownProduct, async (req, res) => {
  const current = req.product
  const status = nextStatus(req.body.status ?? current.status, current.status)
  // 다시 검토를 요청하면 반려 사유는 지운다. 그 밖에는 관리자가 남긴 사유를 그대로 둔다
  const reviewNote = status === 'pending' ? null : current.review_note
  const merged = { ...current, ...req.body, product_code: current.product_code, seller_code: mine(req), status, review_note: reviewNote }
  const { product, errors } = validateProduct(merged, { ...(await codeSets()), isNew: false, itemRanges: await itemRanges() })
  if (errors) return res.status(400).json({ error: errors.join(' '), errors })
  await recordChanges(current, product, `판매자 ${req.seller.loginId}`)
  let row = await updateProduct(current.product_code, product)
  // 당도를 바꾸면 옛 당도계 사진은 새 값의 증거가 아니라서 내린다 (새 사진을 올리면 다시 붙는다)
  const brixOf = (v) => (v == null || v === '' ? null : Number(v)) // DB 의 "14.0" 과 화면의 "14" 는 같은 값
  if (brixOf(current.brix) !== brixOf(product.brix) && current.brix_photo_url) {
    row = (await pool.query('UPDATE products SET brix_photo_url = NULL WHERE product_code = $1 RETURNING *', [current.product_code])).rows[0]
  }
  console.log(`[seller] ${req.seller.loginId} 상품 수정 ${current.product_code} (${current.status} → ${status})`)
  res.json(row)
})

sellerRouter.post('/products/:code/image', ownProduct, rawImage, storeImage)
sellerRouter.delete('/products/:code/image', ownProduct, removeImage)

// 내 상품에 달린 질문 (연락처는 회사만 본다)
sellerRouter.get('/questions', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.id, q.product_code, q.author, q.question, q.answer, q.created_at, q.answered_at, p.name AS product_name
    FROM questions q JOIN products p ON p.product_code = q.product_code
    WHERE p.seller_code = $1 AND NOT q.hidden
    ORDER BY (q.answer IS NULL) DESC, q.created_at DESC`, [mine(req)])
  res.json(rows)
})

sellerRouter.patch('/questions/:id', async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: '질문을 찾지 못했어요.' })
  const answer = text(req.body.answer)
  if (answer.length < 2 || answer.length > 1000) return res.status(400).json({ error: '답변을 2~1000자로 적어 주세요.' })
  const bad = findBanned(answer)
  if (bad.length) return res.status(400).json({ error: bannedMessage(bad) })
  const { rows } = await pool.query(
    `UPDATE questions q SET answer = $1, answered_at = now()
     FROM products p
     WHERE q.id = $2 AND p.product_code = q.product_code AND p.seller_code = $3 AND NOT q.hidden
     RETURNING q.id, q.product_code, q.author, q.question, q.answer, q.created_at, q.answered_at, p.name AS product_name`,
    [answer, req.params.id, mine(req)],
  )
  if (!rows.length) return res.status(404).json({ error: '내 상품 질문 중에서 찾지 못했어요.' })
  console.log(`[seller] ${req.seller.loginId} 질문 #${rows[0].id} 답변`)
  res.json(rows[0])
})
