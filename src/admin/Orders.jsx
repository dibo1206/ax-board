import { useCallback, useEffect, useState } from 'react'
import { CourierList } from '../shop/CourierList.jsx'
import { isPreorder, ORDER_STATUS, REFUND_KIND, RETURN_STATUS, shipDay, when, won } from '../shop/shared.js'
import { adminApi } from './api.js'

// 관리자 주문 관리: 결제 완료 → 배송 준비 → 배송 중(송장) → 배송 완료, 취소(결제 취소·재고 복구)
// 여러 농가 주문은 아직 보내지 않은 농가 몫만 취소할 수 있다 (그 농가 상품 금액 + 배송비를 토스 부분 취소로)
// 결제 완료·배송 준비는 농가 배송 기준: 여러 농가 주문에서 아직 준비 안 한(또는 송장 안 넣은) 농가가 있으면 나온다
const FILTERS = [['', '전체'], ['paid', '결제 완료 (준비 안 한 농가)'], ['preparing', '배송 준비 (송장 전)'], ['shipping', '배송 중'], ['delivered', '배송 완료'], ['cancelled', '취소']]
const NEXT = { paid: ['preparing', '배송 준비 시작'], preparing: ['shipping', '송장 넣고 배송 시작'], shipping: ['delivered', '배송 완료로'] }

const REFUND_STATUS = { requested: '결과 확인 중', done: '완료', failed: '실패(돈 안 나감)' }

// 농가 하나의 배송: 단계 버튼과 (배송 시작할 때) 택배사·송장 입력, 아직 안 보냈으면 이 농가만 취소
function ShipmentRow({ shipment, many, onRun, onCancel }) {
  const [courier, setCourier] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const next = NEXT[shipment.status]
  return (
    <li className="box">
      <p><b>{shipment.seller_name}</b> · {ORDER_STATUS[shipment.status] ?? shipment.status} · 상품 {won(shipment.items_amount)} · 배송비 {shipment.shipping_fee ? won(shipment.shipping_fee) : '무료'}
        {shipment.tracking_no && <> · {shipment.courier} {shipment.tracking_no}</>}
        {['paid', 'preparing'].includes(shipment.status) && isPreorder(shipment.ship_from) && <> · <span className="badge pending">예약 · {shipDay(shipment.ship_from)}부터 출고</span></>}</p>
      {next && (
        <div className="row form">
          {next[0] === 'shipping' && (
            <>
              <label>택배사<input value={courier} onChange={(e) => setCourier(e.target.value)} list="couriers" placeholder="골라 주세요" /></label>
              <CourierList />
              <label>송장 번호<input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} inputMode="numeric" /></label>
            </>
          )}
          <button type="button" className="button" disabled={shipment.cancel_pending} onClick={() => onRun({ status: next[0], courier, trackingNo, sellerCode: shipment.seller_code },
            `${many ? `${shipment.seller_name}: ` : ''}${ORDER_STATUS[next[0]]}`)}>{next[1]}</button>
        </div>
      )}
      {many && ['paid', 'preparing'].includes(shipment.status) && (
        shipment.cancel_pending
          ? <p className="warn">이 농가 취소의 결제 취소 결과를 확인하고 있어요. <button type="button" className="link" onClick={() => onCancel(shipment, true)}>다시 확인</button></p>
          : <button type="button" className="link" onClick={() => onCancel(shipment, false)}>이 농가만 취소 ({won(shipment.items_amount + shipment.shipping_fee)} 환불)</button>
      )}
    </li>
  )
}

