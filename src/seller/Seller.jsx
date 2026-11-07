import { useEffect, useState } from 'react'
import { Login } from '../admin/Admin.jsx'
import { adminApi, sellerApi } from '../admin/api.js'
import { QuestionRow } from '../admin/Inbox.jsx'
import { ProductForm } from '../admin/ProductForm.jsx'
import { CourierList } from '../shop/CourierList.jsx'
import { ORDER_STATUS, RETURN_STATUS, shipDay, when } from '../shop/shared.js'
import { Chip, CountBadge, FilterChips, ProductStatus, ShipSteps, StatTile, StockChip, Thumb } from '../admin/ui.jsx'

// 판매자(농가) 화면: 로그인 → [내 상품 | 상품 문의 | 주문 | 반품 | 농가 소개]. 모든 요청은 /api/seller (자기 농가 것만)
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

function MyProducts({ onMessage, onError, initialFilter }) {
  const [products, setProducts] = useState(null)
  const [options, setOptions] = useState(null)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    Promise.all([sellerApi('/products'), sellerApi('/options')])
      .then(([list, opts]) => { setProducts(list); setOptions(opts) })
      .catch((e) => onError(e.message))
  }, [onError])

  async function refresh(text) {
    setProducts(await sellerApi('/products'))
    setEditing(null)
    onMessage(text)
  }

  async function soldOut(p) {
    try {
      await sellerApi(`/products/${p.product_code}`, { method: 'PATCH', body: { stock: 0 } })
      await refresh(`${p.name}: 품절로 표시했어요`)
    } catch (e) {
      onError(e.message)
    }
  }

  if (!products || !options) return <p className="muted">불러오는 중…</p>
  if (editing) {
    return (
      <ProductForm
        product={editing === 'new' ? null : editing}
        options={options}
        api={sellerApi}
        mode="seller"
        onCancel={() => setEditing(null)}
        onSaved={(saved, text) => refresh(`${saved.name}: ${text}`)}
      />
    )
  }
  return <ProductCards products={products} initialFilter={initialFilter} onEdit={(p) => { setEditing(p); onMessage('') }} onNew={() => { setEditing('new'); onMessage('') }} onSoldOut={soldOut} />
}

const PRODUCT_FILTERS = [
  ['all', '전체', () => true],
  ['selling', '판매 중', (p) => p.status === 'active' && !p.sold_out],
  ['review', '검토 대기', (p) => p.status === 'pending'],
  ['rejected', '반려', (p) => p.status === 'draft' && p.review_note],
  ['soldout', '품절', (p) => p.status === 'active' && p.sold_out],
  ['draft', '임시 저장', (p) => p.status === 'draft' && !p.review_note],
]

