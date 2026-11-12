// 반품 신청과 환불 (2026-11-04)
// 손님(회원·비회원 주문 조회)이 배송 완료된 농가 배송에 사유와 함께 신청 → 관리자가 승인·거절 → 승인한 신청만 관리자가 금액을 확인하고 환불(토스 부분 취소)
// 신청만으로는 돈이 나가지 않는다. 판매자는 자기 농가 신청을 보고 의견만 남긴다 (환불은 못 한다)
// 신청 기간·환불 한도는 server/policy.js 의 RETURNS (화면의 교환·환불 정책 글과 같은 값). 한도는 서버가 주문 기록으로 계산한다
// 반품 상품의 재고는 돌려놓지 않는다 (신선식품은 다시 팔 수 있는지 사람이 봐야 해서) [가설: 회사가 정함]
import express from 'express'
import { requireCustomer } from './account.js'
import { requireAdmin, requireSeller } from './auth.js'
import { sealText } from './crypto.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { adminEmail, publicUrl, queueMail } from './mailer.js'
import { findMyOrder, inTransaction, loadOrder, maskOrderNo, publicOrder, runRefund, sendRefundResult, staffOrder } from './orders.js'
import { openOrder, openReturn } from './pii.js'
import { RETURNS, SHIPPING, SHOP } from './policy.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const won = (n) => `${n.toLocaleString('ko-KR')}원`
const plain = (name) => name.replace(/\[예시\]\s*/g, '')
const STATUS = { requested: '신청', approved: '승인', rejected: '거절', refunded: '환불 완료' }
const tooManyRequests = createLimiter({ limit: 10, windowMs: 10 * 60_000 })

// 환불 한도: 돌려줄 돈의 최대치 (실제 금액은 관리자가 확인해 정하고, 이보다 많이 돌려줄 수 없다)
//  - 단순 변심: 돌려보낼 상품 금액 − 돌려보내는 배송비 − (처음 배송이 무료였으면) 보낼 때 배송비. 처음 낸 배송비는 돌려주지 않는다
//  - 상품 하자·오배송: 돌려보낼 상품 금액 + 그 농가 배송에 손님이 낸 배송비
//  - 그 농가 배송에 낸 돈(상품 + 배송비)에서 이미 돌려준 돈, 주문 결제 금액에서 이미 돌려준 돈을 넘지 않는다
export function returnLimit(ret, shipment, refundedForFarm, refundedForOrder, totalAmount) {
  const items = ret.items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const byPolicy = ret.reason_type === 'change_mind'
    ? items - SHIPPING.fee - (shipment.shipping_fee === 0 ? SHIPPING.fee : 0)
    : items + shipment.shipping_fee
  return Math.max(0, Math.min(byPolicy, shipment.items_amount + shipment.shipping_fee - refundedForFarm, totalAmount - refundedForOrder))
}

async function limitOf(client, ret) {
  const { rows: [row] } = await client.query(
    `SELECT sh.items_amount, sh.shipping_fee, o.total_amount,
            (SELECT COALESCE(sum(amount), 0) FROM order_refunds WHERE order_id = o.id AND seller_code = sh.seller_code AND status = 'done')::int AS farm_done,
            (SELECT COALESCE(sum(amount), 0) FROM order_refunds WHERE order_id = o.id AND status = 'done')::int AS order_done
     FROM order_shipments sh JOIN orders o ON o.id = sh.order_id WHERE sh.order_id = $1 AND sh.seller_code = $2`,
    [ret.order_id, ret.seller_code],
  )
  return row ? returnLimit(ret, row, row.farm_done, row.order_done, row.total_amount) : 0
}

