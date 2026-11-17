import { useEffect, useState } from 'react'
import { won } from '../shop/shared.js'
import { adminApi } from './api.js'
import { StatTile } from './ui.jsx'

// 관리자 홈 (2026-11-08 정리): 맨 위 '오늘 할 일' 카드(누르면 그 화면으로) → 매출 숫자 → 날짜별 매출 막대 → 재고 부족 · 많이 팔린 상품
const short = (n) => (n >= 10_000 ? `${Math.round(n / 1000) / 10}만` : n.toLocaleString('ko-KR'))
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`

// 0부터 시작하는 깔끔한 눈금 최댓값 (1, 2, 5 × 10ⁿ)
function niceMax(max) {
  if (max <= 0) return 10_000
  const power = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 5, 10].map((m) => m * power).find((v) => v >= max)
}

// 위쪽 모서리만 4px 둥근 막대 (바닥은 각지게, 기준선에서 자란다)
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

function SalesChart({ series }) {
  const [hover, setHover] = useState(null)
  const W = 720
  const H = 220
  const M = { top: 12, right: 8, bottom: 26, left: 52 }
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const top = niceMax(Math.max(...series.map((d) => d.sales)))
  const slot = plotW / series.length
  const barW = Math.min(24, Math.max(2, slot - 2)) // 막대 사이 2px 이상 띄우기
  const y = (v) => M.top + plotH - (v / top) * plotH
  const ticks = [0, top / 2, top]
  const labelEvery = Math.ceil(series.length / 6)

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 ${series.length}일 날짜별 매출 막대그래프`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="axis">{short(t)}</text>
          </g>
        ))}
        {series.map((d, i) => {
          const x = M.left + i * slot + (slot - barW) / 2
          const h = (d.sales / top) * plotH
          return (
            <g key={d.day}>
              {h > 0 && <path d={barPath(x, M.top + plotH - h, barW, h)} className={`bar${hover === i ? ' on' : ''}`} />}
              {/* 마우스 감지 영역은 막대보다 넓게: 그날 칸 전체 */}
              <rect x={M.left + i * slot} y={M.top} width={slot} height={plotH} className="hit" tabIndex={0}
                aria-label={`${md(d.day)} 매출 ${won(d.sales)}, 주문 ${d.orders}건`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              {(i % labelEvery === 0 || i === series.length - 1) && (
                <text x={M.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="axis">{md(d.day)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((M.left + hover * slot + slot / 2) / W) * 100}%` }}>
          <b>{md(series[hover].day)}</b><br />{won(series[hover].sales)} · {series[hover].orders}건
        </div>
      )}
    </div>
  )
}

export function Dashboard({ onGo }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [test, setTest] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    adminApi(`/dashboard?days=${days}&test=${test ? 1 : 0}`)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [days, test])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">불러오는 중…</p>
  const { summary, series, top, lowStock, todo } = data
  const periodSales = series.reduce((sum, d) => sum + d.sales, 0)
  // 할 일: 지금 손이 가야 하는 것만 큰 카드로. 0개인 일은 숨기고, 급한 순서(주문 → 손님 → 상품)
  const tasks = [
    ['orders', '배송 준비할 주문', todo.to_prepare, 'amber'],
    ['orders', '송장 넣을 주문', todo.to_ship, 'amber'],
    ['returns', '확인할 반품 신청', todo.returns_requested, 'red'],
    ['returns', '환불 기다리는 반품', todo.returns_to_refund, 'red'],
    ['inbox', '답변 기다리는 문의', todo.unanswered, 'blue'],
    ['inbox', '새 기업 문의', todo.new_b2b, 'blue'],
    ['products', '검토 대기 상품', todo.pending_products, 'amber'],
    ['reviews', '답글 안 단 후기', todo.reviews_to_reply, 'blue'],
    ['orders', '예약 대기 주문', todo.preorders_waiting, 'green', todo.next_ship_from ? `가장 빠른 출고 ${todo.next_ship_from.slice(5).replace('-', '/')}` : ''],
  ].filter(([, , n]) => n > 0)

  return (
    <section className="dashboard">
      {tasks.length === 0 ? (
        <p className="todo-clear">밀린 일이 없어요. 새 주문·문의가 오면 여기에 바로 보여요.</p>
      ) : (
        <div className="todo-grid">
          {tasks.map(([tab, label, n, tone, hint]) => <StatTile key={label} label={label} value={n} tone={tone} hint={hint || '눌러서 처리하기 →'} onClick={() => onGo(tab)} />)}
        </div>
      )}

      <div className="dash-head">
        <h3>매출</h3>
        <div className="filters">
          {[7, 30, 90].map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>최근 {n}일</button>)}
          <label className="check"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />테스트 결제 포함</label>
        </div>
      </div>
      <div className="tiles">
        <div className="tile"><span className="muted">오늘 매출</span><b>{won(summary.today_sales)}</b><span className="muted">주문 {summary.today_orders}건</span></div>
        <div className="tile"><span className="muted">이번 달 매출</span><b>{won(summary.month_sales)}</b><span className="muted">주문 {summary.month_orders}건{summary.month_refunded > 0 && ` · 취소·환불 ${won(summary.month_refunded)} 뺌`}</span>
          <span className="muted">면세 {won(summary.month_tax_free)} · 과세 {won(summary.month_sales - summary.month_tax_free)} (배송비 포함)</span></div>
        <div className="tile"><span className="muted">최근 {days}일 매출</span><b>{won(periodSales)}</b><span className="muted">취소 {todo.cancelled}건</span></div>
      </div>

      <div className="box">
        <h3>날짜별 매출 <span className="muted">결제 완료 기준 · 취소·반품 환불은 결제한 날에서 뺌</span></h3>
        {periodSales === 0 ? <p className="muted">이 기간에 결제된 주문이 없어요.</p> : <SalesChart series={series} />}
        <details>
          <summary>표로 보기</summary>
          <table className="table">
            <thead><tr><th>날짜</th><th>매출</th><th>주문</th></tr></thead>
            <tbody>{series.filter((d) => d.orders > 0).map((d) => <tr key={d.day}><td>{d.day}</td><td>{won(d.sales)}</td><td>{d.orders}건</td></tr>)}</tbody>
          </table>
        </details>
      </div>

      <div className="two">
        <div className="box">
          <h3>재고 부족 <span className="muted">{data.lowStockLimit}개 이하</span></h3>
          {lowStock.length === 0 ? <p className="muted">없어요.</p> : (
            <ul className="tasks">{lowStock.map((p) => <li key={p.product_code}>{p.name} <b className={p.stock === 0 ? 'error' : 'warn'}>{p.stock === 0 ? '품절' : `${p.stock}개`}</b></li>)}</ul>
          )}
        </div>
        <div className="box">
          <h3>많이 팔린 상품 <span className="muted">최근 {days}일</span></h3>
          {top.length === 0 ? <p className="muted">아직 판매가 없어요.</p> : (
            <ul className="tasks">{top.map((p) => <li key={p.product_code}>{p.name} <b>{p.quantity}개 · {won(p.revenue)}</b></li>)}</ul>
          )}
        </div>
      </div>
    </section>
  )
}
