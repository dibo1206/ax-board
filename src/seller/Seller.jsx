import { useEffect, useState } from 'react'
import { Login, StatusLabel } from '../admin/Admin.jsx'
import { adminApi, sellerApi } from '../admin/api.js'
import { QuestionRow } from '../admin/Inbox.jsx'
import { ProductForm } from '../admin/ProductForm.jsx'
import { CourierList } from '../shop/CourierList.jsx'
import { ORDER_STATUS, when } from '../shop/shared.js'

// 판매자(농가) 화면: 로그인 → [내 상품 | 상품 문의 | 농가 소개]. 모든 요청은 /api/seller (자기 농가 것만)
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

function MyProducts({ onMessage, onError }) {
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
  return (
    <>
      <p className="muted">새 상품은 [판매 요청]을 하면 자동으로 검사해요. 처음 상품 3개는 회사가 확인하고, 그 뒤로는 문제가 없으면 바로 판매돼요. 판매 중인 상품의 가격·재고 수정은 바로 반영돼요.</p>
      <button type="button" className="button" onClick={() => { setEditing('new'); onMessage('') }}>새 상품 등록</button>
      {products.length === 0 ? <p className="muted">아직 등록한 상품이 없어요.</p> : (
        <table className="table">
          <thead><tr><th>상품</th><th>가격</th><th>재고</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product_code} className={p.sold_out ? 'dim' : ''}>
                <td>
                  <strong>{p.name}</strong><br /><span className="muted">{p.category} · {p.item_name}</span>
                  {p.status === 'draft' && p.review_note && <><br /><span className="warn">반려 사유: {p.review_note}</span></>}
                  {p.status === 'pending' && p.review_reason && <><br /><span className="muted">회사 확인이 필요해요: {p.review_reason}</span></>}
                </td>
                <td>{won(p.price)}</td>
                <td>{p.sold_out ? <span className="badge soldout">품절</span> : `${p.stock}개`}</td>
                <td><StatusLabel product={p} /></td>
                <td className="row-actions">
                  <button type="button" onClick={() => { setEditing(p); onMessage('') }}>수정</button>
                  {!p.sold_out && <button type="button" onClick={() => soldOut(p)}>품절 처리</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
// 정산 요약: 배송 완료 7일 뒤(또는 손님이 먼저) 구매 확정된 매출이 정산 대상
function Settlement() {
  const [s, setS] = useState(null)
  useEffect(() => {
    sellerApi('/orders/settlement').then(setS).catch(() => setS(null))
  }, [])
  if (!s) return null
  return (
    <div className="box">
      <h3>정산 <span className="muted">구매 확정된 내 상품 매출 기준{s.has_test ? ' · 테스트 결제 포함' : ''}</span></h3>
      <p>이번 달 정산 예정 <b>{won(s.confirmed_amount + s.confirmed_shipping)}</b> ({s.confirmed_orders}건, 배송비 {won(s.confirmed_shipping)} 포함)
        · 구매 확정 기다리는 중 {won(s.waiting_amount + s.waiting_shipping)} ({s.waiting_orders}건)</p>
      <p className="muted">배송 완료 {s.confirmDays}일 뒤 자동으로 구매 확정돼요. 손님이 먼저 확정할 수도 있어요.</p>
    </div>
  )
}

function MyOrders({ onMessage, onError }) {
  const [orders, setOrders] = useState(null)
  const [tracking, setTracking] = useState({})

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

  if (!orders) return <p className="muted">불러오는 중…</p>
  if (!orders.length) return <><Settlement /><p className="muted">아직 내 상품 주문이 없어요.</p></>
  return (
    <>
    <Settlement />
    <ul className="inbox">
      {orders.map((o) => (
        <li key={o.order_no} className={`box${o.status === 'cancelled' ? ' dim' : ''}`}>
          <p><b>{o.order_no}</b> · 내 배송 {ORDER_STATUS[o.status]}{o.confirmed_at && ' · 구매 확정'} · {when(o.created_at)}{o.is_test && ' · 테스트'}</p>
          <ul>{o.items.map((i) => <li key={i.name}>{i.name} ({i.unit}) × {i.quantity}</li>)}</ul>
          <p className="muted">내 상품 {won(o.items_amount)} + 배송비 {o.shipping_fee ? won(o.shipping_fee) : '무료'}
            {o.farms > 1 && ` · 다른 농가 ${o.farms - 1}곳 상품과 함께 주문됐어요 (내 상품만 따로 보내면 돼요)`}</p>
          {o.receiver && <p className="muted">받는 분 {o.receiver.name} · {o.receiver.phone} · ({o.receiver.zipcode}) {o.receiver.address1} {o.receiver.address2 ?? ''}{o.receiver.memo && ` · 메모: ${o.receiver.memo}`}</p>}
          {o.tracking_no && <p className="muted">송장 {o.courier} {o.tracking_no} {o.tracking_url && <a href={o.tracking_url} target="_blank" rel="noreferrer">배송 조회</a>}</p>}
          {o.status === 'paid' && <button type="button" className="button ghost" onClick={() => advance(o, 'preparing')}>배송 준비 시작</button>}
          {o.status === 'preparing' && (
            <div className="row form">
              <label>택배사<input value={tracking[o.order_no]?.courier ?? ''} onChange={setT(o.order_no, 'courier')} list="couriers" placeholder="골라 주세요" /></label>
              <CourierList />
              <label>송장 번호<input value={tracking[o.order_no]?.no ?? ''} onChange={setT(o.order_no, 'no')} inputMode="numeric" /></label>
              <button type="button" className="button" onClick={() => advance(o, 'shipping')}>배송 시작</button>
            </div>
          )}
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

export default function Seller() {
  const [me, setMe] = useState(undefined)
  const [tab, setTab] = useState('products')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    sellerApi('/me').then(setMe).catch((e) => setMe(e.status === 403 ? 'not-seller' : null))
  }, [])

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

  const go = (next) => { setTab(next); setMessage(''); setError('') }
  return (
    <section>
      <div className="admin-head">
        <nav className="tabs">
          <button type="button" className={tab === 'products' ? 'on' : ''} onClick={() => go('products')}>내 상품</button>
          <button type="button" className={tab === 'questions' ? 'on' : ''} onClick={() => go('questions')}>상품 문의</button>
          <button type="button" className={tab === 'orders' ? 'on' : ''} onClick={() => go('orders')}>주문</button>
          <button type="button" className={tab === 'profile' ? 'on' : ''} onClick={() => go('profile')}>농가 소개</button>
        </nav>
        <span className="muted">{me.seller.name} · {me.loginId}</span>
        {!me.mfa && <span className="badge soldout" title="회사 담당자에게 2단계 인증 등록을 요청하세요">2단계 인증 미등록</span>}
        <button type="button" className="link" onClick={logout}>로그아웃</button>
      </div>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      {tab === 'products' && <MyProducts onMessage={setMessage} onError={setError} />}
      {tab === 'questions' && <MyQuestions onMessage={setMessage} onError={setError} />}
      {tab === 'orders' && <MyOrders onMessage={setMessage} onError={setError} />}
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
