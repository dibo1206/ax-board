import { useCallback, useEffect, useRef, useState } from 'react'
import { ReviewForm } from './Reviews.jsx'
import { getPolicy, isPreorder, ORDER_STATUS, post, readCart, REFUND_KIND, RETURN_STATUS, shipDay, takePending, todayKst, when, won, writeCart } from './shared.js'

// 주문 결과(성공·실패) · 비회원 주문 조회 · 약관 페이지
// phone: 비회원 후기 쓰기에 쓰는 주문자 휴대폰 (회원은 로그인으로 확인)
// 반품 신청: 배송 완료된 농가 배송 하나에 사유와 돌려보낼 상품을 고른다. 기간·배송비 기준은 서버의 교환·환불 정책 값(/api/policy 의 returns)
// 신청만으로 환불되지 않고 담당자가 확인해 승인한 뒤 환불한다
function ReturnForm({ order, shipment, onSubmit, onClose }) {
  const [policy, setPolicy] = useState(null)
  const [reasonType, setReasonType] = useState('')
  const [reason, setReason] = useState('')
  const [picked, setPicked] = useState({}) // 주문 상품 순서 → 수량 (0이면 빼기)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getPolicy().then(setPolicy).catch(() => setPolicy(null))
  }, [])
  const today = todayKst()
  const canChangeMind = shipment.return_until_change_mind && today <= shipment.return_until_change_mind
  const lines = order.items.map((item, line) => ({ item, line })).filter(({ item }) => item.seller_code === shipment.seller_code)
  const quantity = (line, item) => picked[line] ?? item.quantity
  const fee = policy?.shipping.fee

  async function submit(event) {
    event.preventDefault()
    setError('')
    const chosen = lines.filter(({ line, item }) => quantity(line, item) > 0).map(({ line, item }) => ({ line, quantity: quantity(line, item) }))
    if (!reasonType) return setError('반품 사유 종류를 골라 주세요.')
    if (!chosen.length) return setError('돌려보낼 상품을 골라 주세요.')
    setBusy(true)
    try {
      await onSubmit({ sellerCode: shipment.seller_code, reasonType, reason, lines: chosen })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="box form" onSubmit={submit}>
      <h4>{shipment.seller_name} 상품 반품 신청</h4>
      <fieldset>
        <legend>사유 종류</legend>
        {Object.entries(policy?.returns.reasons ?? {}).map(([key, label]) => (
          <label key={key} className="check">
            <input type="radio" name="reasonType" value={key} checked={reasonType === key} disabled={key === 'change_mind' && !canChangeMind} onChange={() => setReasonType(key)} />
            {label}
            <span className="muted"> · {key === 'change_mind'
              ? `받은 날부터 ${policy.returns.changeMindDays}일 안 (${shipment.return_until_change_mind}까지)${canChangeMind ? '' : ' — 기간이 지났어요'}`
              : `받은 날부터 ${policy.returns.defectMonths}개월 안 (${shipment.return_until_defect}까지)`}</span>
          </label>
        ))}
      </fieldset>
      {reasonType === 'change_mind' && fee && (
        <p className="warn">단순 변심이면 왕복 배송비를 손님이 부담해요: 돌려보내는 배송비 {won(fee)}을 빼고{shipment.shipping_fee === 0 ? `, 처음 무료로 보낸 배송비 ${won(fee)}도 빼요` : ', 처음 낸 배송비는 돌려드리지 않아요'}. 신선식품은 단순 변심 반품이 제한될 수 있어요.</p>
      )}
      {reasonType && reasonType !== 'change_mind' && <p className="muted">상품 하자·오배송이면 배송비는 판매자가 부담해요. 받은 상품 사진을 고객센터로 주문번호와 함께 보내 주세요.</p>}
      <ul className="order-items">
        {lines.map(({ item, line }) => (
          <li key={line}>
            <label className="check">
              {item.name} ({item.option_name ?? item.unit})
              <select value={quantity(line, item)} onChange={(e) => setPicked((p) => ({ ...p, [line]: Number(e.target.value) }))}>
                {Array.from({ length: item.quantity + 1 }, (_, n) => <option key={n} value={n}>{n === 0 ? '빼기' : `${n}개`}</option>)}
              </select>
            </label>
          </li>
        ))}
      </ul>
      <label>사유 (5~500자)<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="어떤 문제가 있었는지 적어 주세요. 주민등록번호·카드번호는 쓰지 마세요." /></label>
      <p className="muted">신청만으로 환불되지는 않아요. 담당자가 확인해 승인한 뒤 돌려받은 상품을 보고 환불해요.</p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>반품 신청하기</button>
        <button type="button" className="button ghost" onClick={onClose}>닫기</button>
      </div>
    </form>
  )
}

