import { useCallback, useEffect, useState } from 'react'
import { CourierList } from '../shop/CourierList.jsx'
import { ORDER_STATUS, when, won } from '../shop/shared.js'
import { adminApi } from './api.js'

// 관리자 주문 관리: 결제 완료 → 배송 준비 → 배송 중(송장) → 배송 완료, 취소(결제 취소·재고 복구)
const FILTERS = [['', '전체'], ['paid', '결제 완료'], ['preparing', '배송 준비'], ['shipping', '배송 중'], ['delivered', '배송 완료'], ['cancelled', '취소']]
const NEXT = { paid: ['preparing', '배송 준비 시작'], preparing: ['shipping', '송장 넣고 배송 시작'], shipping: ['delivered', '배송 완료로'] }

function OrderPanel({ orderNo, onChanged, onClose }) {
  const [order, setOrder] = useState(null)
  const [courier, setCourier] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi(`/orders/${orderNo}`).then(setOrder).catch((e) => setError(e.message))
  }, [orderNo])

  async function run(request, text) {
    setError('')
    try {
      setOrder(await request())
      onChanged(text)
    } catch (e) {
      setError(e.message)
    }
  }

  if (!order) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  const next = NEXT[order.status]
  return (
    <div className="box">
      <div className="admin-head">
        <h3>주문 {order.order_no}</h3>
        <button type="button" className="link" onClick={onClose}>목록으로</button>
      </div>
      <dl className="detail-list">
        <dt>상태</dt><dd>{ORDER_STATUS[order.status]}{order.is_test && ' · 테스트 결제'}</dd>
        <dt>결제</dt><dd>{won(order.total_amount)} · {order.payment_method ?? '-'} · {when(order.paid_at)}</dd>
        <dt>주문자</dt><dd>{order.buyer_name} · {order.buyer_phone}</dd>
        <dt>받는 분</dt><dd>{order.receiver_name} · {order.receiver_phone}</dd>
        <dt>주소</dt><dd>({order.zipcode}) {order.address1} {order.address2 ?? ''}</dd>
        {order.memo && <><dt>메모</dt><dd>{order.memo}</dd></>}
        {order.tracking_no && <><dt>송장</dt><dd>{order.courier} {order.tracking_no}</dd></>}
        {order.cancel_reason && <><dt>취소</dt><dd>{when(order.cancelled_at)} · {order.cancel_reason}</dd></>}
      </dl>
      <ul className="order-items">
        {order.items.map((i) => <li key={i.product_code}>{i.name} × {i.quantity} — {won(i.subtotal)} <span className="muted">({i.seller_code})</span></li>)}
        <li className="muted">상품 {won(order.items_amount)} + 배송비 {won(order.shipping_fee)}</li>
      </ul>
      {next && (
        <div className="form">
          {next[0] === 'shipping' && (
            <div className="row">
              <label>택배사<input value={courier} onChange={(e) => setCourier(e.target.value)} list="couriers" placeholder="골라 주세요" /></label>
              <CourierList />
              <label>송장 번호<input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} inputMode="numeric" /></label>
            </div>
          )}
          <div className="actions">
            <button type="button" className="button" onClick={() => run(() => adminApi(`/orders/${orderNo}`, { method: 'PATCH', body: { status: next[0], courier, trackingNo } }), `${orderNo}: ${ORDER_STATUS[next[0]]}`)}>{next[1]}</button>
            {['paid', 'preparing'].includes(order.status) && (
              <button type="button" className="button ghost" onClick={() => {
                const reason = window.prompt('취소 사유 (손님에게 보여요)')
                if (reason?.trim()) run(() => adminApi(`/orders/${orderNo}/cancel`, { method: 'POST', body: { reason } }), `${orderNo}: 취소하고 결제를 돌려드렸어요`)
              }}>주문 취소 (전액 환불)</button>
            )}
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function Orders({ onCount }) {
  const [status, setStatus] = useState('')
  const [orders, setOrders] = useState(null)
  const [open, setOpen] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    adminApi(`/orders${status ? `?status=${status}` : ''}`).then(setOrders).catch((e) => setError(e.message))
  }, [status])
  useEffect(load, [load])

  function changed(text) {
    setMessage(text)
    load()
    adminApi('/inquiries/summary').then(onCount).catch(() => {})
  }

  if (open) return <><OrderPanel orderNo={open} onChanged={changed} onClose={() => setOpen(null)} />{message && <p className="success">{message}</p>}</>
  return (
    <section>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <nav className="tabs">
        {FILTERS.map(([value, label]) => <button key={label} type="button" className={status === value ? 'on' : ''} onClick={() => setStatus(value)}>{label}</button>)}
      </nav>
      {!orders ? <p className="muted">불러오는 중…</p> : orders.length === 0 ? <p className="muted">주문이 없어요.</p> : (
        <table className="table">
          <thead><tr><th>주문</th><th>상품</th><th>금액</th><th>상태</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.order_no}>
                <td><button type="button" className="link" onClick={() => { setOpen(o.order_no); setMessage('') }}>{o.order_no}</button><br /><span className="muted">{when(o.created_at)} · {o.receiver_name}</span></td>
                <td>{o.summary}</td>
                <td>{won(o.total_amount)}{o.is_test && <><br /><span className="muted">테스트</span></>}</td>
                <td>{o.status === 'paid' ? <span className="badge pending">{ORDER_STATUS[o.status]}</span> : ORDER_STATUS[o.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
