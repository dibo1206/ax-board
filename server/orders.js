// 7단계: 자체 주문·결제
// 1) 주문 만들기: 금액은 서버가 DB 가격으로 계산하고, 재고를 바로 잡아 둔다 (동시에 사도 초과 판매 없음)
// 2) 결제 승인: 토스가 돌려준 paymentKey·금액을 우리 주문과 맞춰 본 뒤 서버에서만 승인한다
// 3) 결제를 안 하고 30분이 지나면 주문을 만료하고 잡아 둔 재고를 돌려놓는다
import { randomBytes } from 'node:crypto'
import express from 'express'
import { currentCustomer, requireCustomer } from './account.js'
import { requireAdmin, requireSeller } from './auth.js'
import { COURIERS, trackingUrl } from './couriers.js'
import { pool } from './db.js'
import { createLimiter } from './limit.js'
import { cancelPayment, checkApproved, clientKey, confirmPayment, isTestPayment, lookupPayment, paymentMode } from './payments.js'
import { POLICIES, SHIPPING, SHOP, shippingFee } from './policy.js'
import { adminEmail, publicUrl, queueMail, retryMails } from './mailer.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'

const PENDING_MINUTES = 30
// 결제 전 주문은 재고를 잡아 두므로, 결제하지 않는 주문으로 재고를 묶어 두지 못하게 한도를 둔다
// (더 많이 필요하면 기업 구매 문의로)
export const MAX_QTY = 20 // 한 상품을 한 주문에
const MAX_TOTAL_QTY = 60 // 한 주문 전체
const MAX_PENDING_PER_PHONE = 3 // 결제 안 한 주문, 같은 휴대폰 번호로
const text = (v) => (typeof v === 'string' ? v.trim() : '')
const digits = (v) => text(v).replace(/[^0-9]/g, '')
const isMobile = (v) => /^01[016789]\d{7,8}$/.test(v)
const isPhone = (v) => /^0\d{8,10}$/.test(v)

// 주문번호: 날짜 + 추측할 수 없는 10글자 (토스 규칙: 영문·숫자·-·_ 6~64자)
function newOrderNo() {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', '').slice(2)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const random = [...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('')
  return `FM${day}-${random}`
}

async function restoreStock(client, orderId) {
  await client.query(
    `UPDATE products p SET stock = p.stock + oi.quantity, updated_at = now()
     FROM order_items oi WHERE oi.order_id = $1 AND p.product_code = oi.product_code`,
    [orderId],
  )
}

