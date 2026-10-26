import { useCallback, useEffect, useRef, useState } from 'react'
import { ReviewForm } from './Reviews.jsx'
import { getPolicy, ORDER_STATUS, post, readCart, takePending, when, won, writeCart } from './shared.js'

// 주문 결과(성공·실패) · 비회원 주문 조회 · 약관 페이지
// phone: 비회원 후기 쓰기에 쓰는 주문자 휴대폰 (회원은 로그인으로 확인)
export function OrderDetail({ order, phone = '' }) {
  const [writing, setWriting] = useState(null)
  const [written, setWritten] = useState([])
  const canReview = (i) => order.status === 'delivered' && !i.reviewed && !written.includes(i.product_code)
  return (
    <>
      <dl className="detail-list">
        <dt>주문번호</dt><dd><b>{order.order_no}</b></dd>
        <dt>상태</dt><dd>{ORDER_STATUS[order.status] ?? order.status}{order.is_test && <span className="badge pending"> 테스트 결제</span>}</dd>
        <dt>주문일</dt><dd>{when(order.created_at)}</dd>
        {order.payment_method && <><dt>결제</dt><dd>{order.payment_method} · {won(order.total_amount)}</dd></>}
        <dt>받는 분</dt><dd>{order.receiver_name} · ({order.zipcode}) {order.address1} {order.address2 ?? ''}</dd>
        {order.tracking_no && <><dt>송장</dt><dd>{order.courier} {order.tracking_no} {order.tracking_url && <a href={order.tracking_url} target="_blank" rel="noreferrer">배송 조회</a>}</dd></>}
        {order.cancel_reason && <><dt>취소</dt><dd>{when(order.cancelled_at)} · {order.cancel_reason}</dd></>}
      </dl>
      <ul className="order-items">
        {order.items.map((i) => (
          <li key={i.product_code}>
            {i.name} ({i.unit}) × {i.quantity} — {won(i.subtotal)}
            {canReview(i) && writing !== i.product_code && <button type="button" className="link" onClick={() => setWriting(i.product_code)}> 후기 쓰기</button>}
            {written.includes(i.product_code) && <span className="success"> 후기를 남겼어요</span>}
            {writing === i.product_code && (
              <ReviewForm orderNo={order.order_no} phone={phone} item={i} onDone={() => { setWritten((w) => [...w, i.product_code]); setWriting(null) }} />
            )}
          </li>
        ))}
        <li className="muted">상품 {won(order.items_amount)} + 배송비 {won(order.shipping_fee)} = <b>{won(order.total_amount)}</b></li>
      </ul>
    </>
  )
}