// ---------- 손님: 반품 신청 ----------
// lines: [{ line: 주문 상세의 상품 순서(0부터), quantity }]. 비우면 그 농가 상품 중 아직 반품하지 않은 것 모두
async function requestReturn(order, body, requestedBy) {
  const sellerCode = text(body.sellerCode)
  const reasonType = text(body.reasonType)
  const reason = text(body.reason)
  const errors = []
  if (!Object.hasOwn(RETURNS.reasons, reasonType)) errors.push('반품 사유 종류를 골라 주세요.')
  if (reason.length < 5 || reason.length > 500) errors.push('반품 사유를 5~500자로 적어 주세요.')
  const sensitive = findSensitive(reason)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (errors.length) return { status: 400, error: errors.join(' ') }
  const picked = Array.isArray(body.lines) ? body.lines.slice(0, 50) : []

  return inTransaction(async (client) => {
    // 같은 신청이 함께 와도 하나만 생기게 주문 줄을 잠근다 (진행 중 반품은 농가 배송마다 하나: order_returns_open_key)
    await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [order.id])
    const { rows: [sh] } = await client.query(
      `SELECT status, delivered_at,
              (now() AT TIME ZONE 'Asia/Seoul')::date <= (delivered_at AT TIME ZONE 'Asia/Seoul')::date + $3::int AS in_change_mind,
              (now() AT TIME ZONE 'Asia/Seoul')::date <= (delivered_at AT TIME ZONE 'Asia/Seoul')::date + make_interval(months => $4::int) AS in_defect
       FROM order_shipments WHERE order_id = $1 AND seller_code = $2`,
      [order.id, sellerCode, RETURNS.changeMindDays, RETURNS.defectMonths],
    )
    if (!sh) return { status: 404, error: '이 주문에 그 농가 상품이 없어요.' }
    if (sh.status !== 'delivered' || !sh.delivered_at) return { status: 409, error: '배송 완료된 상품만 반품을 신청할 수 있어요.' }
    if (reasonType === 'change_mind' && !sh.in_change_mind) {
      return { status: 409, error: `단순 변심 반품은 받은 날부터 ${RETURNS.changeMindDays}일 안에 신청할 수 있어요. 상품에 문제가 있으면 사유 종류를 바꿔 주세요.` }
    }
    if (reasonType !== 'change_mind' && !sh.in_defect) {
      return { status: 409, error: `상품 하자·오배송 반품은 받은 날부터 ${RETURNS.defectMonths}개월 안에 신청할 수 있어요. 그 뒤에 알게 된 문제는 고객센터(${SHOP.phone})로 알려 주세요.` }
    }
    const open = await client.query("SELECT 1 FROM order_returns WHERE order_id = $1 AND seller_code = $2 AND status IN ('requested', 'approved')", [order.id, sellerCode])
    if (open.rowCount) return { status: 409, error: '이 농가 상품은 이미 반품을 신청했어요. 진행 상태는 주문 상세에서 확인해 주세요.' }

    // 주문 상세의 상품 순서와 같게 (server/orders.js 의 loadOrder: ORDER BY oi.id)
    const { rows: lines } = await client.query('SELECT id, seller_code, name, option_name, unit, price, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [order.id])
    const { rows: earlier } = await client.query("SELECT items FROM order_returns WHERE order_id = $1 AND status <> 'rejected'", [order.id])
    const returned = new Map()
    for (const r of earlier) for (const i of r.items) returned.set(i.item_id, (returned.get(i.item_id) ?? 0) + i.quantity)
    const left = (l) => l.quantity - (returned.get(l.id) ?? 0)
    const chosen = []
    if (!picked.length) {
      for (const l of lines) if (l.seller_code === sellerCode && left(l) > 0) chosen.push({ line: l, quantity: left(l) })
    } else {
      for (const p of picked) {
        const l = lines[Number(p?.line)]
        const quantity = Number(p?.quantity)
        if (!l || l.seller_code !== sellerCode || !Number.isInteger(quantity) || quantity < 1 || chosen.some((c) => c.line.id === l.id)) {
          return { status: 400, error: '반품할 상품을 다시 골라 주세요.' }
        }
        if (quantity > left(l)) return { status: 409, error: `${plain(l.name)}: 반품할 수 있는 수량은 ${left(l)}개예요.` }
        chosen.push({ line: l, quantity })
      }
    }
    if (!chosen.length) return { status: 409, error: '이 농가 상품은 모두 반품을 신청했어요.' }
    const items = chosen.map(({ line, quantity }) => ({ item_id: line.id, name: line.name, option_name: line.option_name, unit: line.unit, price: line.price, quantity }))
    const { rows: [saved] } = await client.query(
      `INSERT INTO order_returns (order_id, seller_code, reason_type, reason, items, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [order.id, sellerCode, reasonType, sealText(reason), JSON.stringify(items), requestedBy],
    )
    console.log(`[return] 반품 신청 #${saved.id} ${order.order_no} ${sellerCode} · ${reasonType}`)
    return { status: 201, id: saved.id, items }
  })
}

function returnLines(items) {
  return items.map((i) => `- ${plain(i.name)}${i.option_name ? ` (${i.option_name})` : ''} × ${i.quantity}`).join('\n')
}

// 손님 알림 메일 (주문 때 남긴 이메일·회원 이메일). 처리한 계정은 넣지 않는다
async function notifyReturn(orderNo, event, ret, extra = {}) {
  try {
    const order = await loadOrder(orderNo)
    if (!order) return
    const farm = plain(order.shipments.find((s) => s.seller_code === ret.seller_code)?.seller_name ?? '')
    const head = `주문번호: ${order.order_no}\n${farm ? `농가: ${farm}\n` : ''}${returnLines(ret.items)}\n`
    const lookup = `주문 조회: ${publicUrl()}/order/lookup`
    const mails = {
      requested: [`[${SHOP.name}] 반품 신청을 받았어요 (${order.order_no})`,
        `${order.buyer_name}님, 반품 신청을 받았어요. 담당자가 확인한 뒤 결과를 알려 드려요. 신청만으로 환불되지는 않아요.\n\n${head}\n${lookup}\n`],
      approved: [`[${SHOP.name}] 반품 신청이 승인됐어요 (${order.order_no})`,
        `${order.buyer_name}님, 반품 신청이 승인됐어요. 돌려받은 상품을 확인한 뒤 환불해 드려요.${extra.note ? `\n안내: ${extra.note}` : ''}\n\n${head}\n${lookup}\n`],
      rejected: [`[${SHOP.name}] 반품 신청 결과를 알려 드려요 (${order.order_no})`,
        `${order.buyer_name}님, 이번 반품 신청은 받아들이기 어려워요.\n사유: ${extra.note}\n\n${head}\n문의: ${SHOP.phone}, ${SHOP.email}\n`],
      refunded: [`[${SHOP.name}] 반품 환불을 마쳤어요 (${order.order_no})`,
        `${order.buyer_name}님, 반품한 상품의 결제 ${won(extra.amount ?? 0)}을 취소했어요. 카드사에 따라 환불까지 며칠 걸릴 수 있어요.\n\n${head}\n${lookup}\n`],
    }
    const [subject, body] = mails[event]
    queueMail({ kind: `return_${event}`, to: order.buyer_email, subject, body })
    if (event === 'requested' && adminEmail()) {
      queueMail({ kind: 'admin_return_requested', to: adminEmail(), subject: `[반품 신청] ${order.order_no}${farm ? ` · ${farm}` : ''}`,
        body: `반품 신청이 들어왔어요.\n\n${head}\n관리자 화면: ${publicUrl()}/admin\n` })
    }
  } catch (error) {
    console.error(`[return] 알림 메일 준비 실패 ${orderNo} · ${error.message}`)
  }
}

async function answerRequest(res, order, body, requestedBy) {
  const done = await requestReturn(order, body, requestedBy)
  if (done.error) return res.status(done.status).json({ error: done.error })
  notifyReturn(order.order_no, 'requested', { seller_code: text(body.sellerCode), items: done.items })
  res.status(201).json(publicOrder(await loadOrder(order.order_no)))
}

// 비회원: 주문번호 + 주문자 휴대폰이 맞아야 한다 (주문 조회와 같은 확인)
export const publicReturnRouter = express.Router()
publicReturnRouter.post('/orders/lookup/returns', async (req, res) => {
  if (tooManyRequests(req)) return res.status(429).json({ error: '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.' })
  const order = await findMyOrder(req)
  if (!order) return res.status(404).json({ error: '주문을 찾지 못했어요.' })
  await answerRequest(res, order, req.body, '손님(비회원 주문 조회)')
})

// 회원: 내 주문만
export const memberReturnRouter = express.Router()
memberReturnRouter.post('/:orderNo/returns', requireCustomer, async (req, res) => {
  const order = await loadOrder(req.params.orderNo)
  if (!order || order.customer_id !== req.customer.id || ['pending', 'failed', 'expired'].includes(order.status)) {
    return res.status(404).json({ error: '내 주문 중에서 찾지 못했어요.' })
  }
  await answerRequest(res, order, req.body, `회원 #${req.customer.id}`)
})

// ---------- 관리자: 승인·거절·환불 ----------
export const adminReturnRouter = express.Router()
adminReturnRouter.use(requireAdmin)

const LIST_SQL = `
  SELECT r.*, o.order_no, o.buyer_name, o.total_amount, s.name AS seller_name, sh.delivered_at, sh.items_amount, sh.shipping_fee,
         (SELECT amount FROM order_refunds x WHERE x.return_id = r.id AND x.status = 'requested' LIMIT 1) AS refund_pending
  FROM order_returns r JOIN orders o ON o.id = r.order_id JOIN sellers s ON s.seller_code = r.seller_code
  LEFT JOIN order_shipments sh ON sh.order_id = r.order_id AND sh.seller_code = r.seller_code`

adminReturnRouter.get('/', async (req, res) => {
  const status = text(req.query.status)
  const params = STATUS[status] ? [status] : []
  const { rows } = await pool.query(`${LIST_SQL} ${params.length ? 'WHERE r.status = $1' : ''} ORDER BY r.created_at DESC LIMIT 200`, params)
  const list = []
  for (const row of rows) {
    const opened = openReturn({ ...row, buyer_name: openOrder({ buyer_name: row.buyer_name }).buyer_name })
    list.push({ ...opened, refund_limit: ['approved', 'requested'].includes(row.status) ? await limitOf(pool, row) : null })
  }
  res.json(list)
})

// 승인(신청 → 승인)과 거절(신청·승인 → 거절). 이미 그 상태면 그대로 둔다 (두 번 눌러도 메일은 한 번)
async function decide(id, next, note, by) {
  const found = await pool.query('SELECT o.order_no FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE r.id = $1', [id])
  if (!found.rowCount) return { status: 404, error: '반품 신청을 찾지 못했어요.' }
  return inTransaction(async (client) => {
    // 환불과 같은 순서로 잠근다: 주문 줄 → 반품 신청
    await client.query('SELECT 1 FROM orders WHERE order_no = $1 FOR UPDATE', [found.rows[0].order_no])
    const { rows: [ret] } = await client.query('SELECT * FROM order_returns WHERE id = $1 FOR UPDATE', [id])
    const result = { status: 200, orderNo: found.rows[0].order_no, ret }
    if (ret.status === next) return { ...result, unchanged: true }
    const from = next === 'approved' ? ['requested'] : ['requested', 'approved']
    if (!from.includes(ret.status)) return { status: 409, error: `${STATUS[ret.status]} 상태라 ${STATUS[next]}할 수 없어요.` }
    const pending = await client.query("SELECT 1 FROM order_refunds WHERE return_id = $1 AND status = 'requested'", [id])
    if (pending.rowCount) return { status: 409, error: '환불 결과를 확인하고 있어요. [환불]을 다시 눌러 결과를 먼저 확인해 주세요.' }
    await client.query(
      'UPDATE order_returns SET status = $2, admin_note = $3, decided_by = $4, decided_at = now(), updated_at = now() WHERE id = $1',
      [id, next, note || null, by],
    )
    console.log(`[return] ${by} 반품 #${id} → ${next}`)
    return result
  })
}

const readId = (value) => (/^\d{1,9}$/.test(value) ? Number(value) : null)

adminReturnRouter.post('/:id/approve', async (req, res) => {
  const id = readId(req.params.id)
  if (!id) return res.status(404).json({ error: '반품 신청을 찾지 못했어요.' })
  const note = text(req.body.note).slice(0, 300)
  const done = await decide(id, 'approved', note, `관리자 ${req.admin.loginId}`)
  if (done.error) return res.status(done.status).json({ error: done.error })
  if (!done.unchanged) notifyReturn(done.orderNo, 'approved', done.ret, { note })
  res.json(staffOrder(await loadOrder(done.orderNo)))
})

adminReturnRouter.post('/:id/reject', async (req, res) => {
  const id = readId(req.params.id)
  if (!id) return res.status(404).json({ error: '반품 신청을 찾지 못했어요.' })
  const note = text(req.body.note).slice(0, 300)
  if (note.length < 2) return res.status(400).json({ error: '거절 사유를 적어 주세요. (손님에게 보여요)' })
  const done = await decide(id, 'rejected', note, `관리자 ${req.admin.loginId}`)
  if (done.error) return res.status(done.status).json({ error: done.error })
  if (!done.unchanged) notifyReturn(done.orderNo, 'rejected', done.ret, { note })
  res.json(staffOrder(await loadOrder(done.orderNo)))
})

// 환불: 승인한 신청만, 관리자가 확인한 금액(amount)으로. 금액은 서버가 계산한 한도를 넘지 못하고, 한 신청에 한 번만 돌려준다.
// 결과를 모르면 202 → 같은 금액으로 다시 누르면 같은 멱등키로 확인한다
adminReturnRouter.post('/:id/refund', async (req, res) => {
  const id = readId(req.params.id)
  const amount = Number(req.body.amount)
  if (!id) return res.status(404).json({ error: '반품 신청을 찾지 못했어요.' })
  if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: '돌려줄 금액을 원 단위 숫자로 넣어 주세요.' })
  const found = await pool.query('SELECT o.order_no FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE r.id = $1', [id])
  if (!found.rowCount) return res.status(404).json({ error: '반품 신청을 찾지 못했어요.' })
  const orderNo = found.rows[0].order_no
  const by = `관리자 ${req.admin.loginId}`
  let ret = null
  const done = await runRefund(orderNo, by, async (client, order) => {
    ;({ rows: [ret] } = await client.query('SELECT * FROM order_returns WHERE id = $1 AND order_id = $2 FOR UPDATE', [id, order.id]))
    if (!ret) return { status: 404, error: '반품 신청을 찾지 못했어요.' }
    if (ret.status === 'refunded') return { status: 200, already: true }
    if (ret.status !== 'approved') return { status: 409, error: '승인한 반품 신청만 환불할 수 있어요.' }
    const limit = await limitOf(client, ret)
    if (amount > limit) return { status: 400, error: `환불 한도 ${won(limit)}를 넘어요. 주문 기록과 교환·환불 정책으로 계산한 금액이에요.` }
    return { kind: 'return', sellerCode: ret.seller_code, returnId: ret.id, amount, reason: `반품 환불 (${RETURNS.reasons[ret.reason_type]})` }
  }, async (client, order, refund) => {
    await client.query(
      "UPDATE order_returns SET status = 'refunded', refund_amount = $2, refunded_by = $3, refunded_at = now(), updated_at = now() WHERE id = $1",
      [id, refund.amount, by],
    )
  })
  if (done.done) notifyReturn(orderNo, 'refunded', ret, { amount: done.refund.amount })
  sendRefundResult(res, done, async () => res.json(staffOrder(await loadOrder(orderNo))))
})