async function inTransaction(work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// 토스에 물어본 실제 결제 상태(found)로 결제 전 주문을 맞춘다. 돌려주는 값: 'paid' | 'closed'(실패·만료 처리) | 'wait'(아직 모름)
// 승인 응답을 못 받은 채 끊겼거나 서버가 중간에 죽었어도, 토스에서 승인된 주문은 여기서 결제 완료로 되살린다.
// closeAs 'failed'(승인 요청 직후): 결제가 아직 안 보이거나 진행 중이면 곧 승인될 수 있으니 닫지 않고 기다린다.
// closeAs 'expired'(30분 정리): 그때까지 승인되지 않은 결제는 토스에서도 끝난 것이라 닫는다.
const STILL_OPEN = ['READY', 'IN_PROGRESS']

async function settleWithToss(client, order, found, closeAs) {
  if (found) {
    try {
      const paid = checkApproved(found, { orderId: order.order_no, amount: order.total_amount })
      await client.query(
        `UPDATE orders SET status = 'paid', payment_key = $2, payment_method = $3, paid_at = $4, updated_at = now() WHERE id = $1`,
        [order.id, paid.paymentKey, paid.method, paid.approvedAt],
      )
      console.log(`[order] 결제 확인됨 ${order.order_no} (승인 응답 없이 조회로 확인)`)
      return 'paid'
    } catch (error) {
      if (closeAs === 'failed' && STILL_OPEN.includes(found.status)) return 'wait'
      // 승인은 됐는데 금액이 다르거나 지원하지 않는 결제 → 돈이 묶이지 않게 취소
      if (['DONE', 'WAITING_FOR_DEPOSIT'].includes(found.status)) {
        await cancelPayment({ paymentKey: found.paymentKey, orderId: order.order_no, reason: '주문 확인 실패로 자동 취소' })
          .catch((e) => console.error(`[order] ${order.order_no} 자동 취소 실패 — 직접 확인 필요 · ${e.message}`))
      }
      console.warn(`[order] ${order.order_no} 조회 결과로 닫음 · ${found.status} ${error.code ?? ''}`)
    }
  } else if (closeAs === 'failed') {
    return 'wait'
  }
  await restoreStock(client, order.id)
  await client.query(`UPDATE orders SET status = $2, fail_reason = COALESCE(fail_reason, $3), updated_at = now() WHERE id = $1`,
    [order.id, closeAs, found ? `결제 상태 ${found.status}` : '결제 없음'])
  return 'closed'
}

// 결제하지 않고 30분이 지난 주문 → 토스에 실제로 결제됐는지 물어보고, 결제가 없으면 만료·재고 복구
// 토스에 물어볼 수 없으면(통신 장애) 이번에는 건너뛰고 다음 정리 때 다시 본다 — 결제된 주문을 잘못 만료시키지 않기 위해
export async function expirePending() {
  const { rows } = await pool.query(
    `SELECT id, order_no, created_at FROM orders WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1)`,
    [PENDING_MINUTES],
  )
  let closed = 0
  let revived = 0
  for (const row of rows) {
    let found = null
    try {
      found = await lookupPayment(row.order_no)
    } catch (error) {
      const hours = (Date.now() - new Date(row.created_at)) / 3_600_000
      console.warn(`[order] ${row.order_no} 결제 조회 실패, 다음에 다시 확인 · ${error.code ?? error.message}${hours > 24 ? ' — 하루 넘게 확인 못 함, 직접 확인 필요' : ''}`)
      continue
    }
    const result = await inTransaction(async (client) => {
      const locked = await client.query("SELECT * FROM orders WHERE id = $1 AND status = 'pending' FOR UPDATE", [row.id])
      if (!locked.rowCount) return 'gone'
      return settleWithToss(client, locked.rows[0], found, 'expired')
    })
    if (result === 'paid') {
      revived += 1
      notifyOrder(row.order_no, 'paid')
    }
    if (result === 'closed') closed += 1
  }
  if (closed || revived) console.log(`[order] 결제 안 된 주문 정리: 만료 ${closed}건, 결제 확인으로 되살림 ${revived}건`)
}

// 5분마다: 결제 안 된 주문 정리 + 못 보낸 메일 다시 보내기
export function startOrderSweeper() {
  setInterval(() => {
    expirePending().catch((e) => console.error(`[order] 만료 처리 실패 · ${e.message}`))
    retryMails().catch((e) => console.error(`[mail] 다시 보내기 실패 · ${e.message}`))
  }, 5 * 60_000).unref()
}

async function loadOrder(orderNo, client = pool) {
  const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1', [orderNo])
  if (!rows.length) return null
  const items = await client.query(
    `SELECT oi.product_code, oi.seller_code, oi.name, oi.unit, oi.price, oi.quantity, oi.subtotal,
            EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = oi.order_id AND r.product_code = oi.product_code) AS reviewed
     FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.id`,
    [rows[0].id],
  )
  return { ...rows[0], items: items.rows }
}

// 손님에게 보여 줄 주문 (결제 키·내부 번호는 빼고)
function publicOrder(order) {
  const { id: _id, payment_key: _key, customer_id: _customer, ...rest } = order
  return { ...rest, tracking_url: trackingUrl(order.courier, order.tracking_no) }
}

// ---------- 손님용 ----------
export const publicOrderRouter = express.Router()
// 같은 곳(IP)에서 30분에 주문 6번. 개발 중에는 팀 모두가 같은 IP(SSH 터널)라 넉넉하게
const tooManyOrders = createLimiter({ limit: process.env.NODE_ENV === 'production' ? 6 : 30, windowMs: 30 * 60_000 })
const tooManyLookups = createLimiter({ limit: 10, windowMs: 10 * 60_000 })
const tooManyPayments = createLimiter({ limit: 20, windowMs: 10 * 60_000 })

publicOrderRouter.get('/policy', (req, res) => {
  res.json({ shop: SHOP, shipping: SHIPPING, policies: POLICIES, couriers: COURIERS, payment: { mode: paymentMode(), test: isTestPayment() } })
})

function readOrderInput(body) {
  const errors = []
  const merged = new Map()
  for (const item of Array.isArray(body.items) ? body.items.slice(0, 20) : []) {
    const code = text(item?.productCode)
    const quantity = Number(item?.quantity)
    if (!/^[a-z0-9_]{1,64}$/.test(code) || !Number.isInteger(quantity) || quantity < 1) {
      errors.push('주문 상품 정보가 올바르지 않아요.')
      break
    }
    merged.set(code, (merged.get(code) ?? 0) + quantity)
  }
  if (!merged.size && !errors.length) errors.push('주문할 상품이 없어요.')
  const total = [...merged.values()].reduce((sum, n) => sum + n, 0)
  if ([...merged.values()].some((n) => n > MAX_QTY) || total > MAX_TOTAL_QTY) {
    errors.push(`한 번에 상품마다 ${MAX_QTY}개, 모두 합쳐 ${MAX_TOTAL_QTY}개까지 주문할 수 있어요. 더 많이 필요하면 상품 페이지의 [기업 구매 문의]를 이용해 주세요.`)
  }
  const input = {
    buyerName: text(body.buyerName),
    buyerPhone: digits(body.buyerPhone),
    receiverName: text(body.receiverName),
    receiverPhone: digits(body.receiverPhone),
    zipcode: text(body.zipcode),
    address1: text(body.address1),
    address2: text(body.address2),
    memo: text(body.memo),
    email: text(body.email).toLowerCase(),
  }
  if (!input.buyerName || input.buyerName.length > 20) errors.push('주문자 이름을 20자 안으로 적어 주세요.')
  if (!isMobile(input.buyerPhone)) errors.push('주문자 휴대폰 번호를 확인해 주세요. (주문 조회에 써요)')
  if (!input.receiverName || input.receiverName.length > 20) errors.push('받는 분 이름을 20자 안으로 적어 주세요.')
  if (!isPhone(input.receiverPhone)) errors.push('받는 분 연락처를 확인해 주세요.')
  if (!/^\d{5}$/.test(input.zipcode)) errors.push('우편번호 5자리를 넣어 주세요.')
  if (!input.address1 || input.address1.length > 100) errors.push('주소를 넣어 주세요.')
  if (input.address2.length > 60) errors.push('상세 주소는 60자 안으로 적어 주세요.')
  if (input.memo.length > 100) errors.push('배송 메모는 100자 안으로 적어 주세요.')
  if (input.email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(input.email)) errors.push('알림 받을 이메일을 확인해 주세요.')
  const sensitive = findSensitive(input.buyerName, input.receiverName, input.address1, input.address2, input.memo)
  if (sensitive) errors.push(SENSITIVE_MESSAGE(sensitive))
  if (body.agreeTerms !== true || body.agreePrivacy !== true) errors.push('구매 조건 확인과 개인정보 수집·이용에 동의해 주세요.')
  return { input, items: [...merged].map(([productCode, quantity]) => ({ productCode, quantity })), errors }
}

publicOrderRouter.post('/orders', async (req, res) => {
  if (paymentMode() === 'off') return res.status(503).json({ error: '지금은 주문을 받을 수 없어요. 잠시 후 다시 시도해 주세요.' })
  const { input, items, errors } = readOrderInput(req.body)
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooManyOrders(req)) return res.status(429).json({ error: '주문 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  await expirePending()
  const { rows: [{ n: pending }] } = await pool.query(
    "SELECT count(*)::int AS n FROM orders WHERE buyer_phone = $1 AND status = 'pending' AND created_at > now() - make_interval(mins => $2)",
    [input.buyerPhone, PENDING_MINUTES],
  )
  if (pending >= MAX_PENDING_PER_PHONE) {
    return res.status(429).json({ error: `결제하지 않은 주문이 이미 ${pending}건 있어요. 먼저 결제하거나 ${PENDING_MINUTES}분 뒤에 다시 주문해 주세요.` })
  }
  const customer = await currentCustomer(req) // 로그인한 회원이면 주문을 계정에 묶는다

  try {
    const order = await inTransaction(async (client) => {
      const lines = []
      for (const { productCode, quantity } of items) {
        // 판매 중이고 재고가 충분할 때만 재고를 줄인다. 가격은 이 순간의 DB 가격
        const { rows } = await client.query(
          `UPDATE products SET stock = stock - $2, updated_at = now()
           WHERE product_code = $1 AND status = 'active' AND stock >= $2
           RETURNING product_code, seller_code, name, unit, price`,
          [productCode, quantity],
        )
        if (!rows.length) {
          const found = await client.query('SELECT name, stock FROM products WHERE product_code = $1 AND status = $2', [productCode, 'active'])
          const reason = found.rowCount ? `${found.rows[0].name}: 재고가 ${found.rows[0].stock}개 남았어요.` : '판매하지 않는 상품이 들어 있어요.'
          throw Object.assign(new Error(reason), { status: 409 })
        }
        lines.push({ ...rows[0], quantity, subtotal: rows[0].price * quantity })
      }
      const itemsAmount = lines.reduce((sum, l) => sum + l.subtotal, 0)
      const fee = shippingFee(itemsAmount)
      const orderNo = newOrderNo()
      const { rows } = await client.query(
        `INSERT INTO orders (order_no, buyer_name, buyer_phone, receiver_name, receiver_phone, zipcode, address1, address2, memo,
                             items_amount, shipping_fee, total_amount, is_test, agreed_at, customer_id, buyer_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $15) RETURNING id`,
        [orderNo, input.buyerName, input.buyerPhone, input.receiverName, input.receiverPhone, input.zipcode, input.address1,
          input.address2 || null, input.memo || null, itemsAmount, fee, itemsAmount + fee, isTestPayment(),
          customer?.id ?? null, customer?.email ?? (input.email || null)],
      )
      for (const l of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_code, seller_code, name, unit, price, quantity, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [rows[0].id, l.product_code, l.seller_code, l.name, l.unit, l.price, l.quantity, l.subtotal],
        )
      }
      const first = lines[0].name.replace(/\[예시\]\s*/g, '')
      return {
        orderNo,
        orderName: (lines.length > 1 ? `${first} 외 ${lines.length - 1}건` : first).slice(0, 100),
        itemsAmount,
        shippingFee: fee,
        amount: itemsAmount + fee,
      }
    })
    console.log(`[order] 주문 생성 ${order.orderNo} · ${order.amount}원${customer ? ' · 회원' : ''}`)
    if (customer && req.body.saveAddress === true) {
      // 회원이 '배송지 저장'을 골랐으면 받는 분 주소를 회원 정보에 저장
      await pool.query('UPDATE customers SET zipcode = $2, address1 = $3, address2 = $4 WHERE id = $1',
        [customer.id, input.zipcode, input.address1, input.address2 || null])
    }
    res.status(201).json({ ...order, payment: { mode: paymentMode(), clientKey: clientKey(), test: isTestPayment() } })
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message })
    throw error
  }
})

