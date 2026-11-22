// 판매자(농가) API. 로그인한 농가의 상품·질문·소개만 다룬다 (다른 농가 것은 없는 것처럼 404)
// 새 상품은 '검토 대기'로 올라가고 회사 관리자가 승인해야 판매된다. 이미 판매 중인 상품의 수정(가격·재고 등)은 바로 반영된다.
import { notifyAnswer } from './inquiry.js'
import express from 'express'
import { checkOptions, codeSets, deleteBlockImages, deleteFiles, IMAGE_TYPES, insertProduct, itemRanges, looksLike, noticeProblem, rawImage, recordChanges, removeImage, saveOptimized, stoppedNote, storeImage, updateProduct } from './admin.js'
import { writeAccessLog } from './accessLog.js'
import { hashPassword, issueStaffSession, passwordMatches, requireSeller, reserveAttempt, undoAttempt } from './auth.js'
import { bannedMessage, findBanned } from './banned.js'
import { sameBlocks } from './blocks.js'
import { clearCache } from './cache.js'
import { fillItem, listTemplates, productDraft, productParse } from './content.js'
import { pool } from './db.js'
import { maskName } from './inquiry.js'
import { requestItem } from './items.js'
import { ALL_OPTIONS_SQL, currentOptions, saveOptions } from './options.js'
import { openQuestion } from './pii.js'
import { submitProduct } from './sellers.js'
import { passwordProblem } from './staff.js'
import { validateProduct } from './validate.js'

export const sellerRouter = express.Router()
sellerRouter.use(requireSeller)

const text = (v) => (typeof v === 'string' ? v.trim() : '')

// AI 상세 내용 초안 (농가는 자기 농가로 고정) · 상세페이지 패턴 · 품목 빈 칸 채우기
sellerRouter.get('/ai/templates', listTemplates)
sellerRouter.post('/ai/product-draft', productDraft)
sellerRouter.post('/ai/product-parse', productParse) // 말로 상품 등록하기 (칸 채우기만)
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

// 승인받은 뒤 상품 내용을 바꾸면 다시 확인한다: 승인받은 상품을 다른 상품으로 바꿔치기하지 못하게 (2026-11-11 보안 점검)
// 재고·가격·당도·수확일처럼 늘 바뀌는 값은 바로 반영되고 수정 이력에 남는다
const REVIEWED_FIELDS = ['name', 'item_code', 'unit', 'summary', 'description', 'weight_g', 'count_per_box']
const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()
async function contentChanged(current, product) {
  if (REVIEWED_FIELDS.some((key) => !same(current[key], product[key]))) return true
  if (!sameBlocks(current.detail_blocks, product.detail_blocks)) return true // 상세 블록(글·사진)도 상품 내용
  if (!product.options) return false
  // 새 이름의 옵션이 생기거나 이름이 바뀌면 다시 본다 (판매 중지·삭제는 품절처럼 바로 반영)
  const before = new Set((await currentOptions(current.product_code)).map((o) => o.name))
  return product.options.some((o) => !before.has(o.name))
}

// 내용이 바뀐 판매 중 상품을 검토로 돌린다. 믿을 만한 농가면 자동 승인 규칙대로 바로 판매되고 관리자 목록에 '확인 전'으로 남는다
async function sendBackToReview(product) {
  const { rows } = await pool.query("UPDATE products SET status = 'pending', auto_approved_at = NULL, auto_checked_at = NULL, updated_at = now() WHERE product_code = $1 AND status = 'active' RETURNING *", [product.product_code])
  if (!rows[0]) return { product, reasons: [] }
  const result = await submitProduct(rows[0])
  if (result.product.status !== 'pending') return result
  const reasons = ['승인 뒤 상품 내용이 바뀌었어요', ...result.reasons]
  const updated = await pool.query('UPDATE products SET review_reason = $2 WHERE product_code = $1 RETURNING *', [product.product_code, reasons.join(' / ')])
  return { product: updated.rows[0], reasons }
}

// 판매 중 상품의 대표·상세 사진을 바꿔도 같게 (당도계 사진은 당도처럼 바로 반영)
function recheckPhotos(req, res, next) {
  if (req.query.role !== 'brix') {
    req.afterPhoto = async (row) => {
      if (row.status !== 'active') return row
      await pool.query('INSERT INTO product_changes (product_code, field, new_value, changed_by) VALUES ($1, $2, $3, $4)', [row.product_code, '사진', row.image_url, `판매자 ${req.seller.loginId}`])
      return (await sendBackToReview(row)).product
    }
  }
  next()
}

