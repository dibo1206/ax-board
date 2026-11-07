// 7단계: 자체 주문·결제
// 1) 주문 만들기: 금액은 서버가 DB 가격으로 계산하고, 재고를 바로 잡아 둔다 (동시에 사도 초과 판매 없음)
// 2) 결제 승인: 토스가 돌려준 paymentKey·금액을 우리 주문과 맞춰 본 뒤 서버에서만 승인한다
// 3) 결제를 안 하고 15분이 지나면 주문을 만료하고 잡아 둔 재고를 돌려놓는다
import { randomBytes } from 'node:crypto'
import express from 'express'
import { currentCustomer, requireCustomer } from './account.js'
import { requireAdmin, requireSeller, signToken, verifyToken } from './auth.js'
import { COURIERS, trackingUrl } from './couriers.js'
import { pool } from './db.js'
import { lookupHash, sealText } from './crypto.js'
import { createLimiter } from './limit.js'
import { cancelPartial, cancelPayment, checkApproved, clientKey, confirmPayment, isTestPayment, lookupPayment, orderingOpen, paymentMode } from './payments.js'
import { POLICIES, RETURNS, SHIPPING, SHOP, shippingFee } from './policy.js'
import { adminEmail, publicUrl, queueMail, retryMails } from './mailer.js'
import { sweepRestock } from './restock.js'
import { lockProducts, syncOptionTotals } from './options.js'
import { openOrder, openReturn } from './pii.js'
import { farmShipFrom, isPreorder, shipDateText } from './preorder.js'
import { findSensitive, SENSITIVE_MESSAGE } from './privacy.js'

const PENDING_MINUTES = 15
export const KOREA_TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"
// 결제 전 주문은 재고를 잡아 두므로, 결제하지 않는 주문으로 재고를 묶어 두지 못하게 한도를 둔다
// (더 많이 필요하면 기업 구매 문의로)
export const MAX_QTY = 20 // 한 상품(옵션 상품은 옵션마다)을 한 주문에
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

// 옵션을 고른 주문 줄은 그 옵션 재고를, 아니면 상품 재고를 돌려놓는다. 상품 줄을 먼저 잠그고(주문 만들 때와 같은 순서)
// 옵션 재고를 돌려놓은 뒤 옵션 상품의 가격·재고 합을 다시 맞춘다 (server/options.js)
// sellerCode 를 주면 그 농가 상품만 (농가별 부분 취소). 이미 취소한 농가 배송의 상품은 다시 돌려놓지 않는다
const RESTORE_LINES = `oi.order_id = $1 AND ($2::text IS NULL OR oi.seller_code = $2)
  AND NOT EXISTS (SELECT 1 FROM order_shipments sh WHERE sh.order_id = oi.order_id AND sh.seller_code = oi.seller_code AND sh.status = 'cancelled')`
async function restoreStock(client, orderId, sellerCode = null) {
  const { rows } = await client.query(`SELECT DISTINCT oi.product_code FROM order_items oi WHERE ${RESTORE_LINES}`, [orderId, sellerCode])
  const codes = rows.map((r) => r.product_code)
  await lockProducts(client, codes)
  await client.query(
    `UPDATE products p SET stock = p.stock + oi.quantity, updated_at = now()
     FROM order_items oi WHERE ${RESTORE_LINES} AND p.product_code = oi.product_code AND oi.option_id IS NULL`,
    [orderId, sellerCode],
  )
  await client.query(
    `UPDATE product_options o SET stock = o.stock + oi.quantity, updated_at = now()
     FROM order_items oi WHERE ${RESTORE_LINES} AND o.id = oi.option_id`,
    [orderId, sellerCode],
  )
  await syncOptionTotals(client, codes)
}

// ---------- 농가별 배송 ----------
// 농가마다 따로 택배를 보낸다: 배송비는 농가별로 (그 농가 상품이 무료 배송 기준 이상이면 그 농가는 무료)
export function farmShipping(lines) {
  const farms = new Map()
  for (const l of lines) farms.set(l.seller_code, (farms.get(l.seller_code) ?? 0) + l.subtotal)
  return [...farms].map(([sellerCode, itemsAmount]) => ({ sellerCode, itemsAmount, fee: shippingFee(itemsAmount) }))
}

// 농가별 배송이 없는 주문(이 기능 전에 만든 주문·시험용으로 직접 넣은 주문)은 주문 상품의 농가로 만든다.
// 그때 받은 배송비는 하나뿐이라 첫 농가에 모두 둔다. orderId 가 null 이면 모든 주문
const ENSURE_SHIPMENTS = `
  INSERT INTO order_shipments (order_id, seller_code, items_amount, shipping_fee, status, courier, tracking_no, delivered_at)
  SELECT o.id, f.seller_code, f.amount, CASE WHEN f.first THEN o.shipping_fee ELSE 0 END,
         CASE WHEN o.status IN ('paid', 'preparing', 'shipping', 'delivered', 'cancelled') THEN o.status ELSE 'paid' END,
         o.courier, o.tracking_no, o.delivered_at
  FROM orders o
  JOIN (SELECT order_id, seller_code, sum(subtotal)::int AS amount, min(id) = min(min(id)) OVER (PARTITION BY order_id) AS first
        FROM order_items GROUP BY order_id, seller_code) f ON f.order_id = o.id
  WHERE ($1::int IS NULL OR o.id = $1) AND NOT EXISTS (SELECT 1 FROM order_shipments x WHERE x.order_id = o.id)
  ON CONFLICT (order_id, seller_code) DO NOTHING`
export const ensureShipments = (orderId = null, client = pool) => client.query(ENSURE_SHIPMENTS, [orderId])

// 농가별 상태를 모아 주문 전체 상태를 정한다. 손님 알림·옛 화면을 위해 첫 송장을 주문에도 적어 둔다
async function syncOrderStatus(client, orderId) {
  const { rows } = await client.query("SELECT status FROM order_shipments WHERE order_id = $1 AND status <> 'cancelled'", [orderId])
  const s = rows.map((r) => r.status)
  const status = s.length && s.every((x) => x === 'delivered') ? 'delivered'
    : s.some((x) => x === 'shipping' || x === 'delivered') ? 'shipping'
      : s.some((x) => x === 'preparing') ? 'preparing' : 'paid'
  await client.query(
    `UPDATE orders o SET status = $2, updated_at = now(),
       delivered_at = CASE WHEN $2 = 'delivered' THEN COALESCE(o.delivered_at, now()) ELSE NULL END,
       courier = first.courier, tracking_no = first.tracking_no
     FROM (SELECT (SELECT courier FROM order_shipments WHERE order_id = $1 AND tracking_no IS NOT NULL ORDER BY id LIMIT 1) AS courier,
                  (SELECT tracking_no FROM order_shipments WHERE order_id = $1 AND tracking_no IS NOT NULL ORDER BY id LIMIT 1) AS tracking_no) first
     WHERE o.id = $1`,
    [orderId, status],
  )
  return status
}