// 결제 승인 (결제창에서 successUrl로 돌아온 화면이 부른다). 여러 번 불려도 한 번만 승인된다
publicOrderRouter.post('/orders/:orderNo/confirm', async (req, res) => {
  if (tooManyPayments(req)) return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  const paymentKey = text(req.body.paymentKey).slice(0, 200)
  const amount = Number(req.body.amount)
  if (!paymentKey || !Number.isInteger(amount)) return res.status(400).json({ error: '결제 정보가 올바르지 않아요.' })

  const result = await inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [req.params.orderNo])
    const order = rows[0]
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    if (order.status === 'paid' && order.payment_key === paymentKey) return { status: 200 } // 새로고침 등으로 다시 불림
    if (order.status !== 'pending') {
      const why = { expired: '결제 시간(30분)이 지나 주문이 만료됐어요. 다시 주문해 주세요.', failed: '이미 실패 처리된 주문이에요. 다시 주문해 주세요.' }
      return { status: 409, error: why[order.status] ?? '이미 처리된 주문이에요.' }
    }
    // 금액 조작 확인: 결제창에서 돌아온 금액이 서버가 계산한 금액과 같아야 한다
    if (amount !== order.total_amount) {
      await restoreStock(client, order.id)
      await client.query("UPDATE orders SET status = 'failed', fail_reason = $2, updated_at = now() WHERE id = $1", [order.id, '결제 금액 불일치'])
      console.warn(`[order] ${order.order_no} 결제 금액 불일치 (요청 ${amount} / 주문 ${order.total_amount})`)
      return { status: 400, error: '결제 금액이 주문 금액과 달라요. 다시 주문해 주세요.' }
    }
    try {
      const paid = await confirmPayment({ paymentKey, orderId: order.order_no, amount })
      await client.query(
        `UPDATE orders SET status = 'paid', payment_key = $2, payment_method = $3, paid_at = $4, updated_at = now() WHERE id = $1`,
        [order.id, paymentKey, paid.method, paid.approvedAt],
      )
      console.log(`[order] 결제 완료 ${order.order_no} · ${amount}원 · ${paid.method}`)
      return { status: 200, newlyPaid: true }
    } catch (error) {
      if (error.uncertain) {
        // 통신이 끊기거나 결제사가 일시 오류: 승인됐는지 모른다 → 실패로 처리하지 않고 결제 조회로 확인
        console.warn(`[order] ${order.order_no} 승인 결과를 모름 (${error.code ?? error.message}) → 결제 조회`)
        let found
        try {
          found = await lookupPayment(order.order_no)
        } catch {
          // 조회도 안 되면 주문은 결제 전으로 두고 손님에게 다시 확인하라고 한다 (30분 정리 때 다시 조회)
          return { status: 202, pending: true, error: '결제 확인이 늦어지고 있어요. 잠시 후 [다시 확인]을 눌러 주세요. 돈이 두 번 나가지는 않아요.' }
        }
        const result = await settleWithToss(client, order, found, 'failed')
        if (result === 'paid') return { status: 200, newlyPaid: true }
        if (result === 'wait') return { status: 202, pending: true, error: '결제 확인이 늦어지고 있어요. 잠시 후 [다시 확인]을 눌러 주세요. 돈이 두 번 나가지는 않아요.' }
        return { status: 402, error: '결제가 승인되지 않았어요. 돈은 나가지 않았어요. 다시 주문해 주세요.' }
      }
      // 승인은 됐는데 정보가 다르거나 지원하지 않는 상태면 바로 취소해서 돈이 묶이지 않게 한다
      if (error.payment?.paymentKey) {
        await cancelPayment({ paymentKey: error.payment.paymentKey, orderId: order.order_no, reason: '주문 확인 실패로 자동 취소' })
          .catch((e) => console.error(`[order] ${order.order_no} 자동 취소 실패 — 직접 확인 필요 · ${e.message}`))
      }
      await restoreStock(client, order.id)
      await client.query("UPDATE orders SET status = 'failed', fail_reason = $2, updated_at = now() WHERE id = $1", [order.id, (error.code ?? error.message).slice(0, 100)])
      console.warn(`[order] 결제 승인 실패 ${order.order_no} · ${error.status ?? ''} ${error.code ?? ''}`)
      return { status: 402, error: error.code === 'UNSUPPORTED_STATUS' ? error.message : `결제를 완료하지 못했어요. ${error.message}` }
    }
  })
  if (result.error) return res.status(result.status).json({ error: result.error, pending: result.pending === true })
  if (result.newlyPaid) notifyOrder(req.params.orderNo, 'paid')
  res.json(publicOrder(await loadOrder(req.params.orderNo)))
})

