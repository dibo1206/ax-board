import { useEffect, useRef, useState } from 'react'
import { Totals } from './Cart.jsx'
import { getAccount, loadScript, MAX_QTY, optionLabel, post, readCart, savePending, won } from './shared.js'
import { useCartLines } from './useCartLines.js'

// 주문서 → (주문 만들기: 서버가 금액 계산·재고 잡아 둠) → 결제 단계(토스 결제위젯)
const POSTCODE_SDK = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
const TOSS_SDK = 'https://js.tosspayments.com/v2/standard'

// 바로 구매: /checkout?item=상품코드&option=옵션번호&qty=수량 (옵션 없는 상품은 option 없이)
function buyNowLine() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('item')
  const qty = Number(params.get('qty') || 1)
  const option = Number(params.get('option'))
  return code ? [{ productCode: code, optionId: Number.isInteger(option) && option > 0 ? option : null, quantity: Number.isInteger(qty) && qty > 0 ? Math.min(qty, MAX_QTY) : 1 }] : null
}

function PaymentStep({ order, buyer }) {
  const widgets = useRef(null)
  const started = useRef(false)
  const [ready, setReady] = useState(order.payment.mode !== 'toss')
  const [error, setError] = useState('')

  useEffect(() => {
    if (order.payment.mode !== 'toss' || started.current) return
    started.current = true // 개발 모드에서 두 번 그려지는 것 방지 (결제위젯은 한 번만 그린다)
    ;(async () => {
      await loadScript(TOSS_SDK)
      const toss = window.TossPayments(order.payment.clientKey)
      const w = toss.widgets({ customerKey: window.TossPayments.ANONYMOUS })
      await w.setAmount({ currency: 'KRW', value: order.amount })
      await Promise.all([
        w.renderPaymentMethods({ selector: '#payment-method', variantKey: 'DEFAULT' }),
        w.renderAgreement({ selector: '#payment-agreement' }),
      ])
      widgets.current = w
      setReady(true)
    })().catch((e) => setError(`결제창을 불러오지 못했어요. ${e.message}`))
  }, [order])

  async function pay() {
    setError('')
    if (order.payment.mode === 'mock') {
      // 개발용 테스트 결제: 결제창 없이 결제 완료 화면으로 (서버도 테스트 결제로만 승인)
      const query = new URLSearchParams({ paymentKey: `mock_${order.orderNo}`, orderId: order.orderNo, amount: order.amount })
      window.location.href = `/order/success?${query}`
      return
    }
    try {
      await widgets.current.requestPayment({
        orderId: order.orderNo,
        orderName: order.orderName,
        successUrl: `${window.location.origin}/order/success`,
        failUrl: `${window.location.origin}/order/fail`,
        customerName: buyer.name,
        customerMobilePhone: buyer.phone,
      })
    } catch (e) {
      setError(e.message || '결제를 진행하지 못했어요.')
    }
  }

  return (
    <section className="box">
      <h3>결제</h3>
      <p>주문번호 <b>{order.orderNo}</b> · {order.orderName}</p>
      <p className="price">{won(order.amount)} <span className="muted">(상품 {won(order.itemsAmount)} + 배송비 {won(order.shippingFee)}{order.farms > 1 && ` · 농가 ${order.farms}곳에서 따로 보내요`})</span></p>
      {order.payment.test && <p className="warn">테스트 결제예요. 실제로 돈이 나가지 않아요.</p>}
      {order.payment.mode === 'toss' ? <><div id="payment-method" /><div id="payment-agreement" /></> : <p className="muted">결제 키가 아직 없어서 개발용 테스트 결제로 진행해요.</p>}
      {error && <p className="error">{error}</p>}
      <p className="muted">15분 안에 결제하지 않으면 주문이 취소돼요.</p>
      <button type="button" className="button" onClick={pay} disabled={!ready}>{ready ? `${won(order.amount)} 결제하기` : '결제창 준비 중…'}</button>
    </section>
  )
}

