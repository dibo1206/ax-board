import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi } from './api.js'
import { BannedWords } from './BannedWords.jsx'
import { ChatLogs } from './ChatLogs.jsx'
import { AdminPosts } from './Posts.jsx'
import { Settings } from './Settings.jsx'
import { SiteContent } from './SiteContent.jsx'
import { ItemReview } from './ItemReview.jsx'
import { SellerApproval } from './SellerApproval.jsx'
import { Inbox } from './Inbox.jsx'
import { AccessLogs } from './AccessLogs.jsx'
import { Dashboard } from './Dashboard.jsx'
import { Notifications } from './Notifications.jsx'
import { AdminReviews } from './Reviews.jsx'
import { Orders } from './Orders.jsx'
import { Returns } from './Returns.jsx'
import { ProductForm } from './ProductForm.jsx'
import { Chip, CountBadge, FilterChips, ProductStatus, StockChip, Thumb } from './ui.jsx'

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
  // ?tab=site 처럼 주소로 바로 열 수 있다 (쇼핑몰 맨 위 관리자 막대에서 들어올 때)
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return ['dashboard', 'orders', 'returns', 'products', 'items', 'sellers', 'inbox', 'reviews', 'chat', 'site', 'posts', 'mail', 'access', 'banned', 'settings'].includes(t) ? t : 'dashboard'
  })
  const [productFilter, setProductFilter] = useState('all')
  const [productQuery, setProductQuery] = useState('')
  const [counts, setCounts] = useState(null)
  const setItemCount = useCallback((n) => setCounts((c) => (c ? { ...c, pending_items: n } : c)), [])

  useEffect(() => {
    adminApi('/me').then(setMe).catch(() => setMe(null))
  }, [])

  useEffect(() => {
    if (!me) return
    Promise.all([adminApi('/products'), adminApi('/options'), adminApi('/inquiries/summary')])
      .then(([list, opts, summary]) => { setProducts(list); setOptions(opts); setCounts(summary) })
      .catch((e) => (e.status === 401 ? setMe(null) : setError(e.message)))
  }, [me])

  const editFromLink = useRef(new URLSearchParams(window.location.search).get('edit'))
  useEffect(() => {
    const code = editFromLink.current
    if (!code || !products) return
    editFromLink.current = null
    const found = products.find((p) => p.product_code === code)
    if (found) { setTab('products'); setEditing(found) }
  }, [products])

  // 새 주문 알림: 1분마다 확인해서 늘었으면 화면 위에 알리고 탭 제목에 개수를 붙인다
  const [alert, setAlert] = useState('')
  useEffect(() => {
    if (!me || me.role === 'seller') return
    let last = null
    const tick = () => adminApi('/inquiries/summary').then((summary) => {
      if (last !== null && summary.new_orders > last) setAlert(`새 주문 ${summary.new_orders - last}건이 들어왔어요`)
      last = summary.new_orders
      setCounts(summary)
      document.title = summary.new_orders > 0 ? `(${summary.new_orders}) 관리자 · 농가 판매 자사몰` : '관리자 · 농가 판매 자사몰'
    }).catch(() => {})
    tick()
    const timer = setInterval(tick, 60_000)
    return () => clearInterval(timer)
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

  // 바로 판매된 상품을 확인했다고 표시
  async function checkAuto(product) {
    try {
      await adminApi(`/products/${product.product_code}/checked`, { method: 'POST' })
      setCounts(await adminApi('/inquiries/summary'))
      await refresh(`${product.name}: 확인했어요`)
    } catch (e) {
      setError(e.message)
    }
  }

  if (me === undefined) return <p className="muted">확인 중…</p>
  // 다시 로그인하면 전 계정(예: 판매자)으로 났던 오류 문구는 지운다
  if (!me) return <Login onLogin={(next) => { setError(''); setMe(next) }} />
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

  const open = (next) => { setTab(next); setEditing(null); setMessage('') }
  const NAV = [
    ['운영', [['dashboard', '매출·할 일', 0], ['orders', '주문', newOrders], ['returns', '반품', counts?.returns_requested ?? 0]]],
    ['상품', [['products', '상품 관리', pending + (counts?.auto_unchecked ?? 0)], ['items', '품목 검수', counts?.pending_items ?? 0], ['sellers', '판매자 승인', counts?.pending_sellers ?? 0]]],
    ['손님', [['inbox', '문의함', waiting], ['reviews', '후기', 0], ['chat', '상담 기록', 0]]],
    ['홈페이지', [['site', '홈페이지 관리', 0], ['posts', '공지·언론', 0]]],
    ['기록·설정', [['settings', '쇼핑몰 설정', 0], ['mail', '알림 기록', 0], ['access', '접속 기록', 0], ['banned', '금지어', 0]]],
  ]

  return (
    <section className="console-layout">
      <aside className="side-nav" aria-label="관리자 메뉴">
        {NAV.map(([group, items]) => (
          <div key={group}>
            <p className="group-name">{group}</p>
            {items.map(([key, label, n]) => <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => open(key)}>{label}<CountBadge n={n} /></button>)}
          </div>
        ))}
        <div className="account">
          <span>{me.loginId} 로그인 중</span>
          {!me.mfa && <Chip tone="amber" title="서버에서 npm run admin-2fa -- 아이디">2단계 인증 미등록</Chip>}
          <button type="button" className="link" onClick={logout}>로그아웃</button>
        </div>
      </aside>
      <div className="console-content">
      {alert && <p className="notice-new" role="status">{alert} <button type="button" className="link" onClick={() => { setTab('orders'); setAlert('') }}>주문 보기</button></p>}
      {tab === 'products' && message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {tab === 'dashboard' ? (
        <Dashboard onGo={(next) => { setTab(next); setEditing(null); setMessage('') }} />
      ) : tab === 'inbox' ? (
        <Inbox onCount={setCounts} />
      ) : tab === 'orders' ? (
        <Orders onCount={setCounts} />
      ) : tab === 'returns' ? (
        <Returns />
      ) : tab === 'reviews' ? (
        <AdminReviews />
      ) : tab === 'mail' ? (
        <Notifications />
      ) : tab === 'sellers' ? (
        <SellerApproval onCount={() => adminApi('/inquiries/summary').then(setCounts).catch(() => {})} />
      ) : tab === 'items' ? (
        <ItemReview onCount={setItemCount} />
      ) : tab === 'banned' ? (
        <BannedWords />
      ) : tab === 'access' ? (
        <AccessLogs />
      ) : tab === 'posts' ? (
        <AdminPosts />
      ) : tab === 'site' ? (
        <SiteContent />
      ) : tab === 'settings' ? (
        <Settings />
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
          <div className="toolbar">
            <FilterChips value={productFilter} onChange={setProductFilter} items={ADMIN_FILTERS.map(([key, label, f]) => ({ key, label, count: products.filter(f).length }))} />
            <div className="actions">
              <input type="search" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="상품·농가 찾기" aria-label="상품 찾기" />
              <button type="button" className="button" onClick={() => { setEditing('new'); setMessage('') }}>+ 새 상품 등록</button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr><th>상품</th><th>가격</th><th>재고</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {products.filter(ADMIN_FILTERS.find(([key]) => key === productFilter)?.[2] ?? (() => true))
                .filter((p) => !productQuery.trim() || `${p.name} ${p.seller_name} ${p.item_name}`.includes(productQuery.trim()))
                .map((p) => (
                <tr key={p.product_code} className={p.sold_out ? 'dim' : ''}>
                  <td><div className="cell-product"><Thumb url={p.image_url} size={56} /><div><strong>{p.name}</strong><br /><span className="muted">{p.category} · {p.seller_name}</span>
                    <div className="cell-flags">
                    {p.item_status === 'pending' && <button type="button" className="chip chip-amber" onClick={() => setTab('items')}>품목 검수 전</button>}
                    {/* 거짓 표시 막기: 당도계 사진이 없는 당도, 후기의 '표시와 달랐어요', 판매 중 수정 이력 */}
                    {p.status === 'pending' && p.review_reason && <><br /><span className="muted">{p.review_reason}</span></>}
                    {p.auto_approved_at && !p.auto_checked_at && p.status === 'active' && <Chip tone="amber">자동 승인 · 확인 전</Chip>}
                    {p.notice_missing?.length > 0 && <Chip tone="red" title={p.notice_missing.join(', ')}>고시 미입력 {p.notice_missing.length}</Chip>}
                    {p.show_brix && p.brix && !p.brix_photo_url && <Chip tone="amber">당도 사진 없음</Chip>}
                    {p.info_no > 0 && <Chip tone="red">표시와 다름 후기 {p.info_no}</Chip>}
                    {p.changes > 0 && <Chip>수정 이력 {p.changes}</Chip>}
                    </div></div></div></td>
                  <td>{won(p.price)}{p.options.length > 0 && '부터'}</td>
                  <td><StockChip product={p} />{p.options.length > 0 && <><br /><span className="muted">옵션 {p.options.length}개</span></>}</td>
                  <td><ProductStatus product={p} /></td>
                  <td className="row-actions">
                    {p.status === 'pending' && <button type="button" onClick={() => review(p, true)}>승인</button>}
                    {p.status === 'pending' && <button type="button" onClick={() => review(p, false)}>반려</button>}
                    {p.auto_approved_at && !p.auto_checked_at && p.status === 'active' && <button type="button" onClick={() => checkAuto(p)}>확인</button>}
                    {p.auto_approved_at && !p.auto_checked_at && p.status === 'active' && <button type="button" onClick={() => review(p, false)}>내리기</button>}
                    <button type="button" onClick={() => { setEditing(p); setMessage('') }}>{p.status === 'pending' ? '열어 보기' : '수정'}</button>
                    {/* 옵션 상품은 옵션마다 재고가 있어서 [수정]에서 옵션 재고를 바꾼다 */}
                    {p.sold_out || p.options.length > 0 ? null : <button type="button" onClick={() => quickStock(p, 0)}>품절 처리</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      </div>
    </section>
  )
}

const ADMIN_FILTERS = [
  ['all', '전체', () => true],
  ['review', '검토 대기', (p) => p.status === 'pending'],
  ['auto', '자동 승인 확인 전', (p) => p.status === 'active' && p.auto_approved_at && !p.auto_checked_at],
  ['selling', '판매 중', (p) => p.status === 'active' && !p.sold_out],
  ['soldout', '품절', (p) => p.status === 'active' && p.sold_out],
  ['flag', '고시·당도 확인', (p) => p.notice_missing?.length > 0 || (p.show_brix && p.brix && !p.brix_photo_url) || p.info_no > 0],
  ['draft', '임시·반려', (p) => p.status === 'draft'],
]

export default Admin