// 결제창에서 취소하거나 실패해서 failUrl로 돌아왔을 때: 재고를 바로 돌려놓는다
publicOrderRouter.post('/orders/:orderNo/fail', async (req, res) => {
  if (tooManyPayments(req)) return res.status(429).json({ error: '요청이 너무 많아요.' })
  const reason = text(req.body.code || req.body.message).slice(0, 100) || '결제 취소'
  await inTransaction(async (client) => {
    const { rows } = await client.query("SELECT id FROM orders WHERE order_no = $1 AND status = 'pending' FOR UPDATE", [req.params.orderNo])
    if (!rows.length) return
    await restoreStock(client, rows[0].id)
    await client.query("UPDATE orders SET status = 'failed', fail_reason = $2, updated_at = now() WHERE id = $1", [rows[0].id, reason])
  })
  res.status(204).end()
})

// 비회원 주문 조회: 주문번호 + 주문자 휴대폰 번호가 둘 다 맞아야 한다
async function findMyOrder(req) {
  const orderNo = text(req.body.orderNo).toUpperCase()
  const phone = digits(req.body.phone)
  if (!/^FM\d{6}-[A-Z0-9]{10}$/.test(orderNo) || !phone) return null
  const order = await loadOrder(orderNo)
  return order && order.buyer_phone === phone && !['failed', 'expired'].includes(order.status) ? order : null
}