export async function inTransaction(work) {
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
// closeAs 'expired'(만료 정리): 그때까지 승인되지 않은 결제는 토스에서도 끝난 것이라 닫는다.
const STILL_OPEN = ['READY', 'IN_PROGRESS']

async function settleWithToss(client, order, found, closeAs) {
  if (found) {
    try {
      const paid = checkApproved(found, { orderId: order.order_no, amount: order.total_amount })
      await client.query(
        `UPDATE orders SET status = 'paid', payment_key = $2, payment_method = $3, paid_at = $4, updated_at = now() WHERE id = $1`,
        [order.id, sealText(paid.paymentKey), paid.method, paid.approvedAt],
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

// 결제하지 않고 시간이 지난 주문 → 토스에 실제로 결제됐는지 물어보고, 결제가 없으면 만료·재고 복구
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
// 배송 완료 7일 뒤 자동 구매 확정 (판매자 정산 기준). 손님은 그 전에 직접 확정할 수 있다
export const CONFIRM_DAYS = 7
export async function autoConfirm() {
  const { rowCount } = await pool.query(
    `UPDATE orders SET confirmed_at = now() WHERE status = 'delivered' AND confirmed_at IS NULL
       AND COALESCE(delivered_at, updated_at) < now() - make_interval(days => $1)`,
    [CONFIRM_DAYS],
  )
  if (rowCount) console.log(`[order] 자동 구매 확정 ${rowCount}건`)
  return rowCount
}

export function startOrderSweeper() {
  setInterval(() => {
    expirePending().catch((e) => console.error(`[order] 만료 처리 실패 · ${e.message}`))
    autoConfirm().catch((e) => console.error(`[order] 구매 확정 실패 · ${e.message}`))
    retryMails().catch((e) => console.error(`[mail] 다시 보내기 실패 · ${e.message}`))
    sweepRestock().catch((e) => console.error(`[restock] 알림 실패 · ${e.message}`)) // 취소·만료로 돌아온 재고도 알림
  }, 5 * 60_000).unref()
}

export async function loadOrder(orderNo, client = pool) {
  const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1', [orderNo])
  if (!rows.length) return null
  const items = await client.query(
    `SELECT oi.product_code, oi.seller_code, oi.name, oi.option_name, oi.unit, oi.price, oi.quantity, oi.subtotal, oi.ship_from,
            EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = oi.order_id AND r.product_code = oi.product_code) AS reviewed
     FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.id`,
    [rows[0].id],
  )
  await ensureShipments(rows[0].id, client)
  // 반품 신청 마감일 (받은 날 = 배송 완료로 바뀐 한국 날짜, server/policy.js 의 RETURNS)
  const shipments = await client.query(
    `SELECT sh.seller_code, s.name AS seller_name, sh.items_amount, sh.shipping_fee, sh.status, sh.courier, sh.tracking_no, sh.shipped_at, sh.delivered_at, sh.ship_from,
            to_char((sh.delivered_at AT TIME ZONE 'Asia/Seoul')::date + $2::int, 'YYYY-MM-DD') AS return_until_change_mind,
            to_char((sh.delivered_at AT TIME ZONE 'Asia/Seoul')::date + make_interval(months => $3::int), 'YYYY-MM-DD') AS return_until_defect
     FROM order_shipments sh JOIN sellers s ON s.seller_code = sh.seller_code WHERE sh.order_id = $1 ORDER BY sh.id`,
    [rows[0].id, RETURNS.changeMindDays, RETURNS.defectMonths],
  )
  const refunds = await client.query('SELECT * FROM order_refunds WHERE order_id = $1 ORDER BY id', [rows[0].id])
  const returns = await client.query('SELECT * FROM order_returns WHERE order_id = $1 ORDER BY id', [rows[0].id])
  return { ...openOrder(rows[0]), items: items.rows, shipments: shipments.rows, refunds: refunds.rows, returns: returns.rows.map(openReturn) }
}

// 출고 안내: 예약 상품이 있는 농가는 그 날짜를, 나머지는 기본 안내(결제 후 1~3일). 주문 메일·주문 화면에서 쓴다
export function shippingNote(shipments = []) {
  const live = shipments.filter((s) => s.status !== 'cancelled')
  const later = live.filter((s) => isPreorder(s.ship_from))
  if (!later.length) return `${SHIPPING.leadTime}.`
  const farm = (s) => String(s.seller_name ?? '').replace(/\[예시\]\s*/g, '')
  return [
    ...later.map((s) => `${farm(s)} 상품은 예약 상품이라 ${shipDateText(s.ship_from)}부터 주문 순서대로 보내요.`),
    live.length > later.length ? `나머지 상품은 ${SHIPPING.leadTime}.` : '',
  ].filter(Boolean).join('\n')
}

// 손님에게 보여 줄 주문 (결제 키·내부 번호는 빼고). 농가 이름의 [예시] 표시는 뺀다
// 돌려준 돈과 반품은 손님이 알아야 할 것만 (처리한 계정·멱등키·판매자 의견·내부 번호는 빼고)
export function publicOrder(order) {
  const { id: _id, payment_key: _key, customer_id: _customer, buyer_phone_hash: _hash, refunds = [], returns = [], ...rest } = order
  const farmName = (code) => order.shipments?.find((s) => s.seller_code === code)?.seller_name.replace(/\[예시\]\s*/g, '') ?? null
  const done = refunds.filter((r) => r.status === 'done')
  return {
    ...rest,
    tracking_url: trackingUrl(order.courier, order.tracking_no),
    shipping_note: shippingNote(order.shipments),
    shipments: (order.shipments ?? []).map((s) => ({
      ...s, seller_name: s.seller_name.replace(/\[예시\]\s*/g, ''), tracking_url: trackingUrl(s.courier, s.tracking_no),
      cancel_pending: refunds.some((r) => r.kind === 'cancel' && r.seller_code === s.seller_code && r.status === 'requested'),
    })),
    refunded_amount: done.reduce((sum, r) => sum + r.amount, 0),
    refund_pending: refunds.some((r) => r.status === 'requested'),
    refunds: done.map((r) => ({ kind: r.kind, seller_name: farmName(r.seller_code), amount: r.amount, done_at: r.done_at })),
    returns: returns.map((r) => ({
      seller_code: r.seller_code, seller_name: farmName(r.seller_code), status: r.status, reason_type: r.reason_type, reason: r.reason,
      items: r.items.map(({ item_id: _item, ...i }) => i), admin_note: r.admin_note, refund_amount: r.refund_amount,
      created_at: r.created_at, decided_at: r.decided_at, refunded_at: r.refunded_at,
    })),
  }
}

// 판매자 화면용 주문번호: 날짜와 끝 4자리만 (FM261104-······AB12). 손님·회사와 말할 때 맞춰 보기엔 충분하고,
// 가린 6자리(32^6, 약 10억 가지)는 비회원 조회 횟수 제한 안에서 맞힐 수 없다
export const maskOrderNo = (no) => (typeof no === 'string' && no.length > 13 ? `${no.slice(0, 9)}······${no.slice(-4)}` : '')

// 관리자 화면용: 손님 화면 내용 + 돌려준 돈 기록 전부(누가 언제 얼마를, 결과 확인 중·실패 포함)와 반품 신청 번호·판매자 의견
export function staffOrder(order) {
  return { ...publicOrder(order), refunds: order.refunds, returns: order.returns }
}

// 결제 승인 응답: 주문번호와 결제키만 있으면 받을 수 있는 응답이라 이름·연락처·주소 같은 개인정보는 넣지 않는다.
// 받는 분·주소는 휴대폰 번호(또는 로그인)를 확인하는 [주문 조회]·마이페이지에서만 보여 준다
function paidSummary(order) {
  const full = publicOrder(order)
  const keep = ['order_no', 'status', 'is_test', 'created_at', 'paid_at', 'payment_method', 'items_amount', 'shipping_fee', 'total_amount', 'items', 'shipping_note']
  return {
    ...Object.fromEntries(keep.map((k) => [k, full[k]])),
    shipments: full.shipments.map(({ seller_code, seller_name, status, shipping_fee, ship_from }) => ({ seller_code, seller_name, status, shipping_fee, ship_from })),
  }
}

// 결제용 표: 주문을 만든 화면에만 준다. 결제창에서 실패·취소로 돌아왔을 때 이 표가 있어야 주문을 실패로 닫을 수 있다
// (주문번호만 아는 사람이 남의 결제 전 주문을 닫지 못하게)
const PAY_TOKEN_MINUTES = 60
const payTokenFor = (orderNo) => signToken({ kind: 'checkout', orderNo, exp: Date.now() + PAY_TOKEN_MINUTES * 60_000 })
const payTokenMatches = (token, orderNo) => {
  const payload = typeof token === 'string' ? verifyToken(token) : null
  return payload?.kind === 'checkout' && payload.orderNo === orderNo
}

// ---------- 손님용 ----------
export const publicOrderRouter = express.Router()
// 같은 곳(IP)에서 30분에 주문 6번. 개발 중에는 팀 모두가 같은 IP(SSH 터널)라 넉넉하게
const tooManyOrders = createLimiter({ limit: process.env.NODE_ENV === 'production' ? 6 : 30, windowMs: 30 * 60_000 })
// 번호를 바꿔 가며 결제하지 않는 주문으로 전 상품을 품절로 만들지 못하게, 같은 곳(IP)에서 재고를 잡는 수량에도 한도를 둔다 (주문 1건 최대치만큼)
const tooManyHeldUnits = createLimiter({ limit: process.env.NODE_ENV === 'production' ? MAX_TOTAL_QTY : MAX_TOTAL_QTY * 10, windowMs: PENDING_MINUTES * 60_000 })
const tooManyLookups = createLimiter({ limit: 10, windowMs: 10 * 60_000 })
const tooManyPayments = createLimiter({ limit: 20, windowMs: 10 * 60_000 })

publicOrderRouter.get('/policy', (req, res) => {
  res.json({ shop: SHOP, shipping: SHIPPING, returns: RETURNS, policies: POLICIES, couriers: COURIERS, payment: { mode: paymentMode(), test: isTestPayment() } })
})

function readOrderInput(body) {
  const errors = []
  const merged = new Map() // '상품코드:옵션번호' → { productCode, optionId, quantity }
  for (const item of Array.isArray(body.items) ? body.items.slice(0, 20) : []) {
    const code = text(item?.productCode)
    const quantity = Number(item?.quantity)
    const optionId = item?.optionId == null || item.optionId === '' ? null : Number(item.optionId) // 옵션 상품이면 고른 옵션
    if (!/^[a-z0-9_]{1,64}$/.test(code) || !Number.isInteger(quantity) || quantity < 1
      || (optionId !== null && (!Number.isInteger(optionId) || optionId < 1 || optionId > 2_147_483_647))) {
      errors.push('주문 상품 정보가 올바르지 않아요.')
      break
    }
    const key = `${code}:${optionId ?? ''}`
    merged.set(key, { productCode: code, optionId, quantity: (merged.get(key)?.quantity ?? 0) + quantity })
  }
  if (!merged.size && !errors.length) errors.push('주문할 상품이 없어요.')
  const total = [...merged.values()].reduce((sum, l) => sum + l.quantity, 0)
  if ([...merged.values()].some((l) => l.quantity > MAX_QTY) || total > MAX_TOTAL_QTY) {
    errors.push(`한 번에 상품(옵션)마다 ${MAX_QTY}개, 모두 합쳐 ${MAX_TOTAL_QTY}개까지 주문할 수 있어요. 더 많이 필요하면 상품 페이지의 [기업 구매 문의]를 이용해 주세요.`)
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
  return { input, items: [...merged.values()], errors }
}

publicOrderRouter.post('/orders', async (req, res) => {
  if (!orderingOpen()) return res.status(503).json({ error: '지금은 주문을 받을 수 없어요. 잠시 후 다시 시도해 주세요.' })
  const { input, items, errors } = readOrderInput(req.body)
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors })
  if (tooManyOrders(req)) return res.status(429).json({ error: '주문 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' })
  if (items.some(({ quantity }) => Array.from({ length: quantity }).some(() => tooManyHeldUnits(req)))) {
    return res.status(429).json({ error: `짧은 시간에 너무 많은 수량을 주문했어요. ${PENDING_MINUTES}분 뒤에 다시 시도하거나 상품 페이지의 [기업 구매 문의]를 이용해 주세요.` })
  }
  await expirePending()
  const { rows: [{ n: pending }] } = await pool.query(
    "SELECT count(*)::int AS n FROM orders WHERE buyer_phone_hash = $1 AND status = 'pending' AND created_at > now() - make_interval(mins => $2)",
    [lookupHash(input.buyerPhone), PENDING_MINUTES],
  )
  if (pending >= MAX_PENDING_PER_PHONE) {
    return res.status(429).json({ error: `결제하지 않은 주문이 이미 ${pending}건 있어요. 먼저 결제하거나 ${PENDING_MINUTES}분 뒤에 다시 주문해 주세요.` })
  }
  const customer = await currentCustomer(req) // 로그인한 회원이면 주문을 계정에 묶는다

  try {
    const order = await inTransaction(async (client) => {
      const lines = []
      for (const { productCode, optionId, quantity } of items) {
        let rows
        if (optionId) {
          // 옵션 상품: 상품 줄을 먼저 잠그고(옵션 저장·재고 복구와 같은 순서), 판매 중인 옵션의 재고가 충분할 때만 그 옵션 재고를 줄인다.
          // 가격은 이 순간의 DB 옵션 가격
          await lockProducts(client, [productCode])
          ;({ rows } = await client.query(
            `UPDATE product_options o SET stock = o.stock - $3, updated_at = now()
             FROM products p
             WHERE o.id = $2 AND o.product_code = $1 AND o.status = 'active' AND o.stock >= $3
               AND p.product_code = o.product_code AND p.status = 'active'
             RETURNING p.product_code, p.seller_code, p.name, p.unit, o.price, o.id AS option_id, o.name AS option_name, p.ship_from`,
            [productCode, optionId, quantity],
          ))
        } else {
          // 판매 중이고 재고가 충분할 때만 재고를 줄인다. 가격은 이 순간의 DB 가격. 옵션이 있는 상품은 옵션을 골라야 한다
          ;({ rows } = await client.query(
            `UPDATE products SET stock = stock - $2, updated_at = now()
             WHERE product_code = $1 AND status = 'active' AND stock >= $2
               AND NOT EXISTS (SELECT 1 FROM product_options o WHERE o.product_code = products.product_code)
             RETURNING product_code, seller_code, name, unit, price, ship_from`,
            [productCode, quantity],
          ))
        }
        if (!rows.length) {
          const found = await client.query(
            `SELECT p.name, p.stock, o.name AS option_name, o.stock AS option_stock, o.status AS option_status,
                    EXISTS (SELECT 1 FROM product_options x WHERE x.product_code = p.product_code) AS has_options
             FROM products p LEFT JOIN product_options o ON o.id = $2 AND o.product_code = p.product_code
             WHERE p.product_code = $1 AND p.status = 'active'`,
            [productCode, optionId],
          )
          const f = found.rows[0]
          const reason = !f ? '판매하지 않는 상품이 들어 있어요.'
            : optionId && f.option_status !== 'active' ? `${f.name}: 판매하지 않는 옵션이에요. 옵션을 다시 골라 주세요.`
              : optionId ? `${f.name} ${f.option_name}: 재고가 ${f.option_stock}개 남았어요.`
                : f.has_options ? `${f.name}: 옵션을 골라 주세요.`
                  : `${f.name}: 재고가 ${f.stock}개 남았어요.`
          throw Object.assign(new Error(reason), { status: 409 })
        }
        lines.push({ option_id: null, option_name: null, ...rows[0], quantity, subtotal: rows[0].price * quantity })
      }
      // 옵션 상품의 가격·재고 합을 옵션에 맞춘다 (목록의 품절 표시가 바로 맞게)
      await syncOptionTotals(client, [...new Set(lines.filter((l) => l.option_id).map((l) => l.product_code))])
      const itemsAmount = lines.reduce((sum, l) => sum + l.subtotal, 0)
      const farms = farmShipping(lines)
      const fee = farms.reduce((sum, f) => sum + f.fee, 0)
      const orderNo = newOrderNo()
      const { rows } = await client.query(
        `INSERT INTO orders (order_no, buyer_name, buyer_phone, receiver_name, receiver_phone, zipcode, address1, address2, memo,
                             items_amount, shipping_fee, total_amount, is_test, agreed_at, customer_id, buyer_email, buyer_phone_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $15, $16) RETURNING id`,
        [orderNo, sealText(input.buyerName), sealText(input.buyerPhone), sealText(input.receiverName), sealText(input.receiverPhone), sealText(input.zipcode), sealText(input.address1),
          sealText(input.address2 || null), sealText(input.memo || null), itemsAmount, fee, itemsAmount + fee, isTestPayment(),
          customer?.id ?? null, sealText(customer?.email ?? (input.email || null)), lookupHash(input.buyerPhone)],
      )
      // 예약 상품은 주문한 순간의 출고 시작일을 남긴다 (오늘보다 뒤인 날짜만). 농가 배송은 그 농가 상품 중 가장 늦은 날짜에 한꺼번에 보낸다
      for (const l of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_code, seller_code, name, unit, price, quantity, subtotal, option_id, option_name, ship_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [rows[0].id, l.product_code, l.seller_code, l.name, l.unit, l.price, l.quantity, l.subtotal, l.option_id, l.option_name, isPreorder(l.ship_from) ? l.ship_from : null],
        )
      }
      for (const f of farms) {
        await client.query('INSERT INTO order_shipments (order_id, seller_code, items_amount, shipping_fee, ship_from) VALUES ($1, $2, $3, $4, $5)',
          [rows[0].id, f.sellerCode, f.itemsAmount, f.fee, farmShipFrom(lines.filter((l) => l.seller_code === f.sellerCode))])
      }
      const first = `${lines[0].name.replace(/\[예시\]\s*/g, '')}${lines[0].option_name ? ` (${lines[0].option_name})` : ''}`
      return {
        orderNo,
        orderName: (lines.length > 1 ? `${first} 외 ${lines.length - 1}건` : first).slice(0, 100),
        itemsAmount,
        shippingFee: fee,
        farms: farms.length,
        amount: itemsAmount + fee,
      }
    })
    console.log(`[order] 주문 생성 ${order.orderNo} · ${order.amount}원${customer ? ' · 회원' : ''}`)
    if (customer && req.body.saveAddress === true) {
      // 회원이 '배송지 저장'을 골랐으면 받는 분 주소를 회원 정보에 저장
      await pool.query('UPDATE customers SET zipcode = $2, address1 = $3, address2 = $4 WHERE id = $1',
        [customer.id, sealText(input.zipcode), sealText(input.address1), sealText(input.address2 || null)])
    }
    res.status(201).json({ ...order, payToken: payTokenFor(order.orderNo), payment: { mode: paymentMode(), clientKey: clientKey(), test: isTestPayment() } })
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
    const order = openOrder(rows[0])
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    if (order.status === 'paid' && order.payment_key === paymentKey) return { status: 200 } // 새로고침 등으로 다시 불림
    if (order.status !== 'pending') {
      const why = { expired: `결제 시간(${PENDING_MINUTES}분)이 지나 주문이 만료됐어요. 다시 주문해 주세요.`, failed: '이미 실패 처리된 주문이에요. 다시 주문해 주세요.' }
      return { status: 409, error: why[order.status] ?? '이미 처리된 주문이에요.' }
    }
    // 금액 조작 확인: 결제창에서 돌아온 금액이 서버가 계산한 금액과 같아야 승인한다.
    // 다르면 승인하지 않고 주문은 그대로 둔다 — 주문번호만 아는 사람이 틀린 금액을 보내 남의 주문을 실패로 만들지 못하게.
    // 승인하지 않은 결제는 결제사에서 끝나고, 주문은 15분 정리 때 만료·재고 복구된다
    if (amount !== order.total_amount) {
      console.warn(`[order] ${order.order_no} 결제 금액 불일치 (요청 ${amount} / 주문 ${order.total_amount}) — 승인 안 함`)
      return { status: 400, error: '결제 금액이 주문 금액과 달라요. 다시 주문해 주세요.' }
    }
    try {
      const paid = await confirmPayment({ paymentKey, orderId: order.order_no, amount })
      await client.query(
        `UPDATE orders SET status = 'paid', payment_key = $2, payment_method = $3, paid_at = $4, updated_at = now() WHERE id = $1`,
        [order.id, sealText(paymentKey), paid.method, paid.approvedAt],
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
      const failed = { status: 402, error: error.code === 'UNSUPPORTED_STATUS' ? error.message : `결제를 완료하지 못했어요. ${error.message}` }
      // 승인은 됐는데 정보가 다르거나 지원하지 않는 상태면 바로 취소해서 돈이 묶이지 않게 한다
      if (error.payment?.paymentKey) {
        await cancelPayment({ paymentKey: error.payment.paymentKey, orderId: order.order_no, reason: '주문 확인 실패로 자동 취소' })
          .catch((e) => console.error(`[order] ${order.order_no} 자동 취소 실패 — 직접 확인 필요 · ${e.message}`))
        await restoreStock(client, order.id)
        await client.query("UPDATE orders SET status = 'failed', fail_reason = $2, updated_at = now() WHERE id = $1", [order.id, (error.code ?? error.message).slice(0, 100)])
        console.warn(`[order] 결제 승인 실패 ${order.order_no} · ${error.status ?? ''} ${error.code ?? ''}`)
        return failed
      }
      // 결제사가 승인을 거절함: 요청에 담긴 결제키가 이 주문 것이 아닐 수도 있다(주문번호만 아는 사람).
      // 그래서 거절만 보고 주문을 닫지 않고, 이 주문의 실제 결제 상태를 조회해서 끝난 결제일 때만 실패로 닫는다
      console.warn(`[order] 결제 승인 거절 ${order.order_no} · ${error.status ?? ''} ${error.code ?? ''} → 결제 조회`)
      let found
      try {
        found = await lookupPayment(order.order_no)
      } catch {
        return failed // 조회가 안 되면 주문은 그대로 두고 15분 정리 때 다시 본다
      }
      if ((await settleWithToss(client, order, found, 'failed')) === 'paid') return { status: 200, newlyPaid: true }
      return failed
    }
  })
  if (result.error) return res.status(result.status).json({ error: result.error, pending: result.pending === true })
  if (result.newlyPaid) notifyOrder(req.params.orderNo, 'paid')
  res.json(paidSummary(await loadOrder(req.params.orderNo)))
})

// 결제창에서 취소하거나 실패해서 failUrl로 돌아왔을 때: 재고를 바로 돌려놓는다.
// 주문을 만든 화면이 받은 결제용 표(payToken)가 있어야 한다. 표가 없으면 주문은 15분 정리 때 결제사 조회 후 닫힌다
publicOrderRouter.post('/orders/:orderNo/fail', async (req, res) => {
  if (tooManyPayments(req)) return res.status(429).json({ error: '요청이 너무 많아요.' })
  if (!payTokenMatches(req.body.token, req.params.orderNo)) return res.status(403).json({ error: '주문을 확인하지 못했어요.' })
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
export async function findMyOrder(req) {
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
  const done = await cancelOrder(order.order_no, `손님 취소: ${reason}`, ['paid'], '손님(비회원 주문 조회)')
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(publicOrder(await loadOrder(order.order_no)))
})

// 손님이 직접 구매 확정 (배송 완료된 주문만, 한 번만)
async function confirmPurchase(order, res) {
  if (order.status !== 'delivered') return res.status(409).json({ error: '배송이 끝난 주문만 구매 확정할 수 있어요.' })
  await pool.query('UPDATE orders SET confirmed_at = COALESCE(confirmed_at, now()) WHERE id = $1', [order.id])
  res.json(publicOrder(await loadOrder(order.order_no)))
}

publicOrderRouter.post('/orders/lookup/purchase-confirm', async (req, res) => {
  if (tooManyLookups(req)) return res.status(429).json({ error: '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.' })
  const order = await findMyOrder(req)
  if (!order) return res.status(404).json({ error: '주문을 찾지 못했어요.' })
  await confirmPurchase(order, res)
})

// 결제 취소 + 재고 복구 (손님·회원·관리자 공통). allowed: 취소할 수 있는 상태, by: 처리한 사람 (돌려준 돈 기록에만, 손님에게는 안 보임)
async function cancelOrder(orderNo, reason, allowed, by) {
  const result = await cancelOrderTx(orderNo, reason, allowed, by)
  if (result.status === 200) notifyOrder(orderNo, 'cancelled')
  return result
}

function cancelOrderTx(orderNo, reason, allowed, by) {
  return inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [orderNo])
    const order = openOrder(rows[0])
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    if (!allowed.includes(order.status)) return { status: 409, error: '이 상태의 주문은 취소할 수 없어요. 배송이 시작됐다면 반품으로 처리해요.' }
    await ensureShipments(order.id, client)
    const sent = await client.query("SELECT 1 FROM order_shipments WHERE order_id = $1 AND status IN ('shipping', 'delivered')", [order.id])
    if (sent.rowCount) return { status: 409, error: '이미 보낸 농가 상품이 있어서 전체 취소할 수 없어요. 받은 뒤 반품으로 처리해요.' }
    // 농가별로 먼저 취소한 몫이 있으면 남은 금액만 취소한다. 결과를 기다리는 취소가 있으면 그것부터 확인
    const sums = await refundSums(client, order.id)
    if (sums.pending) return { status: 409, error: '이 주문의 다른 취소·환불 결과를 확인하고 있어요. 그 건을 먼저 다시 확인해 주세요.' }
    const rest = order.total_amount - sums.done
    if (rest <= 0) return { status: 409, error: '이미 결제 금액을 모두 돌려드린 주문이에요.' }
    const key = sums.done ? `cancel-${order.order_no}-rest` : `cancel-${order.order_no}`
    try {
      if (sums.done) {
        await cancelPartial({ paymentKey: order.payment_key, orderId: order.order_no, amount: rest, reason, idempotencyKey: key, canceledBefore: sums.done })
      } else {
        await cancelPayment({ paymentKey: order.payment_key, orderId: order.order_no, reason })
      }
    } catch (error) {
      console.error(`[order] 결제 취소 실패 ${order.order_no} · ${error.status ?? ''} ${error.code ?? ''}`)
      return { status: 502, error: `결제 취소가 실패했어요. ${error.message}` }
    }
    await restoreStock(client, order.id)
    await client.query(
      "UPDATE orders SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1",
      [order.id, reason.slice(0, 200)],
    )
    await client.query("UPDATE order_shipments SET status = 'cancelled', updated_at = now() WHERE order_id = $1", [order.id])
    await client.query(
      `INSERT INTO order_refunds (order_id, kind, amount, status, idempotency_key, reason, processed_by, done_at)
       VALUES ($1, 'full', $2, 'done', $3, $4, $5, now())`,
      [order.id, rest, key, reason.slice(0, 200), by ?? '알 수 없음'],
    )
    console.log(`[order] 주문 취소 ${order.order_no}`)
    return { status: 200 }
  })
}

// ---------- 돌려주기: 농가별 부분 취소·반품 환불 공통 ----------
// 돌려준 돈(완료)과 결과를 기다리는 돈. 주문 줄을 잠근 트랜잭션 안에서 부른다
export async function refundSums(client, orderId) {
  const { rows } = await client.query(
    `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'done'), 0)::int AS done,
            COALESCE(sum(amount) FILTER (WHERE status = 'requested'), 0)::int AS pending
     FROM order_refunds WHERE order_id = $1`,
    [orderId],
  )
  return rows[0]
}

const won = (n) => `${n.toLocaleString('ko-KR')}원`
const REFUND_PENDING = '결제사 응답이 늦어 결과를 아직 몰라요. 잠시 후 같은 버튼을 다시 눌러 확인해 주세요. 돈이 두 번 나가지는 않아요.'

// 1) 주문 줄을 잠그고 확인한 뒤, 토스에 보내기 전에 '보냄(결과 모름)' 기록을 먼저 저장한다
//    → 누적액(완료 + 결과 기다림 + 이번)이 결제 금액을 넘지 않는지 잠근 채로 보고, 서버가 중간에 죽어도 기록이 남는다
// 2) 토스 부분 취소는 잠금을 푼 뒤 보낸다. 그동안 그 주문의 다른 취소·환불·전체 취소와 그 농가 배송 시작은 이 기록을 보고 막는다
// 3) 결과를 적는다: 성공하면 그때 재고·배송·반품 상태를 바꾸고(onDone), 확실한 실패면 failed(돈이 안 나감), 모르면 그대로 둔다
// 같은 대상(농가 배송·반품 신청)을 다시 요청하면: 끝났으면 다시 보내지 않고, 결과를 기다리면 같은 멱등키·같은 금액으로 다시 보낸다 (토스는 한 번만 취소)
// prepare(client, order) → { kind, sellerCode, returnId, amount, reason } 또는 { status, error } / { status: 200, already: true }
export async function runRefund(orderNo, by, prepare, onDone) {
  const start = await inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [orderNo])
    const order = openOrder(rows[0])
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    const target = await prepare(client, order)
    if (target.status) return target
    if (!order.payment_key) return { status: 409, error: '결제 기록이 없는 주문이에요.' }
    const { rows: tried } = await client.query(
      `SELECT * FROM order_refunds WHERE order_id = $1 AND kind = $2 AND (CASE WHEN $2 = 'return' THEN return_id::text ELSE seller_code END) = $3 ORDER BY id FOR UPDATE`,
      [order.id, target.kind, String(target.kind === 'return' ? target.returnId : target.sellerCode)],
    )
    const previous = tried.find((r) => r.status !== 'failed')
    if (previous?.status === 'done') return { status: 200, already: true }
    const sums = await refundSums(client, order.id)
    if (previous) {
      if (previous.amount !== target.amount) return { status: 409, error: `앞서 보낸 ${won(previous.amount)} 환불의 결과를 확인하고 있어요. 같은 금액으로 다시 확인해 주세요.` }
      return { order, refund: previous, canceledBefore: sums.done }
    }
    if (sums.pending) return { status: 409, error: '이 주문의 다른 취소·환불 결과를 확인하고 있어요. 그 건을 먼저 다시 확인해 주세요.' }
    if (!Number.isInteger(target.amount) || target.amount < 1) return { status: 400, error: '돌려줄 금액을 확인해 주세요.' }
    if (sums.done + target.amount > order.total_amount) {
      return { status: 409, error: `돌려줄 수 있는 금액을 넘어요. 결제 ${won(order.total_amount)} 중 ${won(sums.done)}을 이미 돌려드렸어요.` }
    }
    const key = `${target.kind}-${order.order_no}-${target.kind === 'return' ? `r${target.returnId}` : target.sellerCode}-${tried.length + 1}`
    const { rows: [refund] } = await client.query(
      `INSERT INTO order_refunds (order_id, seller_code, return_id, kind, amount, idempotency_key, reason, processed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [order.id, target.sellerCode, target.returnId ?? null, target.kind, target.amount, key, target.reason.slice(0, 200), by],
    )
    return { order, refund, canceledBefore: sums.done }
  })
  if (start.status) return start
  const { order, refund } = start
  let failure = null
  try {
    await cancelPartial({ paymentKey: order.payment_key, orderId: order.order_no, amount: refund.amount, reason: refund.reason, idempotencyKey: refund.idempotency_key, canceledBefore: start.canceledBefore })
  } catch (error) {
    failure = error
  }
  return inTransaction(async (client) => {
    await client.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [order.id])
    const { rows: [current] } = await client.query('SELECT * FROM order_refunds WHERE id = $1 FOR UPDATE', [refund.id])
    if (current.status === 'done') return { status: 200, already: true } // 같은 요청이 함께 와서 다른 쪽이 먼저 끝냄
    if (!failure) {
      const { rows: [saved] } = await client.query("UPDATE order_refunds SET status = 'done', done_at = now() WHERE id = $1 RETURNING *", [refund.id])
      await onDone(client, order, saved)
      console.log(`[refund] ${by} ${order.order_no} ${saved.kind} ${saved.seller_code ?? ''} ${saved.amount}원 돌려줌`)
      return { status: 200, done: true, refund: saved }
    }
    if (failure.uncertain) {
      console.warn(`[refund] ${order.order_no} ${current.kind} 결과를 모름 (${failure.code ?? failure.message}) → 같은 멱등키로 다시 확인`)
      return { status: 202, pending: true, error: REFUND_PENDING }
    }
    await client.query("UPDATE order_refunds SET status = 'failed', fail_reason = $2 WHERE id = $1", [refund.id, (failure.code ?? failure.message).slice(0, 100)])
    console.error(`[refund] 결제 취소 실패 ${order.order_no} · ${failure.status ?? ''} ${failure.code ?? ''}`)
    return { status: 502, error: `결제 취소가 실패했어요 (돈은 나가지 않았어요). ${failure.message}` }
  })
}

// 아직 보내지 않은 농가 배송 한 건 취소: 그 농가의 상품 금액 + 배송비를 토스 부분 취소로 돌려주고 재고(옵션 재고 포함)를 돌려놓는다.
// 남은 농가가 있으면 주문은 그대로 두고 상태만 다시 맞추고, 모두 취소되면 주문도 취소. 판매자는 자기 농가만 (부르는 쪽이 로그인한 농가를 넘긴다)
export async function cancelFarm(orderNo, sellerCode, reason, by) {
  const result = await runRefund(orderNo, by, async (client, order) => {
    await ensureShipments(order.id, client)
    const { rows: [sh] } = await client.query('SELECT * FROM order_shipments WHERE order_id = $1 AND seller_code = $2 FOR UPDATE', [order.id, sellerCode])
    if (!sh) return { status: 404, error: '이 주문에 그 농가 상품이 없어요.' }
    if (sh.status === 'cancelled') return { status: 200, already: true }
    if (!['paid', 'preparing', 'shipping'].includes(order.status)) return { status: 409, error: '이 상태의 주문은 농가별로 취소할 수 없어요.' }
    if (!['paid', 'preparing'].includes(sh.status)) return { status: 409, error: '이미 보낸 농가 상품은 취소할 수 없어요. 받은 뒤 반품으로 처리해요.' }
    return { kind: 'cancel', sellerCode, amount: sh.items_amount + sh.shipping_fee, reason }
  }, async (client, order, refund) => {
    await restoreStock(client, order.id, sellerCode)
    await client.query("UPDATE order_shipments SET status = 'cancelled', updated_at = now() WHERE order_id = $1 AND seller_code = $2", [order.id, sellerCode])
    const left = await client.query("SELECT 1 FROM order_shipments WHERE order_id = $1 AND status <> 'cancelled'", [order.id])
    if (left.rowCount) {
      await syncOrderStatus(client, order.id)
    } else {
      await client.query("UPDATE orders SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1", [order.id, refund.reason])
    }
  })
  if (result.done) notifyOrder(orderNo, 'farm_cancelled', sellerCode)
  return result
}

// 돌려주기 결과를 응답으로: 결과를 모르면 202 + pending (화면은 [다시 확인]을 보여 준다)
export function sendRefundResult(res, result, body) {
  if (result.pending) return res.status(202).json({ error: result.error, pending: true })
  if (result.error) return res.status(result.status).json({ error: result.error })
  return body()
}

// ---------- 관리자용 ----------
export const adminOrderRouter = express.Router()
adminOrderRouter.use(requireAdmin)

const LIST_SQL = `
  SELECT o.order_no, o.status, o.buyer_name, o.receiver_name, o.total_amount, o.payment_method, o.is_test,
         o.created_at, o.paid_at, o.tracking_no,
         (SELECT string_agg(oi.name || COALESCE(' · ' || oi.option_name, '') || ' ×' || oi.quantity, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id) AS summary,
         (SELECT count(*) FROM order_shipments sh WHERE sh.order_id = o.id)::int AS farms,
         (SELECT count(*) FROM order_shipments sh WHERE sh.order_id = o.id AND sh.status IN ('shipping', 'delivered'))::int AS farms_sent,
         (SELECT count(*) FROM order_shipments sh WHERE sh.order_id = o.id AND sh.status = 'paid')::int AS farms_waiting,
         (SELECT max(sh.ship_from) FROM order_shipments sh WHERE sh.order_id = o.id AND sh.status IN ('paid', 'preparing') AND sh.ship_from > ${KOREA_TODAY}) AS ship_from,
         (SELECT COALESCE(sum(r.amount), 0) FROM order_refunds r WHERE r.order_id = o.id AND r.status = 'done' AND r.kind <> 'full')::int AS refunded
  FROM orders o`

// 결제 완료·배송 준비는 농가 배송 기준으로 찾는다. 여러 농가 주문은 한 농가만 보내도 주문 상태가 '배송 중'이 되어서,
// 주문 상태로 찾으면 아직 준비도 안 한 농가가 있는 주문이 목록에서 빠진다
const BY_SHIPMENT = new Set(['paid', 'preparing'])

adminOrderRouter.get('/', async (req, res) => {
  await ensureShipments()
  const status = text(req.query.status)
  const params = []
  let sql = `${LIST_SQL} WHERE o.status NOT IN ('pending', 'failed', 'expired')`
  if (status) {
    params.push(status)
    sql = BY_SHIPMENT.has(status)
      ? `${LIST_SQL} WHERE o.status IN ('paid', 'preparing', 'shipping') AND EXISTS (SELECT 1 FROM order_shipments sh WHERE sh.order_id = o.id AND sh.status = $1)`
      : `${LIST_SQL} WHERE o.status = $1`
  }
  const { rows } = await pool.query(`${sql} ORDER BY o.created_at DESC LIMIT 200`, params)
  res.json(rows.map(openOrder))
})

adminOrderRouter.get('/:orderNo', async (req, res) => {
  const order = await loadOrder(req.params.orderNo)
  if (!order) return res.status(404).json({ error: '주문을 찾지 못했어요.' })
  res.json(staffOrder(order))
})

// 배송 단계 바꾸기 (농가별): 결제완료 → 배송준비 → 배송중(송장 필수) → 배송완료
// 판매자는 자기 농가 배송만, 관리자는 sellerCode 로 한 농가를 고르거나 비우면 그 단계에 있는 농가 모두 (송장은 농가마다 따로)
const NEXT = { paid: 'preparing', preparing: 'shipping', shipping: 'delivered' }

async function advance(orderNo, body, who, onlySeller = null) {
  const result = await advanceTx(orderNo, body, who, onlySeller)
  if (result.status === 200 && body.status === 'shipping') for (const seller of result.sellers) notifyOrder(orderNo, 'shipping', seller)
  return result
}

function advanceTx(orderNo, body, who, onlySeller) {
  const status = text(body.status)
  const courier = text(body.courier).slice(0, 30)
  const trackingNo = text(body.trackingNo).replace(/[^0-9A-Za-z-]/g, '').slice(0, 30)
  const pick = onlySeller ?? (text(body.sellerCode) || null)
  return inTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_no = $1 FOR UPDATE', [orderNo])
    const order = rows[0]
    if (!order) return { status: 404, error: '주문을 찾지 못했어요.' }
    if (!['paid', 'preparing', 'shipping'].includes(order.status)) return { status: 409, error: '지금 상태에서 그 단계로 바꿀 수 없어요.' }
    await ensureShipments(order.id, client)
    const { rows: shipments } = await client.query(
      "SELECT * FROM order_shipments WHERE order_id = $1 AND status <> 'cancelled' AND ($2::text IS NULL OR seller_code = $2) ORDER BY id FOR UPDATE",
      [order.id, pick],
    )
    if (!shipments.length) return { status: onlySeller ? 403 : 404, error: onlySeller ? '이 주문에는 내 농가 상품이 없어요.' : '그 농가의 배송을 찾지 못했어요.' }
    const targets = shipments.filter((s) => NEXT[s.status] === status)
    if (!targets.length) return { status: 409, error: '지금 상태에서 그 단계로 바꿀 수 없어요.' }
    // 취소 결과를 기다리는 농가 배송은 보내지 않는다 (토스에서는 이미 돈을 돌려줬을 수 있다)
    const { rows: cancelling } = await client.query("SELECT seller_code FROM order_refunds WHERE order_id = $1 AND kind = 'cancel' AND status = 'requested'", [order.id])
    if (targets.some((s) => cancelling.some((r) => r.seller_code === s.seller_code))) {
      return { status: 409, error: '취소 결과를 확인하고 있는 농가 배송이에요. 취소를 먼저 다시 확인해 주세요.' }
    }
    if (status === 'shipping') {
      if (!courier || trackingNo.length < 6) return { status: 400, error: '택배사와 송장 번호를 넣어 주세요.' }
      if (targets.length > 1) return { status: 400, error: '농가마다 송장이 달라요. 농가를 골라 하나씩 넣어 주세요.' }
    }
    for (const s of targets) {
      await client.query(
        `UPDATE order_shipments SET status = $2, updated_at = now(),
           courier = CASE WHEN $2 = 'shipping' THEN $3 ELSE courier END,
           tracking_no = CASE WHEN $2 = 'shipping' THEN $4 ELSE tracking_no END,
           shipped_at = CASE WHEN $2 = 'shipping' THEN now() ELSE shipped_at END,
           delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END
         WHERE id = $1`,
        [s.id, status, courier, trackingNo],
      )
    }
    const orderStatus = await syncOrderStatus(client, order.id)
    console.log(`[order] ${who} ${order.order_no} ${targets.map((s) => s.seller_code).join(',')} → ${status} (주문 ${orderStatus})`)
    return { status: 200, sellers: targets.map((s) => s.seller_code) }
  })
}

adminOrderRouter.patch('/:orderNo', async (req, res) => {
  const done = await advance(req.params.orderNo, req.body, req.admin.loginId)
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(staffOrder(await loadOrder(req.params.orderNo)))
})

adminOrderRouter.post('/:orderNo/cancel', async (req, res) => {
  const reason = text(req.body.reason)
  if (reason.length < 2) return res.status(400).json({ error: '취소 사유를 적어 주세요.' })
  const done = await cancelOrder(req.params.orderNo, `관리자 취소: ${reason}`, ['paid', 'preparing'], `관리자 ${req.admin.loginId}`)
  if (done.error) return res.status(done.status).json({ error: done.error })
  console.log(`[order] ${req.admin.loginId} 주문 취소 처리 ${req.params.orderNo}`) // 취소 사유는 손님에게도 보여서 관리자 아이디를 넣지 않는다
  res.json(staffOrder(await loadOrder(req.params.orderNo)))
})

// 농가 한 곳만 취소 (아직 보내지 않은 농가 배송). 결과를 모르면 202 → 같은 요청을 다시 보내 확인
adminOrderRouter.post('/:orderNo/shipments/:sellerCode/cancel', async (req, res) => {
  const reason = text(req.body.reason).slice(0, 100)
  if (reason.length < 2) return res.status(400).json({ error: '취소 사유를 적어 주세요.' })
  const done = await cancelFarm(req.params.orderNo, req.params.sellerCode, `관리자 취소: ${reason}`, `관리자 ${req.admin.loginId}`)
  sendRefundResult(res, done, async () => res.json(staffOrder(await loadOrder(req.params.orderNo))))
})

// ---------- 판매자용: 내 농가 상품이 들어 있는 주문 ----------
export const sellerOrderRouter = express.Router()
sellerOrderRouter.use(requireSeller)

// 주문 하나에 다른 농가 상품이 함께 있어도 내 농가 몫은 내가 따로 보낸다 (status·송장은 내 농가 배송 기준, order_status 는 주문 전체)
sellerOrderRouter.get('/', async (req, res) => {
  const seller = req.seller.sellerCode
  await ensureShipments()
  const { rows } = await pool.query(`
    SELECT o.id, sh.id AS ref, o.order_no, sh.status, o.status AS order_status, o.created_at, o.paid_at, sh.courier, sh.tracking_no, o.memo, o.is_test, o.confirmed_at,
           sh.items_amount, sh.shipping_fee, o.receiver_name, o.receiver_phone, o.zipcode, o.address1, o.address2,
           CASE WHEN sh.ship_from > ${KOREA_TODAY} THEN sh.ship_from END AS ship_from,
           (SELECT count(*) FROM order_shipments x WHERE x.order_id = o.id)::int AS farms,
           EXISTS (SELECT 1 FROM order_refunds r WHERE r.order_id = o.id AND r.seller_code = sh.seller_code AND r.kind = 'cancel' AND r.status = 'requested') AS cancel_pending
    FROM orders o JOIN order_shipments sh ON sh.order_id = o.id AND sh.seller_code = $1
    WHERE o.status IN ('paid', 'preparing', 'shipping', 'delivered', 'cancelled')
    ORDER BY o.created_at DESC LIMIT 200`, [seller])
  const items = rows.length
    ? (await pool.query('SELECT order_id, name, option_name, unit, quantity, subtotal FROM order_items WHERE order_id = ANY($1) AND seller_code = $2 ORDER BY id',
        [rows.map((r) => r.id), seller])).rows
    : []
  // 받는 분 정보는 내가 보내야 하는 동안(내 농가 배송이 아직 보내기 전)만 보여 준다
  // 주문번호는 가려서 보여 준다: 주문번호 + 받는 분 번호(대개 주문자 번호와 같음)면 비회원 주문 조회로 다른 농가 몫까지 취소할 수 있어서.
  // 판매자 처리(상태·취소)는 내 농가 배송 번호(ref)로 한다
  res.json(rows.map(openOrder).map(({ id, order_no, receiver_name, receiver_phone, zipcode, address1, address2, memo, ...o }) => ({
    ...o,
    order_label: maskOrderNo(order_no),
    tracking_url: trackingUrl(o.courier, o.tracking_no),
    items: items.filter((i) => i.order_id === id).map(({ order_id: _o, ...i }) => i),
    receiver: ['paid', 'preparing'].includes(o.status) ? { name: receiver_name, phone: receiver_phone, zipcode, address1, address2, memo } : null,
  })))
})

// 정산 요약: 이번 달 구매 확정된 내 상품 매출(정산 예정)과 확정 기다리는 매출 (테스트 결제 포함, 표시는 화면에서)
// 취소한 내 농가 배송은 빼고(배송 완료된 내 배송만), 내 농가 반품으로 돌려준 돈은 뺀다.
// 확정 대기는 내 농가 배송이 끝났으면 센다: 여러 농가 주문은 다른 농가가 아직 안 보내도 주문 상태가 '배송 중'이라
// 주문 전체가 배송 완료일 때만 세면 내 몫이 안 보였다. 구매 확정은 지금처럼 주문 전체 기준 [가설: 농가별 확정은 회사가 정함]
const SETTLE_ORDER = "o.status IN ('shipping', 'delivered')"
// 지난달 이전에 확정된 주문을 이번 달에 환불했으면 이번 달 정산에서 뺀다 (late_refunds) [가설: 정산 뒤 환불 처리는 회사가 정함]
sellerOrderRouter.get('/settlement', async (req, res) => {
  await ensureShipments()
  const { rows } = await pool.query(
    `SELECT
       COALESCE(sum(oi.subtotal) FILTER (WHERE o.confirmed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'), 0)::int AS confirmed_amount,
       count(DISTINCT o.id) FILTER (WHERE o.confirmed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')::int AS confirmed_orders,
       COALESCE(sum(oi.subtotal) FILTER (WHERE o.confirmed_at IS NULL), 0)::int AS waiting_amount,
       count(DISTINCT o.id) FILTER (WHERE o.confirmed_at IS NULL)::int AS waiting_orders,
       bool_or(o.is_test) AS has_test
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     JOIN order_shipments sh ON sh.order_id = o.id AND sh.seller_code = oi.seller_code
     WHERE oi.seller_code = $1 AND ${SETTLE_ORDER} AND sh.status = 'delivered'`,
    [req.seller.sellerCode],
  )
  // 농가별로 받은 배송비도 그 농가 몫 (택배를 직접 보내니까)
  const fees = await pool.query(
    `SELECT COALESCE(sum(sh.shipping_fee) FILTER (WHERE o.confirmed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'), 0)::int AS confirmed_shipping,
            COALESCE(sum(sh.shipping_fee) FILTER (WHERE o.confirmed_at IS NULL), 0)::int AS waiting_shipping
     FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
     WHERE sh.seller_code = $1 AND ${SETTLE_ORDER} AND sh.status = 'delivered'`,
    [req.seller.sellerCode],
  )
  const month = "date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'"
  const refunds = await pool.query(
    `SELECT COALESCE(sum(r.amount) FILTER (WHERE o.confirmed_at >= ${month}), 0)::int AS confirmed_refunds,
            COALESCE(sum(r.amount) FILTER (WHERE o.confirmed_at IS NULL), 0)::int AS waiting_refunds,
            COALESCE(sum(r.amount) FILTER (WHERE o.confirmed_at < ${month} AND r.done_at >= ${month}), 0)::int AS late_refunds
     FROM order_refunds r JOIN orders o ON o.id = r.order_id
     WHERE r.seller_code = $1 AND r.kind = 'return' AND r.status = 'done' AND ${SETTLE_ORDER}`,
    [req.seller.sellerCode],
  )
  res.json({ ...rows[0], ...fees.rows[0], ...refunds.rows[0], confirmDays: CONFIRM_DAYS })
})

// 내 농가 배송 번호(ref) → 주문번호. 다른 농가 배송이면 null
async function sellerOrderNo(ref, sellerCode) {
  // 주문번호를 이미 아는 경우(시험 스크립트·예전 화면)는 그대로 받는다. 내 농가 주문인지는 advance·cancelFarm 이 따로 확인한다
  if (/^FM\d{6}-[A-Z0-9]{10}$/.test(ref)) return ref
  const id = Number(ref)
  if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) return null
  const { rows } = await pool.query('SELECT o.order_no FROM order_shipments sh JOIN orders o ON o.id = sh.order_id WHERE sh.id = $1 AND sh.seller_code = $2', [id, sellerCode])
  return rows[0]?.order_no ?? null
}

sellerOrderRouter.patch('/:ref', async (req, res) => {
  const orderNo = await sellerOrderNo(req.params.ref, req.seller.sellerCode)
  if (!orderNo) return res.status(404).json({ error: '내 농가 주문에서 찾지 못했어요.' })
  const done = await advance(orderNo, req.body, req.seller.loginId, req.seller.sellerCode)
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.status(204).end()
})

// 내 농가 몫만 취소 (아직 보내지 않았을 때). 농가는 요청에서 받지 않고 로그인한 판매자 농가로만
sellerOrderRouter.post('/:ref/cancel', async (req, res) => {
  const reason = text(req.body.reason).slice(0, 100)
  if (reason.length < 2) return res.status(400).json({ error: '취소 사유를 적어 주세요. (손님에게 보여요)' })
  const orderNo = await sellerOrderNo(req.params.ref, req.seller.sellerCode)
  if (!orderNo) return res.status(403).json({ error: '이 주문에는 내 농가 상품이 없어요.' })
  const done = await cancelFarm(orderNo, req.seller.sellerCode, `판매자 취소: ${reason}`, `판매자 ${req.seller.loginId}`)
  if (done.status === 404) return res.status(403).json({ error: '이 주문에는 내 농가 상품이 없어요.' })
  sendRefundResult(res, done, () => res.status(204).end())
})

// ---------- 주문 알림 메일 (손님: 주문 때 남긴 이메일·회원 이메일 / 관리자: ADMIN_EMAIL) ----------
// sellerCode: 배송 알림은 농가마다 (그 농가 송장과 상품만)
async function notifyOrder(orderNo, event, sellerCode = null) {
  try {
    const order = await loadOrder(orderNo)
    if (!order) return
    const listOf = (items) => items.map((i) => `- ${i.name.replace(/\[예시\]\s*/g, '')}${i.option_name ? ` (${i.option_name})` : ''} × ${i.quantity}  ${i.subtotal.toLocaleString('ko-KR')}원`).join('\n')
    const lines = listOf(order.items)
    const farms = order.shipments.length > 1 ? `\n농가 ${order.shipments.length}곳에서 따로 보내요 (배송비는 농가마다).` : ''
    const total = `합계 ${order.total_amount.toLocaleString('ko-KR')}원 (배송비 ${order.shipping_fee.toLocaleString('ko-KR')}원 포함)${farms}`
    const lookup = `${publicUrl()}/order/lookup`
    const sent = order.shipments.find((s) => s.seller_code === sellerCode) ?? order.shipments[0] ?? order
    const farmName = sent.seller_name ? `${sent.seller_name.replace(/\[예시\]\s*/g, '')}에서 ` : ''
    const sentLines = sellerCode ? listOf(order.items.filter((i) => i.seller_code === sellerCode)) : lines
    const mails = {
      paid: [`[${SHOP.name}] 주문이 완료됐어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문해 주셔서 고마워요.\n\n주문번호: ${order.order_no}\n${lines}\n${total}\n\n${shippingNote(order.shipments)}\n주문 조회: ${lookup}\n`],
      shipping: [`[${SHOP.name}] ${farmName}상품을 보냈어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문하신 상품을 ${farmName}보냈어요.\n\n${sent.courier} ${sent.tracking_no}\n배송 조회: ${trackingUrl(sent.courier, sent.tracking_no)}\n\n${sentLines}\n`],
      cancelled: [`[${SHOP.name}] 주문이 취소됐어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문이 취소되어 결제를 취소했어요. 카드사에 따라 환불까지 며칠 걸릴 수 있어요.\n\n주문번호: ${order.order_no}\n${lines}\n${total}\n`],
    }
    if (event === 'farm_cancelled') {
      const refund = order.refunds.find((r) => r.kind === 'cancel' && r.seller_code === sellerCode && r.status === 'done')
      const left = order.shipments.filter((s) => s.status !== 'cancelled').length
      mails.farm_cancelled = [`[${SHOP.name}] ${farmName}보낼 상품 주문을 취소했어요 (${order.order_no})`,
        `${order.buyer_name}님, 주문 중 ${farmName}보낼 상품을 취소하고 그 상품 금액과 배송비 ${(refund?.amount ?? 0).toLocaleString('ko-KR')}원의 결제를 취소했어요. 카드사에 따라 환불까지 며칠 걸릴 수 있어요.\n`
        + `사유: ${order.status === 'cancelled' ? order.cancel_reason : refund?.reason ?? ''}\n\n주문번호: ${order.order_no}\n${sentLines}\n\n`
        + `${left ? `나머지 상품은 그대로 보내 드려요.\n주문 조회: ${lookup}\n` : '이 주문의 상품이 모두 취소됐어요.\n'}`]
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

memberOrderRouter.post('/:orderNo/purchase-confirm', async (req, res) => {
  const order = await myOrder(req, res)
  if (order) await confirmPurchase(order, res)
})

memberOrderRouter.post('/:orderNo/cancel', async (req, res) => {
  const order = await myOrder(req, res)
  if (!order) return
  if (order.status !== 'paid') return res.status(409).json({ error: '배송 준비가 시작된 주문은 고객센터로 취소를 요청해 주세요.' })
  const done = await cancelOrder(order.order_no, `회원 취소: ${text(req.body.reason).slice(0, 100) || '손님 요청'}`, ['paid'], `회원 #${req.customer.id}`)
  if (done.error) return res.status(done.status).json({ error: done.error })
  res.json(publicOrder(await loadOrder(order.order_no)))
})

export { COURIERS }