export function Checkout() {
  const [buyNow] = useState(buyNowLine)
  const [lines] = useState(() => buyNow ?? readCart())
  const cart = useCartLines(lines)
  const [form, setForm] = useState({
    buyerName: '', buyerPhone: '', same: true, receiverName: '', receiverPhone: '',
    zipcode: '', address1: '', address2: '', memo: '', email: '', saveAddress: false, agreeTerms: false, agreePrivacy: false,
  })
  const [account, setAccount] = useState(null)

  // 회원이면 이름·휴대폰·기본 배송지를 채워 둔다
  useEffect(() => {
    getAccount().then((me) => {
      if (!me) return
      setAccount(me)
      setForm((prev) => ({
        ...prev, buyerName: prev.buyerName || me.name, buyerPhone: prev.buyerPhone || me.phone,
        zipcode: prev.zipcode || me.zipcode || '', address1: prev.address1 || me.address1 || '', address2: prev.address2 || me.address2 || '',
        saveAddress: !me.address1,
      }))
    })
  }, [])
  const [errors, setErrors] = useState([])
  const [sending, setSending] = useState(false)
  const [order, setOrder] = useState(null)

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function findAddress() {
    try {
      await loadScript(POSTCODE_SDK)
      new window.daum.Postcode({
        oncomplete: (data) => setForm((prev) => ({ ...prev, zipcode: data.zonecode, address1: data.roadAddress || data.jibunAddress })),
      }).open()
    } catch {
      setErrors(['주소 검색을 열지 못했어요. 우편번호와 주소를 직접 적어 주세요.'])
    }
  }

  async function submit(event) {
    event.preventDefault()
    setSending(true)
    setErrors([])
    try {
      const body = {
        ...form,
        receiverName: form.same ? form.buyerName : form.receiverName,
        receiverPhone: form.same ? form.buyerPhone : form.receiverPhone,
        items: cart.ok.map((r) => ({ productCode: r.productCode, optionId: r.optionId, quantity: r.quantity })),
      }
      const created = await post('/orders', body)
      savePending({ orderNo: created.orderNo, fromCart: !buyNow })
      setOrder(created)
      window.scrollTo({ top: 0 })
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setSending(false)
    }
  }

  if (cart.error) return <p className="error">{cart.error}</p>
  if (cart.loading) return <p className="muted">불러오는 중…</p>
  if (order) return <PaymentStep order={order} buyer={{ name: form.buyerName, phone: form.buyerPhone.replace(/[^0-9]/g, '') }} />
  if (!cart.ok.length) return <div className="box"><p>주문할 상품이 없어요.</p><a className="button" href="/cart">장바구니로</a></div>

  return (
    <form className="checkout" onSubmit={submit}>
      <h2>주문서</h2>
      <section className="box">
        <h3>주문 상품</h3>
        <ul>{cart.ok.map((r) => <li key={`${r.productCode}:${r.optionId ?? ''}`}>{optionLabel(r.product.name, r.option?.name)} × {r.quantity} — {won(r.subtotal)}</li>)}</ul>
        {cart.rows.length > cart.ok.length && <p className="warn">품절·재고 부족 상품은 빠졌어요.</p>}
        <Totals {...cart} />
      </section>
      <section className="box form">
        <h3>주문하는 분</h3>
        <div className="row">
          <label>이름*<input value={form.buyerName} onChange={set('buyerName')} maxLength={20} autoComplete="name" /></label>
          <label>휴대폰*<input value={form.buyerPhone} onChange={set('buyerPhone')} placeholder="010-1234-5678" inputMode="tel" autoComplete="tel" /></label>
        </div>
        {account ? (
          <p className="muted">{account.email}로 주문 알림을 보내 드려요. 주문 내역은 마이페이지에서 볼 수 있어요.</p>
        ) : (
          <>
            <label>이메일 <span className="muted">(선택) 주문·발송 알림을 받고 싶을 때</span><input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
            <p className="muted">비회원은 주문번호와 휴대폰 번호로 주문을 조회해요. <a href="/account/login?next=/checkout">로그인</a>하면 주문 내역이 저장돼요.</p>
          </>
        )}
      </section>
      <section className="box form">
        <h3>받는 분</h3>
        <label className="check"><input type="checkbox" checked={form.same} onChange={set('same')} />주문하는 분과 같아요</label>
        {!form.same && (
          <div className="row">
            <label>이름*<input value={form.receiverName} onChange={set('receiverName')} maxLength={20} /></label>
            <label>연락처*<input value={form.receiverPhone} onChange={set('receiverPhone')} inputMode="tel" /></label>
          </div>
        )}
        <div className="row">
          <label>우편번호*<input value={form.zipcode} onChange={set('zipcode')} inputMode="numeric" maxLength={5} /></label>
          <button type="button" className="button ghost" onClick={findAddress}>주소 검색</button>
        </div>
        <label>주소*<input value={form.address1} onChange={set('address1')} maxLength={100} /></label>
        <label>상세 주소<input value={form.address2} onChange={set('address2')} maxLength={60} /></label>
        <label>배송 메모<input value={form.memo} onChange={set('memo')} maxLength={100} placeholder="예: 문 앞에 두세요" /></label>
        {account && <label className="check"><input type="checkbox" checked={form.saveAddress} onChange={set('saveAddress')} />이 주소를 기본 배송지로 저장</label>}
      </section>
      <section className="box form">
        <label className="check"><input type="checkbox" checked={form.agreeTerms} onChange={set('agreeTerms')} />[필수] 주문 상품과 결제 금액을 확인했고, <a href="/policy/terms" target="_blank" rel="noreferrer">이용약관</a>·<a href="/policy/refund" target="_blank" rel="noreferrer">교환·환불 정책</a>에 동의해요</label>
        <label className="check"><input type="checkbox" checked={form.agreePrivacy} onChange={set('agreePrivacy')} />[필수] 배송을 위한 <a href="/policy/privacy" target="_blank" rel="noreferrer">개인정보 수집·이용</a>에 동의해요 (이름·휴대폰·주소, 법에 따라 5년 보관)</label>
      </section>
      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <button type="submit" className="button" disabled={sending}>{sending ? '주문 만드는 중…' : `${won(cart.total)} 결제하러 가기`}</button>
    </form>
  )
}