publicOrderRouter.post('/orders/lookup', async (req, res) => {
  if (tooManyLookups(req)) return res.status(429).json({ error: '조회가 너무 많아요. 10분 뒤에 다시 시도해 주세요.' })
  const order = await findMyOrder(req)
  if (!order) return res.status(404).json({ error: '주문을 찾지 못했어요. 주문번호와 휴대폰 번호를 확인해 주세요.' })
  res.json(publicOrder(order))
})

publicOrderRouter.post('/orders/lookup/cancel', async (req, res) => {
  if (tooManyLookups(req)) return res.status(429).json({ error: '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.' })
  const order = await findMyOrder(req)
  if (!order) return res.status(404).json({ error: '주문을 찾지 못했어요.' })
  if (order.status !== 'paid') return res.status(409).json({ error: '배송 준비가 시작된 주문은 고객센터로 취소를 요청해 주세요.' })
  const reason = text(req.body.reason).slice(0, 100) || '손님 요청'
  const done = await cancelOrder(order.order_no, `손님 취소: ${reason}`, ['paid'])
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(publicOrder(await loadOrder(order.order_no)))
})

// 결제 취소 + 재고 복구 (손님·회원·관리자 공통). allowed: 취소할 수 있는 상태
async function cancelOrder(orderNo, reason, allowed) {
  const result = await cancelOrderTx(orderNo, reason, allowed)
  if (result.status === 200) notifyOrder(orderNo, 'cancelled')
  return result
}