// 판매자 첫 화면의 [오늘 할 일]: 내 농가 몫만 센다. 여러 농가 주문은 농가 배송(order_shipments) 기준이라 관리자 대시보드와 같다
const TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"
sellerRouter.get('/summary', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
         WHERE sh.seller_code = $1 AND sh.status = 'paid' AND o.status IN ('paid', 'preparing', 'shipping')
           AND (sh.ship_from IS NULL OR sh.ship_from <= ${TODAY}))::int AS to_prepare,
       (SELECT count(*) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
         WHERE sh.seller_code = $1 AND sh.status = 'preparing' AND o.status IN ('paid', 'preparing', 'shipping'))::int AS to_ship,
       (SELECT count(*) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
         WHERE sh.seller_code = $1 AND sh.status = 'paid' AND o.status IN ('paid', 'preparing', 'shipping') AND sh.ship_from > ${TODAY})::int AS preorders_waiting,
       (SELECT count(*) FROM questions q JOIN products p ON p.product_code = q.product_code
         WHERE p.seller_code = $1 AND q.answer IS NULL AND NOT q.hidden)::int AS questions_waiting,
       (SELECT count(*) FROM order_returns r WHERE r.seller_code = $1 AND r.status = 'requested')::int AS returns_waiting,
       (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.status = 'active')::int AS selling,
       (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.status = 'pending')::int AS reviewing,
       (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.status = 'draft' AND p.review_note IS NOT NULL)::int AS rejected,
       (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.status = 'active' AND p.stock = 0)::int AS sold_out,
       (SELECT count(*) FROM products p WHERE p.seller_code = $1 AND p.status = 'active' AND p.stock BETWEEN 1 AND 5)::int AS low_stock,
       (SELECT count(*) FROM restock_requests r JOIN products p ON p.product_code = r.product_code
         WHERE p.seller_code = $1 AND r.notified_at IS NULL)::int AS restock_waiting`,
    [mine(req)],
  )
  res.json(rows[0])
})

sellerRouter.get('/me', async (req, res) => {
  const { rows } = await pool.query('SELECT seller_code, name, region, intro, story, photos, status, reject_note FROM sellers WHERE seller_code = $1', [mine(req)])
  res.json({ loginId: req.seller.loginId, role: 'seller', seller: rows[0], mfa: Boolean(req.seller.mfa) })
})

// 내 비밀번호 바꾸기 {myPassword, password}: 바꾸면 다른 곳의 로그인은 끊기고 이 브라우저는 이어 간다 (2026-11-11 보안 점검)
sellerRouter.post('/password', async (req, res) => {
  const problem = passwordProblem(req.body?.password, req.seller.loginId)
  if (problem) return res.status(400).json({ error: problem })
  const key = `reauth:${req.seller.loginId}`
  if (!reserveAttempt(key, req.ip)) return res.status(429).json({ error: '비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.' })
  const { rows } = await pool.query('SELECT * FROM admins WHERE id = $1', [req.seller.id])
  const given = typeof req.body?.myPassword === 'string' ? req.body.myPassword.slice(0, 200) : ''
  if (!(await passwordMatches(given, rows[0]?.password_hash))) return res.status(401).json({ error: '지금 비밀번호가 맞지 않아요.' })
  undoAttempt(key, req.ip)
  if (await passwordMatches(req.body.password, rows[0].password_hash)) return res.status(400).json({ error: '지금 비밀번호와 다른 비밀번호로 정해 주세요.' })
  const updated = await pool.query('UPDATE admins SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING *', [rows[0].id, await hashPassword(req.body.password)])
  issueStaffSession(res, updated.rows[0])
  writeAccessLog({ loginId: req.seller.loginId, role: 'seller', action: 'password_change', ip: req.ip })
  res.json({ ok: true })
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
    'UPDATE sellers SET intro = $1, story = $2 WHERE seller_code = $3 RETURNING seller_code, name, region, intro, story, photos',
    [intro || null, story || null, mine(req)],
  )
  console.log(`[seller] ${req.seller.loginId} 농가 소개 수정`)
  res.json(rows[0])
})

// 농가 소개 사진 (2026-11-17): 올리면 바로 저장되고 농가 페이지 · 상품 상세 '판매 농가 이야기'에 보인다.
// 상품 사진과 같은 방식(server/admin.js saveOptimized)으로 줄여 WebP로 바꾸고, 사진 속 촬영 위치(GPS) 같은 정보는 지운다.
// 파일 이름은 farm-<농가코드>-<무작위>.webp (상품 사진과 섞이지 않게)
const MAX_FARM_PHOTOS = 4
const farmFileKey = (code) => `farm-${code}`
sellerRouter.post('/profile/photo', rawImage, async (req, res) => {
  const type = req.headers['content-type']
  if (!IMAGE_TYPES[type] || !Buffer.isBuffer(req.body) || req.body.length === 0 || !looksLike(type, req.body)) {
    return res.status(400).json({ error: '사진은 jpg, png, webp 파일만 올릴 수 있어요. (2MB 이하)' })
  }
  const code = mine(req)
  const current = await pool.query('SELECT photos FROM sellers WHERE seller_code = $1', [code])
  if ((current.rows[0]?.photos ?? []).length >= MAX_FARM_PHOTOS) return res.status(400).json({ error: `농가 사진은 ${MAX_FARM_PHOTOS}장까지 올릴 수 있어요. 하나를 빼고 올려 주세요.` })
  let url
  try {
    url = await saveOptimized(farmFileKey(code), req.body)
  } catch {
    return res.status(400).json({ error: '사진을 읽지 못했어요. 다른 사진으로 올려 주세요.' })
  }
  // 동시에 여러 장을 올려도 4장을 넘지 않게, 넣을 때 한 번 더 센다
  const { rows } = await pool.query(
    'UPDATE sellers SET photos = array_append(photos, $1) WHERE seller_code = $2 AND cardinality(photos) < $3 RETURNING photos',
    [url, code, MAX_FARM_PHOTOS],
  )
  if (!rows.length) {
    await deleteFiles(farmFileKey(code), url)
    return res.status(400).json({ error: `농가 사진은 ${MAX_FARM_PHOTOS}장까지 올릴 수 있어요.` })
  }
  clearCache() // 손님 화면(농가 페이지·상품 상세)에 바로 보이게
  console.log(`[seller] ${req.seller.loginId} 농가 사진 추가`)
  res.status(201).json({ photos: rows[0].photos })
})

sellerRouter.delete('/profile/photo', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : ''
  const code = mine(req)
  const { rows } = await pool.query(
    'UPDATE sellers SET photos = array_remove(photos, $1) WHERE seller_code = $2 AND $1 = ANY(photos) RETURNING photos',
    [url, code],
  )
  if (!rows.length) return res.status(404).json({ error: '그 사진을 찾지 못했어요.' })
  await deleteFiles(farmFileKey(code), url)
  clearCache()
  console.log(`[seller] ${req.seller.loginId} 농가 사진 빼기`)
  res.json({ photos: rows[0].photos })
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
    SELECT p.*, (p.stock = 0) AS sold_out, i.name AS item_name, i.category, ${ALL_OPTIONS_SQL},
           (SELECT count(*) FROM restock_requests r WHERE r.product_code = p.product_code AND r.notified_at IS NULL)::int AS restock_waiting
    FROM products p JOIN items i ON i.item_code = p.item_code
    WHERE p.seller_code = $1
    ORDER BY (p.status = 'draft' AND p.review_note IS NOT NULL) DESC, p.updated_at DESC`, [mine(req)])
  res.json(rows)
})