function OrderPanel({ orderNo, onChanged, onClose }) {
  const [order, setOrder] = useState(null)
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
      // 결과를 모름(202)이면 화면을 새로 읽어 [다시 확인]을 보여 준다
      if (e.status === 202) adminApi(`/orders/${orderNo}`).then(setOrder).catch(() => {})
    }
  }

  // 이 농가만 취소: 사유를 받고 금액을 한 번 더 확인한 뒤 보낸다. 다시 확인은 같은 요청을 다시 보낸다 (돈은 한 번만 나간다)
  function cancelFarm(shipment, retry) {
    const amount = won(shipment.items_amount + shipment.shipping_fee)
    const reason = retry ? (order.refunds.find((r) => r.kind === 'cancel' && r.seller_code === shipment.seller_code && r.status === 'requested')?.reason ?? '').replace(/^관리자 취소: /, '') : window.prompt(`${shipment.seller_name} 몫 취소 사유 (손님에게 보여요)`)
    if (!reason?.trim()) return
    if (!retry && !window.confirm(`${shipment.seller_name} 상품 금액과 배송비 ${amount}을 손님 결제에서 바로 취소해요. 재고도 돌려놓아요.`)) return
    run(() => adminApi(`/orders/${orderNo}/shipments/${shipment.seller_code}/cancel`, { method: 'POST', body: { reason } }), `${orderNo}: ${shipment.seller_name} 몫 ${amount}을 취소했어요`)
  }

  if (!order) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  const many = order.shipments.length > 1
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
        {order.cancel_reason && <><dt>취소</dt><dd>{when(order.cancelled_at)} · {order.cancel_reason}</dd></>}
        {order.refunds.length > 0 && (
          <><dt>돌려준 돈</dt><dd>
            <ul>
              {order.refunds.map((r) => (
                <li key={r.id}>{REFUND_KIND[r.kind]}{r.seller_code && ` (${r.seller_code})`} · {won(r.amount)} · {REFUND_STATUS[r.status]} · {r.processed_by} · {when(r.done_at ?? r.created_at)}
                  {r.fail_reason && <span className="muted"> · {r.fail_reason}</span>}</li>
              ))}
            </ul>
            합계 {won(order.refunded_amount)} / 결제 {won(order.total_amount)}
          </dd></>
        )}
        {order.returns.length > 0 && (
          <><dt>반품</dt><dd>
            <ul>{order.returns.map((r) => <li key={r.id}>#{r.id} {r.seller_code} · {RETURN_STATUS[r.status]} · {when(r.created_at)} <span className="muted">([반품] 탭에서 처리)</span></li>)}</ul>
          </dd></>
        )}
      </dl>
      <ul className="order-items">
        {order.items.map((i) => <li key={`${i.product_code}:${i.option_name ?? ''}`}>{i.name}{i.option_name && ` · ${i.option_name}`} × {i.quantity} — {won(i.subtotal)} <span className="muted">({i.seller_code})</span></li>)}
        <li className="muted">상품 {won(order.items_amount)} + 배송비 {won(order.shipping_fee)}{many && ` (농가 ${order.shipments.length}곳)`}</li>
      </ul>
      <h4>{many ? '농가별 배송 (농가마다 따로 보내요)' : '배송'}</h4>
      <ul className="inbox">
        {order.shipments.map((s) => (
          <ShipmentRow key={s.seller_code} shipment={s} many={many} onCancel={cancelFarm}
            onRun={(body, text) => run(() => adminApi(`/orders/${orderNo}`, { method: 'PATCH', body }), `${orderNo} ${text}`)} />
        ))}
      </ul>
      {['paid', 'preparing'].includes(order.status) && !order.shipments.some((s) => ['shipping', 'delivered'].includes(s.status)) && (
        <div className="actions">
          <button type="button" className="button ghost" onClick={() => {
            const reason = window.prompt('취소 사유 (손님에게 보여요)')
            if (reason?.trim()) run(() => adminApi(`/orders/${orderNo}/cancel`, { method: 'POST', body: { reason } }), `${orderNo}: 취소하고 결제를 돌려드렸어요`)
          }}>{order.refunded_amount > 0 ? `주문 취소 (남은 ${won(order.total_amount - order.refunded_amount)} 환불)` : '주문 취소 (전액 환불)'}</button>
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
                <td>{won(o.total_amount)}{o.refunded > 0 && <><br /><span className="muted">−{won(o.refunded)} 돌려줌</span></>}{o.is_test && <><br /><span className="muted">테스트</span></>}</td>
                <td>{o.status === 'paid' ? <span className="badge pending">{ORDER_STATUS[o.status]}</span> : ORDER_STATUS[o.status]}
                  {o.farms > 1 && <><br /><span className="muted">농가 {o.farms}곳 · {o.farms_sent}곳 보냄{o.farms_waiting > 0 && o.status !== 'paid' && ` · ${o.farms_waiting}곳 준비 전`}</span></>}
                  {o.ship_from && <><br /><span className="badge pending">예약 · {shipDay(o.ship_from)}부터</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