// ---------- 판매자: 내 농가 반품 보기·의견 ----------
export const sellerReturnRouter = express.Router()
sellerReturnRouter.use(requireSeller)

sellerReturnRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, o.order_no, r.status, r.reason_type, r.reason, r.items, r.seller_note, r.seller_noted_at, r.admin_note, r.refund_amount,
            r.created_at, r.decided_at, r.refunded_at, sh.delivered_at
     FROM order_returns r JOIN orders o ON o.id = r.order_id
     LEFT JOIN order_shipments sh ON sh.order_id = r.order_id AND sh.seller_code = r.seller_code
     WHERE r.seller_code = $1 ORDER BY r.created_at DESC LIMIT 200`,
    [req.seller.sellerCode],
  )
  // 판매자에게는 주문번호를 가려서 보여 준다 (주문번호 + 받는 분 번호로 비회원 주문 조회를 하지 못하게, orders.js maskOrderNo)
  res.json(rows.map(openReturn).map(({ order_no: orderNo, ...r }) => ({ ...r, order_label: maskOrderNo(orderNo), items: r.items.map(({ item_id: _item, ...i }) => i) })))
})

sellerReturnRouter.patch('/:id', async (req, res) => {
  const id = readId(req.params.id)
  const note = text(req.body.note).slice(0, 500)
  if (!note) return res.status(400).json({ error: '의견을 적어 주세요.' })
  const sensitive = findSensitive(note)
  if (sensitive) return res.status(400).json({ error: SENSITIVE_MESSAGE(sensitive) })
  const { rowCount } = await pool.query(
    'UPDATE order_returns SET seller_note = $3, seller_noted_by = $4, seller_noted_at = now(), updated_at = now() WHERE id = $1 AND seller_code = $2',
    [id, req.seller.sellerCode, note, `판매자 ${req.seller.loginId}`],
  )
  if (!rowCount) return res.status(404).json({ error: '내 농가 반품 신청 중에서 찾지 못했어요.' })
  res.status(204).end()
})
