import { useEffect, useState } from 'react'
import { adminApi } from './api.js'
import { ChatLogs } from './ChatLogs.jsx'
import { Inbox } from './Inbox.jsx'
import { AccessLogs } from './AccessLogs.jsx'
import { Orders } from './Orders.jsx'
import { ProductForm } from './ProductForm.jsx'

// 관리자 화면: 로그인 → [상품 관리 | 문의함 | 상담 기록]. 모든 요청은 /api/admin (로그인 쿠키 필요)
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`
// 상품 상태 표시: 반려된 상품은 임시 저장 상태에 반려 사유가 남아 있다
export function StatusLabel({ product }) {
  if (product.status === 'pending') return <span className="badge pending">검토 대기</span>
  if (product.status === 'draft') return product.review_note ? <span className="badge soldout" title={product.review_note}>반려됨</span> : '임시 저장'
  return '판매 중'
}

// 관리자·판매자가 같이 쓰는 로그인 (로그인 주소는 같고, 계정 종류에 따라 들어갈 화면이 다르다)
export function Login({ onLogin, title = '관리자 로그인' }) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [needOtp, setNeedOtp] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    try {
      const me = await adminApi('/login', { method: 'POST', body: { loginId, password, otp } })
      onLogin(me)
    } catch (e) {
      // 2단계 인증을 등록한 계정이면 인증 앱 코드 칸을 보여 준다
      if (e.needOtp) setNeedOtp(true)
      setOtp('')
      setError(e.message)
    }
  }

  return (
    <form className="box form" onSubmit={submit}>
      <h2>{title}</h2>
      <label>아이디<input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" /></label>
      <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      {needOtp && (
        <label>인증 앱 코드 (6자리)<input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus /></label>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" className="button">로그인</button>
    </form>
  )
}

function Admin() {
  const [me, setMe] = useState(undefined)
  const [products, setProducts] = useState([])
  const [options, setOptions] = useState(null)
  const [editing, setEditing] = useState(null) // null: 목록, 'new': 새 상품, 객체: 수정
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('products')
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    adminApi('/me').then(setMe).catch(() => setMe(null))
  }, [])

  useEffect(() => {
    if (!me) return
    Promise.all([adminApi('/products'), adminApi('/options'), adminApi('/inquiries/summary')])
      .then(([list, opts, summary]) => { setProducts(list); setOptions(opts); setCounts(summary) })
      .catch((e) => (e.status === 401 ? setMe(null) : setError(e.message)))
  }, [me])

  async function refresh(text) {
    setProducts(await adminApi('/products'))
    setEditing(null)
    setMessage(text)
  }

  async function logout() {
    await adminApi('/logout', { method: 'POST' })
    setMe(null)
  }

  async function quickStock(product, stock) {
    try {
      await adminApi(`/products/${product.product_code}`, { method: 'PATCH', body: { stock } })
      await refresh(`${product.name}: ${stock === 0 ? '품절로 표시했어요' : `재고 ${stock}개로 바꿨어요`}`)
    } catch (e) {
      setError(e.message)
    }
  }

  async function review(product, approve) {
    const note = approve ? null : window.prompt('반려 사유를 적어 주세요 (판매자에게 보여요)')
    if (!approve && !note?.trim()) return
    try {
      await adminApi(`/products/${product.product_code}`, { method: 'PATCH', body: approve ? { status: 'active' } : { status: 'draft', review_note: note.trim() } })
      setCounts(await adminApi('/inquiries/summary'))
      await refresh(`${product.name}: ${approve ? '승인해서 판매를 시작했어요' : '반려했어요'}`)
    } catch (e) {
      setError(e.message)
    }
  }

  if (me === undefined) return <p className="muted">확인 중…</p>
  if (!me) return <Login onLogin={setMe} />
  if (me.role === 'seller') {
    return (
      <div className="box">
        <p>{me.loginId}은(는) 판매자 계정이에요. 판매자 화면에서 내 농가 상품을 관리해 주세요.</p>
        <div className="actions">
          <a className="button" href="/seller">판매자 화면으로</a>
          <button type="button" className="button ghost" onClick={logout}>로그아웃</button>
        </div>
      </div>
    )
  }

  const waiting = counts ? counts.unanswered + counts.new_b2b : 0
  const pending = counts?.pending_products ?? 0
  const newOrders = counts?.new_orders ?? 0

  return (
    <section>
      <div className="admin-head">
        <nav className="tabs">
          <button type="button" className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>상품 관리{pending > 0 && ` (검토 ${pending})`}</button>
          <button type="button" className={tab === 'inbox' ? 'on' : ''} onClick={() => { setTab('inbox'); setEditing(null); setMessage('') }}>
            문의함{waiting > 0 && ` (${waiting})`}
          </button>
          <button type="button" className={tab === 'orders' ? 'on' : ''} onClick={() => { setTab('orders'); setEditing(null); setMessage('') }}>주문{newOrders > 0 && ` (${newOrders})`}</button>
          <button type="button" className={tab === 'chat' ? 'on' : ''} onClick={() => { setTab('chat'); setEditing(null); setMessage('') }}>상담 기록</button>
          <button type="button" className={tab === 'access' ? 'on' : ''} onClick={() => { setTab('access'); setEditing(null); setMessage('') }}>접속 기록</button>
        </nav>
        <span className="muted">{me.loginId} 로그인 중</span>
        {!me.mfa && <span className="badge soldout" title="서버에서 npm run admin-2fa -- 아이디">2단계 인증 미등록</span>}
        <button type="button" className="link" onClick={logout}>로그아웃</button>
      </div>
      {tab === 'products' && message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {tab === 'inbox' ? (
        <Inbox onCount={setCounts} />
      ) : tab === 'orders' ? (
        <Orders onCount={setCounts} />
      ) : tab === 'access' ? (
        <AccessLogs />
      ) : tab === 'chat' ? (
        <ChatLogs />
      ) : editing && options ? (
        <ProductForm
          product={editing === 'new' ? null : editing}
          options={options}
          onCancel={() => setEditing(null)}
          onSaved={(saved, text) => refresh(`${saved.name}: ${text}`)}
        />
      ) : (
        <>
          <button type="button" className="button" onClick={() => { setEditing('new'); setMessage('') }}>새 상품 등록</button>
          <table className="table">
            <thead>
              <tr><th>상품</th><th>가격</th><th>재고</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_code} className={p.sold_out ? 'dim' : ''}>
                  <td><strong>{p.name}</strong><br /><span className="muted">{p.category} · {p.seller_name}</span></td>
                  <td>{won(p.price)}</td>
                  <td>{p.sold_out ? <span className="badge soldout">품절</span> : `${p.stock}개`}</td>
                  <td><StatusLabel product={p} /></td>
                  <td className="row-actions">
                    {p.status === 'pending' && <button type="button" onClick={() => review(p, true)}>승인</button>}
                    {p.status === 'pending' && <button type="button" onClick={() => review(p, false)}>반려</button>}
                    <button type="button" onClick={() => { setEditing(p); setMessage('') }}>{p.status === 'pending' ? '열어 보기' : '수정'}</button>
                    {p.sold_out ? null : <button type="button" onClick={() => quickStock(p, 0)}>품절 처리</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

export default Admin
