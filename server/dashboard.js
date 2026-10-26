// 관리자 매출 화면: 오늘·이번 달 매출, 최근 30일 날짜별 매출, 많이 팔린 상품, 재고 부족, 할 일
// 매출 = 결제 완료 이후 상태(결제 완료·배송 준비·배송 중·배송 완료)의 결제 금액. 날짜는 한국 시간 기준
import express from 'express'
import { requireAdmin } from './auth.js'
import { pool } from './db.js'

const PAID = "('paid', 'preparing', 'shipping', 'delivered')"
const KST = (column) => `(${column} AT TIME ZONE 'Asia/Seoul')::date`
const TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"
const LOW_STOCK = 5

export const dashboardRouter = express.Router()
dashboardRouter.use(requireAdmin)

dashboardRouter.get('/', async (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30))
  // 테스트 결제 주문까지 셀지 (개발 중엔 모든 주문이 테스트 결제라 기본은 포함)
  const test = req.query.test === '0' ? 'AND NOT o.is_test' : ''
  const [summary, series, top, low, todo] = await Promise.all([
    pool.query(`SELECT
        COALESCE(sum(total_amount) FILTER (WHERE ${KST('o.paid_at')} = ${TODAY}), 0)::int AS today_sales,
        count(*) FILTER (WHERE ${KST('o.paid_at')} = ${TODAY})::int AS today_orders,
        COALESCE(sum(total_amount) FILTER (WHERE date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')), 0)::int AS month_sales,
        count(*) FILTER (WHERE date_trunc('month', o.paid_at AT TIME ZONE 'Asia/Seoul') = date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'))::int AS month_orders
      FROM orders o WHERE o.status IN ${PAID} ${test}`),
    pool.query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(sum(o.total_amount), 0)::int AS sales, count(o.id)::int AS orders
      FROM generate_series(${TODAY} - ($1::int - 1), ${TODAY}, interval '1 day') AS d(day)
      LEFT JOIN orders o ON ${KST('o.paid_at')} = d.day AND o.status IN ${PAID} ${test}
      GROUP BY d.day ORDER BY d.day`, [days]),
    pool.query(`SELECT oi.product_code, max(oi.name) AS name, sum(oi.quantity)::int AS quantity, sum(oi.subtotal)::int AS revenue
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ${PAID} ${test} AND o.paid_at > now() - make_interval(days => $1)
      GROUP BY oi.product_code ORDER BY quantity DESC, revenue DESC LIMIT 5`, [days]),
    pool.query(`SELECT product_code, name, stock FROM products WHERE status = 'active' AND stock <= $1 ORDER BY stock, name`, [LOW_STOCK]),
    pool.query(`SELECT
        (SELECT count(*) FROM orders WHERE status = 'paid')::int AS to_prepare,
        (SELECT count(*) FROM orders WHERE status = 'preparing')::int AS to_ship,
        (SELECT count(*) FROM questions WHERE answer IS NULL AND NOT hidden)::int AS unanswered,
        (SELECT count(*) FROM b2b_inquiries WHERE status = '접수')::int AS new_b2b,
        (SELECT count(*) FROM products WHERE status = 'pending')::int AS pending_products,
        (SELECT count(*) FROM reviews WHERE reply IS NULL AND NOT hidden)::int AS reviews_to_reply,
        (SELECT count(*) FROM orders o WHERE o.status = 'cancelled' AND o.cancelled_at > now() - make_interval(days => $1) ${test})::int AS cancelled`, [days]),
  ])
  res.json({ days, includeTest: !test, summary: summary.rows[0], series: series.rows, top: top.rows, lowStock: low.rows, lowStockLimit: LOW_STOCK, todo: todo.rows[0] })
})
