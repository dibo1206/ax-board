// 구매 후기: 배송 완료된 주문의 상품만 쓸 수 있다 (비회원은 주문번호+휴대폰, 회원은 계정으로 확인)
// 식품 표시·광고 규정 때문에 효능·건강 효과 표현은 후기에도 쓰지 않게 한다
import express from 'express'
import { currentCustomer } from './account.js'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'
import { maskName } from './inquiry.js'
import { createLimiter } from './limit.js'
import { ensureShipments } from './orders.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'
import { bannedMessage, findBanned } from './banned.js'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const PAGE = 10

export const reviewRouter = express.Router()
const tooMany = createLimiter({ limit: 10, windowMs: 60 * 60_000 })

reviewRouter.get('/products/:code/reviews', async (req, res) => {
  const page = Math.max(1, Math.min(100, Number(req.query.page) || 1))
  const [summary, rows] = await Promise.all([
    pool.query(`SELECT count(*)::int AS count, round(avg(rating)::numeric, 1)::float AS avg,
                       json_build_object('5', count(*) FILTER (WHERE rating = 5), '4', count(*) FILTER (WHERE rating = 4),
                         '3', count(*) FILTER (WHERE rating = 3), '2', count(*) FILTER (WHERE rating = 2), '1', count(*) FILTER (WHERE rating = 1)) AS dist
                FROM reviews WHERE product_code = $1 AND NOT hidden`, [req.params.code]),
    pool.query(`SELECT id, author, rating, content, reply, replied_at, created_at FROM reviews
                WHERE product_code = $1 AND NOT hidden ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.code, PAGE, (page - 1) * PAGE]),
  ])
  res.json({ ...summary.rows[0], page, items: rows.rows.map((r) => ({ ...r, author: maskName(r.author) })) })
})

reviewRouter.post('/reviews', async (req, res) => {
  const orderNo = text(req.body.orderNo).toUpperCase()
  const productCode = text(req.body.productCode)
  const phone = text(req.body.phone).replace(/[^0-9]/g, '')
  const rating = Number(req.body.rating)
  const content = text(req.body.content)
  // 상품 페이지의 당도·수확일 같은 정보와 맞았는지 (고르지 않으면 비움). '달랐어요'가 많으면 당도 표시를 내린다
  const infoMatch = ['yes', 'no'].includes(req.body.infoMatch) ? req.body.infoMatch : null
  const errors = []
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('별점을 1~5개 골라 주세요.')
  if (content.length < 10 || content.length > 1000) errors.push('후기는 10~1000자로 적어 주세요.')
  const effect = findBanned(content, ['효능'])
  if (effect.length) errors.push(`효능·건강 효과 표현(${effect.join(', ')})은 후기에 쓸 수 없어요. 맛·신선도·포장처럼 직접 느낀 점을 적어 주세요.`)
  const abuse = findBanned(content, ['욕설', '광고', '기타'])
  if (abuse.length) errors.push(`욕설·광고 같은 표현(${abuse.join(', ')})은 후기에 쓸 수 없어요.`)
  const sensitive = findSensitive(content)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooMany(req)) return res.status(429).json({ error: '후기를 너무 많이 남겼어요. 잠시 후 다시 시도해 주세요.' })

  const { rows } = await pool.query('SELECT * FROM orders WHERE order_no = $1', [orderNo])
  const order = rows[0]
  const customer = await currentCustomer(req)
  const mine = order && ((customer && order.customer_id === customer.id) || (phone && order.buyer_phone === phone))
  if (!mine) return res.status(404).json({ error: '주문을 찾지 못했어요. 주문번호와 휴대폰 번호를 확인해 주세요.' })
  const item = await pool.query('SELECT seller_code FROM order_items WHERE order_id = $1 AND product_code = $2', [order.id, productCode])
  if (!item.rowCount) return res.status(404).json({ error: '이 주문에 없는 상품이에요.' })
  // 농가마다 따로 보내니, 주문 전체가 아니라 그 상품을 보낸 농가의 배송이 끝났으면 후기를 쓸 수 있다
  await ensureShipments(order.id)
  const arrived = await pool.query("SELECT 1 FROM order_shipments WHERE order_id = $1 AND seller_code = $2 AND status = 'delivered'", [order.id, item.rows[0].seller_code])
  if (order.status !== 'delivered' && !arrived.rowCount) return res.status(409).json({ error: '배송이 끝난 상품에만 후기를 쓸 수 있어요.' })
  const inserted = await pool.query(
    `INSERT INTO reviews (order_id, product_code, customer_id, author, rating, content, info_match) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (order_id, product_code) DO NOTHING RETURNING id`,
    [order.id, productCode, customer?.id ?? null, order.buyer_name, rating, content, infoMatch],
  )
  if (!inserted.rowCount) return res.status(409).json({ error: '이 상품에는 이미 후기를 남겼어요.' })
  console.log(`[review] 후기 #${inserted.rows[0].id} ${productCode} ★${rating}`)
  res.status(201).json({ id: inserted.rows[0].id, message: '후기를 남겨 주셔서 고마워요.' })
})

// ---------- 관리자: 후기 숨기기·답글 ----------
export const adminReviewRouter = express.Router()
adminReviewRouter.use(requireAdmin)

adminReviewRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, p.name AS product_name, o.order_no FROM reviews r
    JOIN products p ON p.product_code = r.product_code JOIN orders o ON o.id = r.order_id
    ORDER BY (r.reply IS NULL AND NOT r.hidden) DESC, r.created_at DESC LIMIT 200`)
  res.json(rows)
})

adminReviewRouter.patch('/:id', async (req, res) => {
  if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: '후기를 찾지 못했어요.' })
  const hasReply = req.body.reply !== undefined
  const reply = text(req.body.reply)
  if (hasReply) {
    if (reply.length < 2 || reply.length > 1000) return res.status(400).json({ error: '답글을 2~1000자로 적어 주세요.' })
    const bad = findBanned(reply)
    if (bad.length) return res.status(400).json({ error: bannedMessage(bad) })
  }
  const hidden = typeof req.body.hidden === 'boolean' ? req.body.hidden : null
  if (!hasReply && hidden === null) return res.status(400).json({ error: '바꿀 내용이 없어요.' })
  const { rows } = await pool.query(
    `UPDATE reviews SET reply = CASE WHEN $1 THEN $2 ELSE reply END, replied_at = CASE WHEN $1 THEN now() ELSE replied_at END,
       hidden = COALESCE($3, hidden) WHERE id = $4 RETURNING *`,
    [hasReply, reply, hidden, req.params.id],
  )
  if (!rows.length) return res.status(404).json({ error: '후기를 찾지 못했어요.' })
  console.log(`[review] ${req.admin.loginId} 후기 #${rows[0].id} ${hasReply ? '답글' : hidden ? '숨김' : '다시 보임'}`)
  res.json(rows[0])
})