function cancelOrderTx(orderNo, reason, allowed) {
  return inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [orderNo])
    const order = rows[0]
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    if (!allowed.includes(order.status)) return { status: 409, error: '이 상태의 주문은 취소할 수 없어요. 배송이 시작됐다면 반품으로 처리해요.' }
    try {
      await cancelPayment({ paymentKey: order.payment_key, orderId: order.order_no, reason })
    } catch (error) {
      console.error(`[order] 결제 취소 실패 ${order.order_no} · ${error.status ?? ''} ${error.code ?? ''}`)
      return { status: 502, error: `결제 취소가 실패했어요. ${error.message}` }
    }
    await restoreStock(client, order.id)
    await client.query(
      "UPDATE orders SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1",
      [order.id, reason.slice(0, 200)],
    )
    console.log(`[order] 주문 취소 ${order.order_no}`)
    return { status: 200 }
  })
}

// ---------- 관리자용 ----------
export const adminOrderRouter = express.Router()
adminOrderRouter.use(requireAdmin)

const LIST_SQL = `
  SELECT o.order_no, o.status, o.buyer_name, o.receiver_name, o.total_amount, o.payment_method, o.is_test,
         o.created_at, o.paid_at, o.tracking_no,
         (SELECT string_agg(oi.name || ' ×' || oi.quantity, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id) AS summary
  FROM orders o`

adminOrderRouter.get('/', async (req, res) => {
  const status = text(req.query.status)
  const params = []
  let sql = `${LIST_SQL} WHERE o.status NOT IN ('pending', 'failed', 'expired')`
  if (status) {
    params.push(status)
    sql = `${LIST_SQL} WHERE o.status = $1`
  }
  const { rows } = await pool.query(`${sql} ORDER BY o.created_at DESC LIMIT 200`, params)
  res.json(rows)
})