sellerRouter.post('/products', async (req, res) => {
  const body = { ...req.body, seller_code: mine(req), status: nextStatus(req.body.status, null), review_note: null }
  const { product, errors } = validateProduct(body, { ...(await codeSets()), isNew: true, itemRanges: await itemRanges() })
  if (errors) return res.status(400).json({ error: errors.join(' '), errors })
  const problem = product.status === 'pending' ? await noticeProblem(product) : null // 임시 저장은 비어 있어도 된다
  if (problem) return res.status(400).json({ error: problem, errors: [problem] })
  const checked = await checkOptions(null, product)
  if (checked.error) return res.status(400).json({ error: checked.error, errors: [checked.error] })
  const row = await insertProduct(product, `판매자 화면 등록 (${req.seller.loginId})`)
  if (!row) return res.status(409).json({ error: '같은 상품 코드가 이미 있어요. 다른 코드를 써 주세요.' })
  const saved = await saveOptions(product.product_code, product.options)
  console.log(`[seller] ${req.seller.loginId} 상품 등록 ${product.product_code} (${product.status})`)
  res.status(201).json(saved.product)
})

sellerRouter.patch('/products/:code', ownProduct, async (req, res) => {
  const current = req.product
  const status = nextStatus(req.body.status ?? current.status, current.status)
  // 다시 검토를 요청하면 반려 사유는 지운다. 그 밖에는 관리자가 남긴 사유를 그대로 둔다
  const reviewNote = status === 'pending' ? null : current.review_note
  const wasSelling = current.status === 'active' && status === 'active'
  const merged = { ...current, ...req.body, product_code: current.product_code, seller_code: mine(req), status, review_note: reviewNote }
  const { product, errors } = validateProduct(merged, { ...(await codeSets()), isNew: false, itemRanges: await itemRanges() })
  if (errors) return res.status(400).json({ error: errors.join(' '), errors })
  if (product.status === 'pending' || (product.status === 'active' && 'notice' in req.body)) {
    const problem = await noticeProblem(product)
    if (problem) return res.status(400).json({ error: problem, errors: [problem] })
  }
  const checked = await checkOptions(current.product_code, product)
  if (checked.error) return res.status(400).json({ error: checked.error, errors: [checked.error] })
  const needsReview = wasSelling && await contentChanged(current, product) // 옵션을 저장하기 전에 비교한다
  await recordChanges(current, product, `판매자 ${req.seller.loginId}`, checked.changes)
  await updateProduct(current.product_code, product)
  const saved = await saveOptions(current.product_code, product.options) // 옵션 저장, 상품 가격·재고를 옵션에 맞추기
  await deleteBlockImages(current, product.detail_blocks)
  let row = saved.product
  // 당도를 바꾸면 옛 당도계 사진은 새 값의 증거가 아니라서 내린다 (새 사진을 올리면 다시 붙는다)
  const brixOf = (v) => (v == null || v === '' ? null : Number(v)) // DB 의 "14.0" 과 화면의 "14" 는 같은 값
  // 품종을 바꾸면 적용되는 등급 기준도 달라지니, 당도를 바꿀 때처럼 사진부터 다시 받는다
  if ((brixOf(current.brix) !== brixOf(product.brix) || (current.variety ?? '') !== (product.variety ?? '')) && current.brix_photo_url) {
    row = { ...row, ...(await pool.query('UPDATE products SET brix_photo_url = NULL WHERE product_code = $1 RETURNING *', [current.product_code])).rows[0] }
  }
  let reviewNoteText = ''
  if (needsReview) {
    const { product: reviewed, reasons } = await sendBackToReview(row)
    row = { ...row, ...reviewed }
    reviewNoteText = reviewed.status === 'active' ? ' (상품 내용이 바뀌어 회사가 나중에 확인해요)' : ` (상품 내용이 바뀌어 회사가 확인한 뒤 다시 판매돼요: ${reasons.join(' / ')})`
  }
  console.log(`[seller] ${req.seller.loginId} 상품 수정 ${current.product_code} (${current.status} → ${row.status})`)
  res.json({ ...row, saved_note: `${stoppedNote(saved.stopped)}${reviewNoteText}` })
})

