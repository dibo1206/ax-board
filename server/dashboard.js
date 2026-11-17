// 관리자 매출 화면: 오늘·이번 달 매출, 최근 30일 날짜별 매출, 많이 팔린 상품, 재고 부족, 할 일
// 매출 = 결제 완료 이후 상태(결제 완료·배송 준비·배송 중·배송 완료)의 결제 금액 − 농가별 부분 취소·반품 환불로 돌려준 돈. 날짜는 한국 시간 기준
// 돌려준 돈은 결제한 날의 매출에서 뺀다 (전체 취소한 주문을 결제한 날 매출에서 빼는 것과 같게)
import express from 'express'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'

const PAID = "('paid', 'preparing', 'shipping', 'delivered')"
const KST = (column) => `(${column} AT TIME ZONE 'Asia/Seoul')::date`
const TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"
const LOW_STOCK = 5
// 주문마다 돌려준 돈 (o 와 함께 쓴다)
const REFUNDED = `LEFT JOIN (SELECT order_id, sum(amount)::int AS amount, sum(tax_free_amount)::int AS tax_free FROM order_refunds WHERE status = 'done' GROUP BY order_id) rf ON rf.order_id = o.id`
const NET = '(o.total_amount - COALESCE(rf.amount, 0))'

export const dashboardRouter = express.Router()
dashboardRouter.use(requireAdmin)

dashboardRouter.get('/', async (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30))
  // 테스트 결제 주문까지 셀지 (개발 중엔 모든 주문이 테스트 결제라 기본은 포함)
  const test = req.query.test === '0' ? 'AND NOT o.is_test' : ''
  const [summary, series, top, low, todo] = await Promise.all([
    pool.query(`SELECT
        COALESCE(sum(${NET}) FILTER (WHERE ${KST('o.paid_at')} = ${TODAY}), 0)::int AS today_sales,
        count(*) FILTER (WHERE ${KST('o.paid_at')} = ${TODAY})::int AS today_orders,
        COALESCE(sum(${NET}) FILTER (WHERE date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')), 0)::int AS month_sales,
        count(*) FILTER (WHERE date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::int AS month_orders,
        COALESCE(sum(rf.amount) FILTER (WHERE date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')), 0)::int AS month_refunded,
        -- 면세 매출 (가공 안 한 농산물): 주문의 면세 금액 − 돌려준 면세 금액. 나머지가 과세 매출 (부가세 신고 참고)
        COALESCE(sum(o.tax_free_amount - COALESCE(rf.tax_free, 0)) FILTER (WHERE date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')), 0)::int AS month_tax_free
      FROM orders o ${REFUNDED} WHERE o.status IN ${PAID} ${test}`),
    pool.query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(sum(${NET}), 0)::int AS sales, count(o.id)::int AS orders
      FROM generate_series(${TODAY} - ($1::int - 1), ${TODAY}, interval '1 day') AS d(day)
      LEFT JOIN orders o ON ${KST('o.paid_at')} = d.day AND o.status IN ${PAID} ${test}
      ${REFUNDED}
      GROUP BY d.day ORDER BY d.day`, [days]),
    // 농가별로 취소한 상품은 판매에서 뺀다
    pool.query(`SELECT oi.product_code, max(oi.name) AS name, sum(oi.quantity)::int AS quantity, sum(oi.subtotal)::int AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ${PAID} ${test} AND o.paid_at > now() - make_interval(days => $1)
        AND NOT EXISTS (SELECT 1 FROM order_shipments sh WHERE sh.order_id = o.id AND sh.seller_code = oi.seller_code AND sh.status = 'cancelled')
      GROUP BY oi.product_code ORDER BY quantity DESC, revenue DESC LIMIT 5`, [days]),
    pool.query(`SELECT product_code, name, stock FROM products WHERE status = 'active' AND stock <= $1 ORDER BY stock, name`, [LOW_STOCK]),
    pool.query(`SELECT
        -- 할 일은 농가 배송 기준: 여러 농가 주문은 한 농가만 보내도 주문 상태가 '배송 중'이라 주문 상태로 세면 빠진다.
        -- 예약 상품 배송은 출고 시작일 전까지 '예약 대기'로 따로 센다
        (SELECT count(DISTINCT sh.order_id) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
          WHERE sh.status = 'paid' AND o.status IN ('paid', 'preparing', 'shipping') AND (sh.ship_from IS NULL OR sh.ship_from <= ${TODAY}))::int AS to_prepare,
        (SELECT count(DISTINCT sh.order_id) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
          WHERE sh.status = 'preparing' AND o.status IN ('paid', 'preparing', 'shipping'))::int AS to_ship,
        (SELECT count(DISTINCT sh.order_id) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
          WHERE sh.status = 'paid' AND o.status IN ('paid', 'preparing', 'shipping') AND sh.ship_from > ${TODAY})::int AS preorders_waiting,
        (SELECT min(sh.ship_from) FROM order_shipments sh JOIN orders o ON o.id = sh.order_id
          WHERE sh.status = 'paid' AND o.status IN ('paid', 'preparing', 'shipping') AND sh.ship_from > ${TODAY}) AS next_ship_from,
        (SELECT count(*) FROM questions WHERE answer IS NULL AND NOT hidden)::int AS unanswered,
        (SELECT count(*) FROM b2b_inquiries WHERE status = '접수')::int AS new_b2b,
        (SELECT count(*) FROM products WHERE status = 'pending')::int AS pending_products,
        (SELECT count(*) FROM reviews WHERE reply IS NULL AND NOT hidden)::int AS reviews_to_reply,
        (SELECT count(*) FROM order_returns WHERE status = 'requested')::int AS returns_requested,
        (SELECT count(*) FROM order_returns WHERE status = 'approved')::int AS returns_to_refund,
        (SELECT count(*) FROM orders o WHERE o.status = 'cancelled' AND o.cancelled_at > now() - make_interval(days => $1) ${test})::int AS cancelled`, [days]),
  ])
  res.json({ days, includeTest: !test, summary: summary.rows[0], series: series.rows, top: top.rows, lowStock: low.rows, lowStockLimit: LOW_STOCK, todo: todo.rows[0] })
})