export function OrderSuccess() {
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState('') // 결과를 아직 모름 (끊김·지연): 다시 확인 버튼
  const [checking, setChecking] = useState(true)
  const started = useRef(false)
  const pending = useRef(null)

  // 같은 승인 요청을 여러 번 보내도 서버와 결제사가 한 번만 처리하니, 끊기면 그냥 다시 보내면 된다
  const confirm = useCallback(async () => {
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('orderId') ?? ''
    setChecking(true)
    setRetry('')
    try {
      const o = await post(`/orders/${encodeURIComponent(orderId)}/confirm`, { paymentKey: params.get('paymentKey'), amount: Number(params.get('amount')) }, 45_000)
      setOrder(o)
      // 장바구니에서 주문했으면 주문한 상품을 장바구니에서 뺀다
      if (pending.current?.orderNo === orderId && pending.current.fromCart) {
        const bought = new Set(o.items.map((i) => i.product_code))
        writeCart(readCart().filter((i) => !bought.has(i.productCode)))
      }
    } catch (e) {
      if (e.pending || e.network || e.status === 503 || e.status === 504) setRetry(e.message)
      else setError(e.message)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    pending.current = takePending()
    confirm()
  }, [confirm])

  if (retry) {
    return (
      <section className="box">
        <h2>결제를 확인하고 있어요</h2>
        <p className="warn">{retry}</p>
        <p className="muted">주문번호 {new URLSearchParams(window.location.search).get('orderId')} · 결제가 승인됐다면 [주문 조회]에서도 확인할 수 있어요.</p>
        <div className="actions">
          <button type="button" className="button" onClick={confirm} disabled={checking}>{checking ? '확인 중…' : '다시 확인'}</button>
          <a className="button ghost" href="/order/lookup">주문 조회</a>
        </div>
      </section>
    )
  }
  if (error) {
    return (
      <section className="box">
        <h2>결제를 완료하지 못했어요</h2>
        <p className="error">{error}</p>
        <p className="muted">결제가 승인되지 않았다면 돈은 나가지 않았어요. 문제가 계속되면 고객센터로 알려 주세요.</p>
        <a className="button" href="/cart">장바구니로</a>
      </section>
    )
  }
  if (!order) return <p className="muted">결제를 확인하는 중이에요. 이 화면을 닫지 마세요…</p>
  return (
    <section className="box">
      <h2>주문이 완료됐어요</h2>
      <p>주문번호와 휴대폰 번호로 언제든 [주문 조회]에서 확인할 수 있어요. 주문번호를 꼭 적어 두세요.</p>
      <OrderDetail order={order} />
      <div className="actions">
        <a className="button" href="/order/lookup">주문 조회</a>
        <a className="button ghost" href="/">쇼핑 계속하기</a>
      </div>
    </section>
  )
}

export function OrderFail() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const message = params.get('message')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // 결제창에서 그냥 닫으면 orderId가 안 오기도 해서, 결제 시작할 때 저장해 둔 주문번호를 쓴다
    const query = new URLSearchParams(window.location.search)
    const orderNo = query.get('orderId') ?? takePending()?.orderNo
    if (orderNo) post(`/orders/${encodeURIComponent(orderNo)}/fail`, { code: query.get('code'), message: query.get('message') }).catch(() => {})
  }, [])

  const canceled = code === 'PAY_PROCESS_CANCELED'
  return (
    <section className="box">
      <h2>{canceled ? '결제를 취소했어요' : '결제하지 못했어요'}</h2>
      {!canceled && message && <p className="error">{message}</p>}
      <p className="muted">돈은 나가지 않았고, 잡아 두었던 재고는 돌려놓았어요. 장바구니에서 다시 주문할 수 있어요.</p>
      <a className="button" href="/cart">장바구니로</a>
    </section>
  )
}

export function OrderLookup() {
  const [orderNo, setOrderNo] = useState('')
  const [phone, setPhone] = useState('')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function lookup(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setOrder(await post('/orders/lookup', { orderNo: orderNo.trim(), phone }))
    } catch (e) {
      setOrder(null)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    const reason = window.prompt('취소 이유를 적어 주세요 (선택)') ?? null
    if (reason === null) return
    setBusy(true)
    try {
      setOrder(await post('/orders/lookup/cancel', { orderNo: order.order_no, phone, reason }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>주문 조회</h2>
      <p className="muted">회원은 <a href="/account">마이페이지</a>에서 주문 내역을 볼 수 있어요. 비회원은 주문번호와 휴대폰 번호로 조회해요.</p>
      <form className="box form" onSubmit={lookup}>
        <div className="row">
          <label>주문번호<input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="FM261024-XXXXXXXXXX" /></label>
          <label>주문자 휴대폰<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" inputMode="tel" /></label>
        </div>
        <button type="submit" className="button" disabled={busy}>조회하기</button>
      </form>
      {error && <p className="error">{error}</p>}
      {order && (
        <div className="box">
          <OrderDetail order={order} phone={phone} />
          {order.status === 'paid' && (
            <div className="actions">
              <button type="button" className="button ghost" onClick={cancel} disabled={busy}>주문 취소하기</button>
              <span className="muted">배송 준비 전이라 바로 취소하고 결제를 돌려드려요.</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function Policy({ kind }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    getPolicy().then(setData).catch(() => setData({ policies: {} }))
  }, [])
  if (!data) return <p className="muted">불러오는 중…</p>
  const policy = data.policies[kind]
  if (!policy) return <p className="error">없는 페이지예요.</p>
  return (
    <article className="box policy">
      <h2>{policy.title}</h2>
      <p className="warn">초안이에요. 기업 확인과 법률 검토 후 확정해요.</p>
      {policy.sections.map(([title, body]) => (
        <section key={title}>
          <h3>{title}</h3>
          <p>{body}</p>
        </section>
      ))}
    </article>
  )
}