// 사진까지 올린 뒤 검토 요청: 믿을 만한 농가의 문제없는 상품은 바로 판매, 아니면 관리자 검토 대기 (이유를 돌려준다)
sellerRouter.post('/products/:code/submit', ownProduct, async (req, res) => {
  const problem = req.product.status === 'pending' ? await noticeProblem(req.product) : null
  if (problem) return res.status(400).json({ error: problem, errors: [problem] })
  const { product, reasons } = await submitProduct(req.product)
  console.log(`[seller] ${req.seller.loginId} 상품 ${product.product_code} ${product.status === 'active' ? '자동 승인' : '검토 대기'}`)
  res.json({ ...product, reasons })
})

sellerRouter.post('/products/:code/image', ownProduct, recheckPhotos, rawImage, storeImage)
sellerRouter.delete('/products/:code/image', ownProduct, recheckPhotos, removeImage)

// 판매자에게는 이름 첫 글자만 (회원은 실명이 들어가서, 2026-11-11 보안 점검)
const forSeller = (q) => ({ ...q, author: maskName(openQuestion(q).author) })

// 내 상품에 달린 질문 (연락처는 회사만 본다)
sellerRouter.get('/questions', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.id, q.product_code, q.author, q.question, q.answer, q.created_at, q.answered_at, q.is_private, p.name AS product_name
    FROM questions q JOIN products p ON p.product_code = q.product_code
    WHERE p.seller_code = $1 AND NOT q.hidden
    ORDER BY (q.answer IS NULL) DESC, q.created_at DESC`, [mine(req)])
  res.json(rows.map(forSeller))
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
     RETURNING q.id, q.product_code, q.author, q.question, q.answer, q.created_at, q.answered_at, q.is_private, p.name AS product_name`,
    [answer, req.params.id, mine(req)],
  )
  if (!rows.length) return res.status(404).json({ error: '내 상품 질문 중에서 찾지 못했어요.' })
  console.log(`[seller] ${req.seller.loginId} 질문 #${rows[0].id} 답변`)
  notifyAnswer(rows[0].id).catch((e) => console.error(`[qna] 답변 알림 실패 · ${e.message}`))
  res.json(forSeller(rows[0]))
})