adminOrderRouter.get('/:orderNo', async (req, res) => {
  const order = await loadOrder(req.params.orderNo)
  if (!order) return res.status(404).json({ error: '주문을 찾지 못했어요.' })
  res.json(publicOrder(order))
})

// 배송 단계 바꾸기: 결제완료 → 배송준비 → 배송중(송장 필수) → 배송완료
const NEXT = { paid: 'preparing', preparing: 'shipping', shipping: 'delivered' }

async function advance(orderNo, body, who, onlySeller = null) {
  const result = await advanceTx(orderNo, body, who, onlySeller)
  if (result.status === 200 && body.status === 'shipping') notifyOrder(orderNo, 'shipping')
  return result
}

function advanceTx(orderNo, body, who, onlySeller) {
  const status = text(body.status)
  const courier = text(body.courier).slice(0, 30)
  const trackingNo = text(body.trackingNo).replace(/[^0-9A-Za-z-]/g, '').slice(0, 30)
  return inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [orderNo])
    const order = rows[0]
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    if (onlySeller) {
      const others = await client.query('SELECT 1 FROM order_items WHERE order_id = $1 AND seller_code <> $2', [order.id, onlySeller])
      if (others.rowCount) return { status: 403, error: '다른 농가 상품이 함께 있는 주문은 회사에서 배송 처리해요.' }
    }
    if (NEXT[order.status] !== status) return { status: 409, error: '지금 상태에서 그 단계로 바꿀 수 없어요.' }
    if (status === 'shipping' && (!courier || trackingNo.length < 6)) return { status: 400, error: '택배사와 송장 번호를 넣어 주세요.' }
    await client.query(
      `UPDATE orders SET status = $2, courier = COALESCE(NULLIF($3, ''), courier), tracking_no = COALESCE(NULLIF($4, ''), tracking_no), updated_at = now()
       WHERE id = $1`,
      [order.id, status, courier, trackingNo],
    )
    console.log(`[order] ${who} ${order.order_no} → ${status}`)
    return { status: 200 }
  })
}

adminOrderRouter.patch('/:orderNo', async (req, res) => {
  const done = await advance(req.params.orderNo, req.body, req.admin.loginId)
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(publicOrder(await loadOrder(req.params.orderNo)))
})

adminOrderRouter.post('/:orderNo/cancel', async (req, res) => {
  const reason = text(req.body.reason)
  if (reason.length < 2) return res.status(400).json({ error: '취소 사유를 적어 주세요.' })
  const done = await cancelOrder(req.params.orderNo, `관리자 취소(${req.admin.loginId}): ${reason}`, ['paid', 'preparing'])
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(publicOrder(await loadOrder(req.params.orderNo)))
})

// ---------- 판매자용: 내 농가 상품이 들어 있는 주문 ----------
export const sellerOrderRouter = express.Router()
sellerOrderRouter.use(requireSeller)

sellerOrderRouter.get('/', async (req, res) => {
  const seller = req.seller.sellerCode
  const { rows } = await pool.query(`
    SELECT o.id, o.order_no, o.status, o.created_at, o.paid_at, o.courier, o.tracking_no, o.memo, o.is_test,
           o.receiver_name, o.receiver_phone, o.zipcode, o.address1, o.address2,
           NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.seller_code <> $1) AS only_mine
    FROM orders o
    WHERE o.status IN ('paid', 'preparing', 'shipping', 'delivered', 'cancelled')
      AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.seller_code = $1)
    ORDER BY o.created_at DESC LIMIT 200`, [seller])
  const items = rows.length
    ? (await pool.query('SELECT order_id, name, unit, quantity, subtotal FROM order_items WHERE order_id = ANY($1) AND seller_code = $2 ORDER BY id',
        [rows.map((r) => r.id), seller])).rows
    : []
  // 받는 분 정보는 내가 배송해야 하는 주문(내 상품만 있고 아직 배송 전)에만 보여 준다
  res.json(rows.map(({ id, receiver_name, receiver_phone, zipcode, address1, address2, memo, ...o }) => {
    const shipper = o.only_mine && ['paid', 'preparing'].includes(o.status)
    return {
      ...o,
      items: items.filter((i) => i.order_id === id).map(({ order_id: _o, ...i }) => i),
      receiver: shipper ? { name: receiver_name, phone: receiver_phone, zipcode, address1, address2, memo } : null,
    }
  }))
})