// 농가별 반품 신청 상태와 [반품 신청] 버튼 (배송 완료된 농가 배송만)
function ReturnSection({ order, onReturn }) {
  const [open, setOpen] = useState(null)
  const today = todayKst()
  const delivered = (order.shipments ?? []).filter((s) => s.status === 'delivered')
  const returns = order.returns ?? []
  if (!delivered.length && !returns.length) return null
  return (
    <div className="returns">
      <h4>반품</h4>
      <ul className="farm-shipments">
        {returns.map((r, index) => (
          <li key={index}>
            <b>{r.seller_name}</b> · {RETURN_STATUS[r.status]} · {when(r.created_at)}
            <br /><span className="muted">{r.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')} · {r.reason}</span>
            {r.status === 'rejected' && r.admin_note && <><br /><span className="warn">거절 사유: {r.admin_note}</span></>}
            {r.status === 'approved' && <><br /><span className="muted">승인됐어요. 돌려받은 상품을 확인한 뒤 환불해요.{r.admin_note && ` 안내: ${r.admin_note}`}</span></>}
            {r.status === 'refunded' && <><br /><span className="success">{won(r.refund_amount)} 환불했어요 ({when(r.refunded_at)})</span></>}
          </li>
        ))}
      </ul>
      {onReturn && delivered.map((s) => {
        const busy = returns.some((r) => r.seller_code === s.seller_code && ['requested', 'approved'].includes(r.status))
        const inTime = s.return_until_defect && today <= s.return_until_defect
        if (busy || !inTime) return null
        return open === s.seller_code
          ? <ReturnForm key={s.seller_code} order={order} shipment={s} onSubmit={onReturn} onClose={() => setOpen(null)} />
          : <p key={s.seller_code}><button type="button" className="link" onClick={() => setOpen(s.seller_code)}>{s.seller_name} 상품 반품 신청</button></p>
      })}
    </div>
  )
}

// onConfirm: 배송 완료된 주문의 [구매 확정] (비회원 조회·마이페이지가 각자 주소로 넘겨준다)
// onReturn: 반품 신청 보내기 (비회원 조회·마이페이지가 각자 주소로 넘겨준다. 없으면 반품 신청 버튼을 안 보인다)
export function OrderDetail({ order, phone = '', onConfirm = null, onReturn = null }) {
  const [writing, setWriting] = useState(null)
  const [written, setWritten] = useState([])
  // 농가마다 따로 오니, 그 상품을 보낸 농가의 배송이 끝났으면 후기를 쓸 수 있다
  const arrived = (i) => order.status === 'delivered' || order.shipments?.some((s) => s.seller_code === i.seller_code && s.status === 'delivered')
  // 후기는 주문·상품마다 하나라서, 같은 상품을 옵션 여러 개로 샀으면 첫 줄에서만 쓴다
  const firstOf = (i, index) => order.items.findIndex((x) => x.product_code === i.product_code) === index
  const canReview = (i, index) => arrived(i) && !i.reviewed && !written.includes(i.product_code) && firstOf(i, index)
  return (
    <>
      <dl className="detail-list">
        <dt>주문번호</dt><dd><b>{order.order_no}</b></dd>
        <dt>상태</dt><dd>{ORDER_STATUS[order.status] ?? order.status}{order.is_test && <span className="badge pending"> 테스트 결제</span>}</dd>
        <dt>주문일</dt><dd>{when(order.created_at)}</dd>
        {order.payment_method && <><dt>결제</dt><dd>{order.payment_method} · {won(order.total_amount)}</dd></>}
        {/* 결제 완료 화면의 응답에는 받는 분·주소가 없다 (주문 조회에서 휴대폰 번호로 확인한 뒤에 보인다) */}
        {order.receiver_name && <><dt>받는 분</dt><dd>{order.receiver_name} · ({order.zipcode}) {order.address1} {order.address2 ?? ''}</dd></>}
        {/* 농가마다 따로 보낸다: 농가별 배송 상태·송장 (한 농가만이면 송장 한 줄) */}
        {order.shipments?.length > 1 ? (
          <><dt>배송</dt><dd>
            <ul className="farm-shipments">
              {order.shipments.map((s) => (
                <li key={s.seller_code}>
                  <b>{s.seller_name}</b> · {ORDER_STATUS[s.status] ?? s.status} · 배송비 {s.shipping_fee ? won(s.shipping_fee) : '무료'}
                  {['paid', 'preparing'].includes(s.status) && isPreorder(s.ship_from) && <> · <span className="badge pending">예약</span> {shipDay(s.ship_from)}부터 출고</>}
                  {s.tracking_no && <> · {s.courier} {s.tracking_no} {s.tracking_url && <a href={s.tracking_url} target="_blank" rel="noreferrer">배송 조회</a>}</>}
                </li>
              ))}
            </ul>
          </dd></>
        ) : order.tracking_no && <><dt>송장</dt><dd>{order.courier} {order.tracking_no} {order.tracking_url && <a href={order.tracking_url} target="_blank" rel="noreferrer">배송 조회</a>}</dd></>}
        {/* 출고 안내: 예약 상품이 있으면 농가별 출고 시작일, 아니면 결제 후 1~3일 (서버가 만든 문장) */}
        {order.shipping_note && ['paid', 'preparing'].includes(order.status) && <><dt>출고</dt><dd className="pre-line">{order.shipping_note}</dd></>}
        {order.cancel_reason && <><dt>취소</dt><dd>{when(order.cancelled_at)} · {order.cancel_reason}</dd></>}
        {(order.refunds?.length > 0 || order.refund_pending) && (
          <><dt>돌려받은 금액</dt><dd>
            <ul className="farm-shipments">
              {order.refunds.map((r, index) => <li key={index}>{REFUND_KIND[r.kind]}{r.seller_name && ` (${r.seller_name})`} · {won(r.amount)} · {when(r.done_at)}</li>)}
              {order.refund_pending && <li className="muted">결제 취소를 확인하고 있어요</li>}
            </ul>
          </dd></>
        )}
        {order.status === 'delivered' && (
          <><dt>구매 확정</dt><dd>{order.confirmed_at
            ? `${when(order.confirmed_at)} 확정했어요`
            : <>{onConfirm && <button type="button" className="link" onClick={onConfirm}>지금 구매 확정하기</button>} <span className="muted">배송 완료 7일 뒤 자동으로 확정돼요</span></>}</dd></>
        )}
      </dl>
      <ul className="order-items">
        {order.items.map((i, index) => (
          <li key={`${i.product_code}:${i.option_name ?? ''}`}>
            {i.name} ({i.option_name ?? i.unit}) × {i.quantity} — {won(i.subtotal)}
            {canReview(i, index) && writing !== i.product_code && <button type="button" className="link" onClick={() => setWriting(i.product_code)}> 후기 쓰기</button>}
            {written.includes(i.product_code) && firstOf(i, index) && <span className="success"> 후기를 남겼어요</span>}
            {writing === i.product_code && firstOf(i, index) && (
              <ReviewForm orderNo={order.order_no} phone={phone} item={i} onDone={() => { setWritten((w) => [...w, i.product_code]); setWriting(null) }} />
            )}
          </li>
        ))}
        <li className="muted">상품 {won(order.items_amount)} + 배송비 {won(order.shipping_fee)}{order.shipments?.length > 1 && ` (농가 ${order.shipments.length}곳)`} = <b>{won(order.total_amount)}</b>
          {order.refunded_amount > 0 && <> · 돌려받은 금액 {won(order.refunded_amount)}</>}</li>
      </ul>
      <ReturnSection order={order} onReturn={onReturn} />
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
    // 결제창에서 그냥 닫으면 orderId가 안 오기도 해서, 결제 시작할 때 저장해 둔 주문번호를 쓴다.
    // 실패 처리에는 주문을 만들 때 받은 결제용 표가 필요하다 (없으면 서버가 15분 정리 때 닫는다)
    const query = new URLSearchParams(window.location.search)
    const pending = takePending()
    const orderNo = query.get('orderId') ?? pending?.orderNo
    const token = pending?.orderNo === orderNo ? pending.payToken : null
    if (orderNo && token) post(`/orders/${encodeURIComponent(orderNo)}/fail`, { code: query.get('code'), message: query.get('message'), token }).catch(() => {})
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

  async function confirmPurchase() {
    if (!window.confirm('상품을 잘 받으셨나요? 구매를 확정해요.')) return
    try {
      setOrder(await post('/orders/lookup/purchase-confirm', { orderNo: order.order_no, phone }))
    } catch (e) {
      setError(e.message)
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
          <OrderDetail order={order} phone={phone} onConfirm={confirmPurchase}
            onReturn={async (body) => setOrder(await post('/orders/lookup/returns', { orderNo: order.order_no, phone, ...body }))} />
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
