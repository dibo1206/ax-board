// 관리자 정산표 (2026-11-17): 달마다 농가별로 얼마를 보내야 하는지, 보냈는지
// 정산 대상 = 그 달(한국 시간)에 구매 확정된 주문 중, 그 농가 배송이 끝난 것 (판매자 화면의 정산 요약과 같은 기준, server/orders.js /settlement)
//   상품 판매액 + 배송비 몫 − 반품 환불 − 수수료(상품 판매액 × 주문할 때 적어 둔 수수료율, 반품 환불분 수수료는 돌려줌)
// 반품 환불: 그 달 확정 주문에 그 달 안에 돌려준 돈 + 지난달 이전 확정 주문에 이번 달 돌려준 돈 (한 번 돌려준 돈이 두 달에 겹쳐 빠지지 않게)
// 실제 송금은 쇼핑몰 밖(은행)에서 하고, 여기서는 [지급 완료]로 기록만 한다. 달이 끝나야 기록할 수 있고, 기록한 금액이 지금 계산과 다르면 표시한다
import express from 'express'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'

export const adminSettlementRouter = express.Router()
adminSettlementRouter.use(requireAdmin)

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const thisMonth = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7) // 한국 시간 기준 'YYYY-MM'

// month: 'YYYY-MM'. includeTest: 테스트 결제 주문도 셀지
export async function monthSettlement(month, { includeTest = true, sellerCode = null } = {}) {
  const day = `${month}-01`
  const start = "($1::date)::timestamp AT TIME ZONE 'Asia/Seoul'"
  const end = "($1::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'"
  const live = "($2 OR NOT o.is_test)"
  const farm = '($3::text IS NULL OR s.seller_code = $3)'
  const { rows } = await pool.query(`
    WITH items AS (
      SELECT oi.seller_code, count(DISTINCT o.id)::int AS orders, sum(oi.subtotal)::int AS amount,
             sum(oi.subtotal * COALESCE(sh.commission_rate, 0)) / 100 AS commission, bool_or(o.is_test) AS has_test
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      JOIN order_shipments sh ON sh.order_id = o.id AND sh.seller_code = oi.seller_code
      WHERE o.status IN ('shipping', 'delivered') AND sh.status = 'delivered' AND ${live}
        AND o.confirmed_at >= ${start} AND o.confirmed_at < ${end}
      GROUP BY oi.seller_code
    ), fees AS (
      SELECT sh.seller_code, sum(sh.shipping_fee)::int AS shipping
      FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
      WHERE o.status IN ('shipping', 'delivered') AND sh.status = 'delivered' AND ${live}
        AND o.confirmed_at >= ${start} AND o.confirmed_at < ${end}
      GROUP BY sh.seller_code
    ), refunds AS (
      SELECT r.seller_code, sum(r.amount)::int AS refunds, sum(r.amount * COALESCE(sh.commission_rate, 0)) / 100 AS refund_commission
      FROM order_refunds r JOIN orders o ON o.id = r.order_id
      LEFT JOIN order_shipments sh ON sh.order_id = r.order_id AND sh.seller_code = r.seller_code
      WHERE r.kind = 'return' AND r.status = 'done' AND o.status IN ('shipping', 'delivered') AND ${live}
        AND ((o.confirmed_at >= ${start} AND o.confirmed_at < ${end} AND r.done_at < ${end})
          OR (o.confirmed_at < ${start} AND r.done_at >= ${start} AND r.done_at < ${end}))
      GROUP BY r.seller_code
    )
    SELECT s.seller_code, s.name, s.is_company,
           COALESCE(i.orders, 0) AS orders, COALESCE(i.amount, 0) AS amount, COALESCE(f.shipping, 0) AS shipping,
           COALESCE(r.refunds, 0) AS refunds,
           GREATEST(0, round(COALESCE(i.commission, 0)) - round(COALESCE(r.refund_commission, 0)))::int AS commission,
           COALESCE(i.has_test, false) AS has_test,
           p.amount AS paid_amount, p.paid_at, p.paid_by
    FROM sellers s
    LEFT JOIN items i ON i.seller_code = s.seller_code
    LEFT JOIN fees f ON f.seller_code = s.seller_code
    LEFT JOIN refunds r ON r.seller_code = s.seller_code
    LEFT JOIN settlement_payouts p ON p.seller_code = s.seller_code AND p.month = $1::date
    WHERE ${farm} AND (i.seller_code IS NOT NULL OR r.seller_code IS NOT NULL OR p.seller_code IS NOT NULL)
    ORDER BY s.is_company, s.name`, [day, includeTest, sellerCode])
  return rows.map((row) => ({ ...row, payout: row.amount + row.shipping - row.refunds - row.commission }))
}

adminSettlementRouter.get('/:month', async (req, res) => {
  const month = req.params.month
  if (!MONTH.test(month) || month > thisMonth()) return res.status(400).json({ error: '정산할 달을 다시 골라 주세요.' })
  const includeTest = req.query.test !== '0'
  const rows = await monthSettlement(month, { includeTest })
  res.json({ month, closed: month < thisMonth(), includeTest, rows })
})

// 지급 완료 기록 {amount}: 달이 끝난 뒤에만. 화면에서 본 금액이 지금 계산과 같아야 한다 (그사이 환불이 생겼으면 다시 보게)
adminSettlementRouter.post('/:month/sellers/:code/paid', async (req, res) => {
  const month = req.params.month
  if (!MONTH.test(month) || month >= thisMonth()) return res.status(400).json({ error: '지급 완료는 그 달이 끝난 뒤에 기록할 수 있어요.' })
  const [row] = await monthSettlement(month, { includeTest: req.body?.includeTest !== false, sellerCode: req.params.code })
  if (!row) return res.status(404).json({ error: '그 달 정산할 내용이 없는 농가예요.' })
  if (row.paid_at) return res.status(409).json({ error: '이미 지급 완료로 기록했어요.' })
  if (Number(req.body?.amount) !== row.payout) return res.status(409).json({ error: `정산 금액이 바뀌었어요 (지금 ${row.payout.toLocaleString('ko-KR')}원). 새로고침한 뒤 다시 확인해 주세요.` })
  await pool.query(
    'INSERT INTO settlement_payouts (seller_code, month, amount, paid_by) VALUES ($1, $2::date, $3, $4) ON CONFLICT (seller_code, month) DO NOTHING',
    [row.seller_code, `${month}-01`, row.payout, req.admin.loginId],
  )
  console.log(`[settlement] ${req.admin.loginId} ${month} ${row.seller_code} 지급 완료 ${row.payout}원`)
  res.status(201).json({ ok: true })
})

// 지급 완료 기록 지우기 (잘못 눌렀을 때)
adminSettlementRouter.delete('/:month/sellers/:code/paid', async (req, res) => {
  const month = req.params.month
  if (!MONTH.test(month)) return res.status(400).json({ error: '달을 다시 골라 주세요.' })
  const { rowCount } = await pool.query('DELETE FROM settlement_payouts WHERE seller_code = $1 AND month = $2::date', [req.params.code, `${month}-01`])
  if (!rowCount) return res.status(404).json({ error: '지급 완료 기록이 없어요.' })
  console.log(`[settlement] ${req.admin.loginId} ${month} ${req.params.code} 지급 완료 기록 지움`)
  res.status(204).end()
})