sellerOrderRouter.patch('/:orderNo', async (req, res) => {
  const done = await advance(req.params.orderNo, req.body, req.seller.loginId, req.seller.sellerCode)
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.status(204).end()
})

// ---------- 주문 알림 메일 (손님: 주문 때 남긴 이메일·회원 이메일 / 관리자: ADMIN_EMAIL) ----------
async function notifyOrder(orderNo, event) {
  try {
    const order = await loadOrder(orderNo)
    if (!order) return
    const lines = order.items.map((i) => `- ${i.name.replace(/\[예시\]\s*/g, '')} × ${i.quantity}  ${i.subtotal.toLocaleString('ko-KR')}원`).join('\n')
    const total = `합계 ${order.total_amount.toLocaleString('ko-KR')}원 (배송비 ${order.shipping_fee.toLocaleString('ko-KR')}원 포함)`
    const lookup = `${publicUrl()}/order/lookup`
    const mails = {
      paid: [`[${SHOP.name}] 주문이 완료됐어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문해 주셔서 고마워요.\n\n주문번호: ${order.order_no}\n${lines}\n${total}\n\n${SHIPPING.leadTime}.\n주문 조회: ${lookup}\n`],
      shipping: [`[${SHOP.name}] 상품을 보냈어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문하신 상품을 보냈어요.\n\n${order.courier} ${order.tracking_no}\n배송 조회: ${trackingUrl(order.courier, order.tracking_no)}\n\n${lines}\n`],
      cancelled: [`[${SHOP.name}] 주문이 취소됐어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문이 취소되어 결제를 취소했어요. 카드사에 따라 환불까지 며칠 걸릴 수 있어요.\n\n주문번호: ${order.order_no}\n${lines}\n${total}\n`],
    }
    const [subject, body] = mails[event]
    queueMail({ kind: `order_${event}`, to: order.buyer_email, subject, body })
    if (event === 'paid' && adminEmail()) {
      queueMail({ kind: 'admin_new_order', to: adminEmail(), subject: `[새 주문] ${order.order_no} · ${order.total_amount.toLocaleString('ko-KR')}원${order.is_test ? ' (테스트)' : ''}`,
        body: `새 주문이 들어왔어요.\n\n${lines}\n${total}\n받는 분: ${order.receiver_name}\n관리자 화면: ${publicUrl()}/admin\n` })
    }
  } catch (error) {
    console.error(`[order] 알림 메일 준비 실패 ${orderNo} · ${error.message}`)
  }
}

// ---------- 회원: 내 주문 상세·취소 ----------
export const memberOrderRouter = express.Router()
memberOrderRouter.use(requireCustomer)

async function myOrder(req, res) {
  const order = await loadOrder(req.params.orderNo)
  if (!order || order.customer_id !== req.customer.id || ['pending', 'failed', 'expired'].includes(order.status)) {
    res.status(404).json({ error: '내 주문 중에서 찾지 못했어요.' })
    return null
  }
  return order
}

memberOrderRouter.get('/:orderNo', async (req, res) => {
  const order = await myOrder(req, res)
  if (order) res.json(publicOrder(order))
})

memberOrderRouter.post('/:orderNo/cancel', async (req, res) => {
  const order = await myOrder(req, res)
  if (!order) return
  if (order.status !== 'paid') return res.status(409).json({ error: '배송 준비가 시작된 주문은 고객센터로 취소를 요청해 주세요.' })
  const done = await cancelOrder(order.order_no, `회원 취소: ${text(req.body.reason).slice(0, 100) || '손님 요청'}`, ['paid'])
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(publicOrder(await loadOrder(order.order_no)))
})

export { COURIERS }