function ProductCards({ products, initialFilter = 'all', onEdit, onNew, onSoldOut }) {
  const [filter, setFilter] = useState(initialFilter)
  const [q, setQ] = useState('')
  const test = PRODUCT_FILTERS.find(([key]) => key === filter)?.[2] ?? (() => true)
  const shown = products.filter(test).filter((p) => !q.trim() || `${p.name} ${p.item_name}`.includes(q.trim()))
  return (
    <>
      <div className="toolbar">
        <FilterChips value={filter} onChange={setFilter} items={PRODUCT_FILTERS.map(([key, label, f]) => ({ key, label, count: products.filter(f).length }))} />
        <div className="actions">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품 이름·품목 찾기" aria-label="상품 찾기" />
          <button type="button" className="button" onClick={onNew}>+ 새 상품 등록</button>
        </div>
      </div>
      <p className="muted">새 상품은 [판매 요청]을 하면 자동으로 검사해요. 처음 상품 3개는 회사가 확인하고, 그 뒤로는 문제가 없으면 바로 판매돼요. 판매 중인 상품의 가격·재고 수정은 바로 반영돼요.</p>
      {shown.length === 0 ? <p className="empty-state">{products.length ? '이 조건에 맞는 상품이 없어요.' : '아직 등록한 상품이 없어요. [+ 새 상품 등록]으로 시작해 주세요.'}</p> : (
        <ul className="product-cards">
          {shown.map((p) => (
            <li key={p.product_code} className={`product-card${p.sold_out || p.status === 'draft' ? ' is-dim' : ''}`}>
              <Thumb url={p.image_url} size={88} />
              <div className="pc-body">
                <p className="pc-name">{p.name}</p>
                <span className="pc-sub">{p.category} · {p.item_name}{p.options.length > 0 && ` · 옵션 ${p.options.length}개`}</span>
                <span className="pc-price">{won(p.price)}{p.options.length > 0 && '부터'}</span>
                <div className="pc-chips">
                  <ProductStatus product={p} />
                  {p.status !== 'draft' && <StockChip product={p} />}
                  {p.ship_from && <Chip tone="blue">예약 · {shipDay(p.ship_from)}부터</Chip>}
                  {p.restock_waiting > 0 && <Chip tone="blue" title="품절일 때 재입고 알림을 신청한 손님 수">재입고 알림 {p.restock_waiting}명</Chip>}
                </div>
                {p.status === 'draft' && p.review_note && <p className="pc-note red">반려 사유: {p.review_note}</p>}
                {p.status === 'pending' && p.review_reason && <p className="pc-note amber">회사 확인이 필요해요: {p.review_reason}</p>}
                <div className="pc-actions">
                  <button type="button" className="primary" onClick={() => onEdit(p)}>수정</button>
                  {/* 옵션 상품은 옵션마다 재고가 있어서 [수정]에서 옵션 재고를 바꾼다 */}
                  {!p.sold_out && p.options.length === 0 && p.status === 'active' && <button type="button" onClick={() => onSoldOut(p)}>품절 처리</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function MyQuestions({ onMessage, onError }) {
  const [questions, setQuestions] = useState(null)
  useEffect(() => {
    sellerApi('/questions').then(setQuestions).catch((e) => onError(e.message))
  }, [onError])

  if (!questions) return <p className="muted">불러오는 중…</p>
  const waiting = questions.filter((q) => !q.answer).length
  return (
    <>
      <p className="muted">내 농가 상품에 달린 질문이에요. 답변 기다리는 질문 {waiting}개. 손님 연락처는 회사 관리자만 봐요.</p>
      {questions.length === 0 ? <p className="muted">아직 질문이 없어요.</p> : (
        <ul className="inbox">
          {questions.map((q) => (
            <QuestionRow
              key={q.id}
              q={q}
              canHide={false}
              request={(body) => sellerApi(`/questions/${q.id}`, { method: 'PATCH', body })}
              onError={onError}
              onSaved={(row, text) => { setQuestions((list) => list.map((x) => (x.id === row.id ? { ...x, ...row } : x))); onMessage(text) }}
            />
          ))}
        </ul>
      )}
    </>
  )
}

// 내 농가 상품이 들어 있는 주문. 다른 농가 상품과 함께 주문됐어도 내 상품은 내가 따로 보낸다 (송장·배송비가 농가마다)
// 정산 요약: 배송 완료 7일 뒤(또는 손님이 먼저) 구매 확정된 매출이 정산 대상. 취소한 내 농가 몫은 빠지고, 반품 환불액은 뺀다
function Settlement() {
  const [s, setS] = useState(null)
  useEffect(() => {
    sellerApi('/orders/settlement').then(setS).catch(() => setS(null))
  }, [])
  if (!s) return null
  const refunds = s.confirmed_refunds + s.late_refunds
  return (
    <section className="settle">
      <h3 className="section-title">정산 <span className="muted">구매 확정된 내 상품 매출 기준{s.has_test ? ' · 테스트 결제 포함' : ''}</span></h3>
      <div className="stat-grid">
        <StatTile label="이번 달 정산 예정" value={won(s.confirmed_amount + s.confirmed_shipping - refunds)} hint={`${s.confirmed_orders}건 · 배송비 ${won(s.confirmed_shipping)} 포함`} tone="green" />
        <StatTile label="구매 확정 기다리는 중" value={won(s.waiting_amount + s.waiting_shipping - s.waiting_refunds)} hint={`${s.waiting_orders}건`} tone="blue" />
        <StatTile label="반품 환불로 뺀 금액" value={won(refunds + s.waiting_refunds)} hint={s.late_refunds > 0 ? `지난달 확정분 ${won(s.late_refunds)} 포함` : '이번 달'} tone="red" />
      </div>
      <p className="muted">배송 완료 {s.confirmDays}일 뒤 자동으로 구매 확정돼요. 손님이 먼저 확정할 수도 있어요.</p>
    </section>
  )
}

// 주문 탭은 '전체'로 열린다. 첫 화면의 숫자(배송 준비할 주문 등)를 누르면 그 목록(initialFilter)으로 바로 연다
function MyOrders({ onMessage, onError, initialFilter = 'all' }) {
  const [orders, setOrders] = useState(null)
  const [tracking, setTracking] = useState({})
  const [filter, setFilter] = useState(initialFilter)

  const load = () => sellerApi('/orders').then(setOrders).catch((e) => onError(e.message))
  useEffect(() => {
    sellerApi('/orders').then(setOrders).catch((e) => onError(e.message))
  }, [onError])

  async function advance(o, status) {
    const t = tracking[o.order_no] ?? {}
    try {
      await sellerApi(`/orders/${o.order_no}`, { method: 'PATCH', body: { status, courier: t.courier, trackingNo: t.no } })
      onMessage(`${o.order_no}: ${ORDER_STATUS[status]}`)
      load()
    } catch (e) {
      onError(e.message)
    }
  }
  const setT = (no, key) => (e) => setTracking((prev) => ({ ...prev, [no]: { ...prev[no], [key]: e.target.value } }))

  // 내 농가 몫만 취소 (아직 보내지 않았을 때): 내 상품 금액 + 배송비를 손님 결제에서 취소하고 재고를 돌려놓는다
  async function cancel(o) {
    const reason = window.prompt('취소 사유 (손님에게 보여요)')
    if (!reason?.trim()) return
    if (!window.confirm(`내 상품 ${won(o.items_amount)} + 배송비 ${won(o.shipping_fee)}을 손님 결제에서 바로 취소해요.`)) return
    try {
      await sellerApi(`/orders/${o.order_no}/cancel`, { method: 'POST', body: { reason } })
      onMessage(`${o.order_no}: 내 농가 몫을 취소하고 결제를 돌려드렸어요`)
    } catch (e) {
      onError(e.message)
    }
    load()
  }

  if (!orders) return <p className="muted">불러오는 중…</p>
  const ORDER_FILTERS = [
    ['all', '전체', () => true],
    ['todo', '할 일', (o) => ['paid', 'preparing'].includes(o.status) && !(o.status === 'paid' && o.ship_from)],
    ['preorder', '예약 대기', (o) => o.status === 'paid' && o.ship_from],
    ['shipping', '배송 중', (o) => o.status === 'shipping'],
    ['done', '배송 완료', (o) => o.status === 'delivered'],
    ['cancelled', '취소', (o) => o.status === 'cancelled'],
  ]
  const test = ORDER_FILTERS.find(([key]) => key === filter)?.[2] ?? (() => true)
  const shown = orders.filter(test)
  return (
    <>
    <Settlement />
    <h3 className="section-title">주문 <span className="muted">내 농가 상품만 보여요. 다른 농가 상품과 함께 주문됐어도 내 상품은 따로 보내요</span></h3>
    <FilterChips value={filter} onChange={setFilter} items={ORDER_FILTERS.map(([key, label, f]) => ({ key, label, count: orders.filter(f).length }))} />
    {shown.length === 0 ? <p className="empty-state">{orders.length ? '이 조건에 맞는 주문이 없어요.' : '아직 내 상품 주문이 없어요.'}</p> : (
    <ul className="order-cards">
      {shown.map((o) => (
        <li key={o.order_no} className={`order-card${['cancelled', 'delivered'].includes(o.status) ? ' is-dim' : ''}`}>
          <div className="oc-head">
            <span className="oc-no">{o.order_no}</span>
            <span className="oc-when">{when(o.created_at)}</span>
            <ShipSteps status={o.status} />
            {o.ship_from && ['paid', 'preparing'].includes(o.status) && <Chip tone="blue">예약 · {shipDay(o.ship_from)}부터 출고</Chip>}
            {o.confirmed_at && <Chip tone="green">구매 확정</Chip>}
            {o.is_test && <Chip>테스트</Chip>}
          </div>
          <div>
            <ul className="oc-items">{o.items.map((i) => <li key={`${i.name}:${i.option_name ?? ''}`}><span>{i.name} <span className="muted">({i.option_name ?? i.unit})</span></span><span className="qty-x">× {i.quantity}</span></li>)}</ul>
            <p className="oc-amount">내 상품 <b>{won(o.items_amount)}</b> + 배송비 {o.shipping_fee ? won(o.shipping_fee) : '무료'}{o.farms > 1 && ` · 다른 농가 ${o.farms - 1}곳과 함께 주문`}</p>
          </div>
          <div className="oc-side">
            {o.receiver ? (
              <dl>
                <dt>받는 분</dt><dd>{o.receiver.name} · {o.receiver.phone}</dd>
                <dt>주소</dt><dd>({o.receiver.zipcode}) {o.receiver.address1} {o.receiver.address2 ?? ''}</dd>
                {o.receiver.memo && <><dt>메모</dt><dd>{o.receiver.memo}</dd></>}
              </dl>
            ) : <span className="muted">받는 분 연락처·주소는 보내기 전(결제 완료·배송 준비)에만 보여요</span>}
            {o.tracking_no && <span>송장 {o.courier} {o.tracking_no} {o.tracking_url && <a href={o.tracking_url} target="_blank" rel="noreferrer">배송 조회</a>}</span>}
          </div>
          {(['paid', 'preparing'].includes(o.status) || o.cancel_pending) && (
            <div className="oc-action">
              {o.cancel_pending && <p className="warn">취소의 결제 취소 결과를 확인하고 있어요. 회사 담당자가 확인해요.</p>}
              {o.status === 'paid' && <button type="button" className="button" onClick={() => advance(o, 'preparing')}>배송 준비 시작</button>}
              {o.status === 'preparing' && (
                <>
                  <label>택배사<input value={tracking[o.order_no]?.courier ?? ''} onChange={setT(o.order_no, 'courier')} list="couriers" placeholder="골라 주세요" /></label>
                  <CourierList />
                  <label>송장 번호<input value={tracking[o.order_no]?.no ?? ''} onChange={setT(o.order_no, 'no')} inputMode="numeric" /></label>
                  <button type="button" className="button" onClick={() => advance(o, 'shipping')}>배송 시작</button>
                </>
              )}
              <span className="spacer" />
              {['paid', 'preparing'].includes(o.status) && !o.cancel_pending && <button type="button" className="link" onClick={() => cancel(o)}>내 농가 몫 취소</button>}
            </div>
          )}
        </li>
      ))}
    </ul>
    )}
    </>
  )
}

// 내 농가 반품 신청: 손님 사유를 보고 의견을 남긴다. 승인·거절·환불은 회사 관리자가 한다
const REASONS = { change_mind: '단순 변심', defect: '상품 하자·표시와 다름', wrong_item: '오배송' }
function MyReturns({ onMessage, onError }) {
  const [list, setList] = useState(null)
  const [notes, setNotes] = useState({})
  const load = () => sellerApi('/returns').then(setList).catch((e) => onError(e.message))
  useEffect(() => {
    sellerApi('/returns').then(setList).catch((e) => onError(e.message))
  }, [onError])

  async function save(r) {
    try {
      await sellerApi(`/returns/${r.id}`, { method: 'PATCH', body: { note: notes[r.id] ?? r.seller_note ?? '' } })
      onMessage(`반품 #${r.id}에 의견을 남겼어요`)
      load()
    } catch (e) {
      onError(e.message)
    }
  }

  if (!list) return <p className="muted">불러오는 중…</p>
  if (!list.length) return <p className="muted">내 농가 상품 반품 신청이 없어요.</p>
  return (
    <>
    <p className="muted">반품 승인·환불은 회사 관리자가 해요. 상품 상태나 돌려받은 결과를 의견으로 남겨 주세요.</p>
    <ul className="inbox">
      {list.map((r) => (
        <li key={r.id} className={`box${['rejected', 'refunded'].includes(r.status) ? ' dim' : ''}`}>
          <p><b>#{r.id}</b> · {r.order_no} · {RETURN_STATUS[r.status]} · 신청 {when(r.created_at)} · 받은 날 {when(r.delivered_at)}</p>
          <p>{REASONS[r.reason_type]} · {r.reason}</p>
          <ul>{r.items.map((i) => <li key={`${i.name}:${i.option_name ?? ''}`}>{i.name} ({i.option_name ?? i.unit}) × {i.quantity}</li>)}</ul>
          {r.admin_note && <p className="muted">회사 메모: {r.admin_note}</p>}
          {r.status === 'refunded' && <p className="muted">{won(r.refund_amount)} 환불 ({when(r.refunded_at)})</p>}
          <div className="row form">
            <label>내 의견<input value={notes[r.id] ?? r.seller_note ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} maxLength={500} /></label>
            <button type="button" className="button ghost" onClick={() => save(r)}>의견 저장</button>
          </div>
        </li>
      ))}
    </ul>
    </>
  )
}

function Profile({ seller, onSaved, onError }) {
  const [intro, setIntro] = useState(seller.intro ?? '')
  const [story, setStory] = useState(seller.story ?? '')
  const [errors, setErrors] = useState([])

  async function save(event) {
    event.preventDefault()
    setErrors([])
    try {
      onSaved(await sellerApi('/profile', { method: 'PATCH', body: { intro, story } }))
    } catch (e) {
      setErrors(e.errors ?? [e.message])
      onError('')
    }
  }

  return (
    <form className="box form" onSubmit={save}>
      <h3>{seller.name} · {seller.region}</h3>
      <label>한 줄 소개<input value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={100} /></label>
      <label>농가 이야기 <span className="muted">상품 상세의 '판매 농가 이야기'에 보여요</span>
        <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={6} maxLength={1500} />
      </label>
      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <button type="submit" className="button">저장</button>
    </form>
  )
}

// 글씨 크게: 판매자 화면 전체를 크게 보이게 하고, 이 브라우저에 기억해 둔다
const BIG_TEXT_KEY = 'seller-big-text'
function readBigText() {
  try {
    return localStorage.getItem(BIG_TEXT_KEY) === '1'
  } catch {
    return false
  }
}

export default function Seller() {
  const [me, setMe] = useState(undefined)
  const [tab, setTab] = useState('home')
  const [filter, setFilter] = useState(null) // 첫 화면 숫자를 눌러 들어갈 때 열 목록 (탭을 직접 누르면 '전체')
  const [bigText, setBigText] = useState(readBigText)
  function toggleBigText() {
    const next = !bigText
    setBigText(next)
    try {
      localStorage.setItem(BIG_TEXT_KEY, next ? '1' : '0')
    } catch {
      // 저장이 막혀도 이번 화면에서는 크게 보인다
    }
  }
  const [summary, setSummary] = useState(null)
  const loadSummary = () => sellerApi('/summary').then(setSummary).catch(() => {})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    sellerApi('/me').then(setMe).catch((e) => setMe(e.status === 403 ? 'not-seller' : null))
  }, [])
  useEffect(() => {
    if (me?.seller?.status === 'active') sellerApi('/summary').then(setSummary).catch(() => {})
  }, [me])

  async function logout() {
    await adminApi('/logout', { method: 'POST' })
    setMe(null)
  }

  if (me === undefined) return <p className="muted">확인 중…</p>
  if (me === null) {
    return (
      <>
        <Login title="판매자 로그인" onLogin={() => sellerApi('/me').then(setMe).catch(() => setMe('not-seller'))} />
        <p className="muted">아직 판매자가 아니세요? <a href="/account/signup?type=seller">판매자 가입 신청</a></p>
      </>
    )
  }
  if (me === 'not-seller') {
    return (
      <div className="box">
        <p>관리자 계정으로 로그인되어 있어요. 판매자 화면은 농가 판매자 계정으로 들어와요.</p>
        <div className="actions">
          <a className="button" href="/admin">관리자 화면으로</a>
          <button type="button" className="button ghost" onClick={logout}>로그아웃</button>
        </div>
      </div>
    )
  }

  // 승인 전: 상품·주문은 승인 뒤에 쓸 수 있다
  if (me.seller.status !== 'active') {
    return (
      <div className="box">
        <h3>{me.seller.name} · 판매자 가입 {me.seller.status === 'rejected' ? '반려' : '승인 대기 중'}</h3>
        {me.seller.status === 'rejected'
          ? <p className="warn">사유: {me.seller.reject_note} · 다시 신청하려면 회사로 연락해 주세요.</p>
          : <p>회사가 농가 정보를 확인하고 있어요. 승인되면 이메일로 알려 드리고, 그때부터 상품을 올릴 수 있어요.</p>}
        <button type="button" className="link" onClick={logout}>로그아웃</button>
      </div>
    )
  }

  const go = (next, list = null) => { setTab(next); setFilter(list); setMessage(''); setError(''); loadSummary() }
  const t = summary ?? {}
  const TABS = [['home', '오늘 할 일', 0], ['products', '내 상품', t.rejected], ['orders', '주문', (t.to_prepare ?? 0) + (t.to_ship ?? 0)], ['questions', '상품 문의', t.questions_waiting], ['returns', '반품', t.returns_waiting], ['profile', '농가 소개', 0]]
  return (
    <section className={bigText ? 'seller-big' : undefined}>
      <div className="admin-head">
        <nav className="tabs">
          {TABS.map(([key, label, n]) => <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => go(key)}>{label}<CountBadge n={n} /></button>)}
        </nav>
        <div className="account">
          <button type="button" className="text-size" aria-pressed={bigText} onClick={toggleBigText}>{bigText ? '글씨 보통으로' : '가 글씨 크게'}</button>
          <span className="muted">{me.seller.name} · {me.loginId}</span>
          {!me.mfa && <Chip tone="amber" title="회사 담당자에게 2단계 인증 등록을 요청하세요">2단계 인증 미등록</Chip>}
          <button type="button" className="link" onClick={logout}>로그아웃</button>
        </div>
      </div>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      {tab === 'home' && (
        <>
          <h3 className="section-title">오늘 할 일 <span className="muted">숫자를 누르면 그 화면으로 가요</span></h3>
          <div className="stat-grid">
            <StatTile label="배송 준비할 주문" value={t.to_prepare ?? '–'} hint="결제가 끝난 내 배송" tone="red" onClick={() => go('orders', 'todo')} />
            <StatTile label="송장 넣을 주문" value={t.to_ship ?? '–'} hint="배송 준비 중" tone="amber" onClick={() => go('orders', 'todo')} />
            <StatTile label="답변 기다리는 문의" value={t.questions_waiting ?? '–'} tone="amber" onClick={() => go('questions')} />
            <StatTile label="반품 신청" value={t.returns_waiting ?? '–'} hint="의견을 남겨 주세요" tone="red" onClick={() => go('returns')} />
            <StatTile label="반려된 상품" value={t.rejected ?? '–'} hint="사유를 보고 고쳐 주세요" tone="red" onClick={() => go('products', 'rejected')} />
            <StatTile label="예약 대기 주문" value={t.preorders_waiting ?? '–'} hint="출고 시작일에 보내요" tone="blue" onClick={() => go('orders', 'preorder')} />
          </div>
          <h3 className="section-title">내 상품</h3>
          <div className="stat-grid">
            <StatTile label="판매 중" value={t.selling ?? '–'} tone="green" onClick={() => go('products', 'selling')} />
            <StatTile label="회사 검토 대기" value={t.reviewing ?? '–'} tone="amber" onClick={() => go('products', 'review')} />
            <StatTile label="품절" value={t.sold_out ?? '–'} tone="red" onClick={() => go('products', 'soldout')} />
            <StatTile label="재고 5개 이하" value={t.low_stock ?? '–'} tone="amber" onClick={() => go('products')} />
            <StatTile label="재입고 알림 기다리는 손님" value={t.restock_waiting ?? '–'} hint="재고를 채우면 메일이 가요" tone="blue" onClick={() => go('products')} />
          </div>
        </>
      )}
      {tab === 'products' && <MyProducts key={filter ?? 'all'} initialFilter={filter ?? 'all'} onMessage={setMessage} onError={setError} />}
      {tab === 'questions' && <MyQuestions onMessage={setMessage} onError={setError} />}
      {tab === 'orders' && <MyOrders key={filter ?? 'all'} initialFilter={filter ?? 'all'} onMessage={setMessage} onError={setError} />}
      {tab === 'returns' && <MyReturns onMessage={setMessage} onError={setError} />}
      {tab === 'profile' && (
        <Profile
          seller={me.seller}
          onError={setError}
          onSaved={(seller) => { setMe((prev) => ({ ...prev, seller })); setMessage('농가 소개를 저장했어요') }}
        />
      )}
    </section>
  )
}
