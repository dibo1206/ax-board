import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi } from './api.js'
import { BannedWords } from './BannedWords.jsx'
import { ChatLogs } from './ChatLogs.jsx'
import { AdminPosts } from './Posts.jsx'
import { Settings } from './Settings.jsx'
import { Staff } from './Staff.jsx'
import { SiteContent } from './SiteContent.jsx'
import { ItemReview } from './ItemReview.jsx'
import { SellerApproval } from './SellerApproval.jsx'
import { Inbox } from './Inbox.jsx'
import { AccessLogs } from './AccessLogs.jsx'
import { Dashboard } from './Dashboard.jsx'
import { FarmOverview } from './FarmOverview.jsx'
import { Notifications } from './Notifications.jsx'
import { AdminReviews } from './Reviews.jsx'
import { Orders } from './Orders.jsx'
import { Returns } from './Returns.jsx'
import { ProductForm } from './ProductForm.jsx'
import { usePage } from './paging.js'
import { Chip, CountBadge, FilterChips, MoreMenu, Pager, ProductStatus, StockChip, Thumb } from './ui.jsx'

// 관리자 화면: 왼쪽 큰 메뉴 5개(홈·주문·상품·손님·홈페이지) + 설정. 큰 메뉴 안의 화면은 위쪽 탭으로 나눈다.
// 모든 요청은 /api/admin (로그인 쿠키 필요)
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
    return ['dashboard', 'orders', 'returns', 'products', 'items', 'sellers', 'inbox', 'reviews', 'chat', 'site', 'posts', 'mail', 'access', 'banned', 'settings', 'staff'].includes(t) ? t : 'dashboard'
  })
  const [productFilter, setProductFilter] = useState('all')
  const [productQuery, setProductQuery] = useState('')
  // 상품 관리를 '상품으로 보기' / '농가별로 보기'로 (2026-11-09). farm: 한 농가 상품만 볼 때 그 농가 코드
  const [productView, setProductView] = useState('list')
  const [farm, setFarm] = useState('')
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

  // 상품 목록은 걸러 보기·검색 뒤 20개씩 (훅이라 아래 return 들보다 먼저 부른다)
  const farmProducts = farm ? products.filter((p) => p.seller_code === farm) : products
  const shownProducts = farmProducts
    .filter(ADMIN_FILTERS.find(([key]) => key === productFilter)?.[2] ?? (() => true))
    .filter((p) => !productQuery.trim() || `${p.name} ${p.seller_name} ${p.item_name}`.includes(productQuery.trim()))
  const productPage = usePage(shownProducts, 20, `${productFilter}|${productQuery}|${farm}`)
  // 농가별 숫자: 상품이 없는 농가도 나오게 농가 목록(options.sellers)에서 시작해 상품을 한 번만 훑는다
  const farmRows = (() => {
    const blank = { total: 0, selling: 0, pending: 0, soldout: 0, check: 0, draft: 0 }
    const by = new Map((options?.sellers ?? []).map((s) => [s.seller_code, { ...s, ...blank }]))
    for (const p of products) {
      if (!by.has(p.seller_code)) by.set(p.seller_code, { seller_code: p.seller_code, name: p.seller_name, region: '', ...blank })
      const f = by.get(p.seller_code)
      f.total += 1
      if (p.status === 'pending') f.pending += 1
      else if (p.status === 'draft') f.draft += 1
      else if (p.sold_out) f.soldout += 1
      else f.selling += 1
      if (productFlags(p).some((x) => x.tone !== 'gray')) f.check += 1 // 수정 이력(회색)만 있는 건 '확인 필요'로 세지 않는다
    }
    return [...by.values()]
  })()
  const farmName = farmRows.find((f) => f.seller_code === farm)?.name ?? farm
  const pickFarm = (code) => { setFarm(code); setProductView('list'); setProductFilter('all'); setProductQuery('') }

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
  // 큰 메뉴(섹션)와 그 안의 화면(탭). 숫자는 할 일 개수 — 큰 메뉴에는 안쪽 화면 숫자를 더해서 보여 준다
  const SECTIONS = [
    { key: 'home', label: '홈', icon: ICONS.home, tabs: [['dashboard', '오늘 할 일', 0]] },
    { key: 'orders', label: '주문', icon: ICONS.orders, tabs: [['orders', '주문', newOrders], ['returns', '반품', counts?.returns_requested ?? 0]] },
    { key: 'products', label: '상품', icon: ICONS.products, tabs: [['products', '상품 관리', pending + (counts?.auto_unchecked ?? 0)], ['items', '품목 검수', counts?.pending_items ?? 0], ['sellers', '판매자 승인', counts?.pending_sellers ?? 0]] },
    { key: 'customers', label: '손님', icon: ICONS.customers, tabs: [['inbox', '문의함', waiting], ['reviews', '후기', 0], ['chat', '상담 기록', 0]] },
    { key: 'site', label: '홈페이지', icon: ICONS.site, tabs: [['site', '홈페이지 관리', 0], ['posts', '게시판', 0]] },
  ]
  // 자주 안 쓰는 설정·기록은 맨 아래 [설정] 하나로
  const SETTINGS = { key: 'settings', label: '설정', icon: ICONS.settings, tabs: [['settings', '쇼핑몰 설정', 0], ['staff', '관리자 계정', 0], ['mail', '알림 기록', 0], ['access', '접속 기록', 0], ['banned', '금지어', 0]] }
  const section = [...SECTIONS, SETTINGS].find((s) => s.tabs.some(([key]) => key === tab)) ?? SECTIONS[0]
  const sum = (s) => s.tabs.reduce((n, [, , c]) => n + c, 0)
  const navButton = (s) => (
    <button key={s.key} type="button" className={section.key === s.key ? 'on' : ''} aria-current={section.key === s.key ? 'page' : undefined} onClick={() => open(s.tabs[0][0])}>
      <span className="nav-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={s.icon} /></svg>{s.label}</span>
      <CountBadge n={sum(s)} />
    </button>
  )

  return (
    <section className="console-layout">
      <aside className="side-nav" aria-label="관리자 메뉴">
        <div className="nav-main">{SECTIONS.map(navButton)}</div>
        <div className="nav-foot">
          {navButton(SETTINGS)}
          <div className="account">
            <span>{me.loginId} 로그인 중</span>
            {!me.mfa && <Chip tone="amber" title="관리자 계정 화면에서 등록해요">2단계 인증 미등록</Chip>}
            <button type="button" className="link" onClick={logout}>로그아웃</button>
          </div>
        </div>
      </aside>
      <div className="console-content">
      <header className="section-head">
        <h2>{section.label === '홈' ? '오늘 할 일' : section.label}</h2>
        {section.tabs.length > 1 && (
          <nav className="sub-tabs" aria-label={`${section.label} 화면`}>
            {section.tabs.map(([key, label, n]) => (
              <button key={key} type="button" className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => open(key)}>{label}<CountBadge n={n} /></button>
            ))}
          </nav>
        )}
      </header>
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
      ) : tab === 'staff' ? (
        <Staff />
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
          <div className="view-switch" role="group" aria-label="보는 방식">
            <button type="button" className={productView === 'list' ? 'on' : ''} aria-pressed={productView === 'list'} onClick={() => setProductView('list')}>상품으로 보기 <span>{products.length}</span></button>
            <button type="button" className={productView === 'farms' ? 'on' : ''} aria-pressed={productView === 'farms'} onClick={() => setProductView('farms')}>농가별로 보기 <span>{farmRows.length}곳</span></button>
          </div>
          {productView === 'farms' ? <FarmOverview rows={farmRows} onPick={pickFarm} /> : (
          <>
          {farm && (
            <p className="farm-picked">
              <b>{farmName}</b> 상품 {farmProducts.length}개만 보는 중
              <button type="button" className="link" onClick={() => setFarm('')}>× 모든 농가</button>
              <button type="button" className="link" onClick={() => setProductView('farms')}>다른 농가 고르기</button>
            </p>
          )}
          <div className="toolbar">
            <FilterChips value={productFilter} onChange={setProductFilter} items={ADMIN_FILTERS.map(([key, label, f]) => ({ key, label, count: farmProducts.filter(f).length }))} />
            <div className="actions">
              <input type="search" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder={farm ? '이 농가 상품 찾기' : '상품·농가 찾기'} aria-label="상품 찾기" />
              <button type="button" className="button" onClick={() => { setEditing('new'); setMessage('') }}>+ 새 상품 등록</button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr><th>상품</th><th>가격</th><th>재고</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {productPage.rows.map((p) => {
                const flags = productFlags(p)
                const autoUnchecked = p.auto_approved_at && !p.auto_checked_at && p.status === 'active'
                const edit = () => { setEditing(p); setMessage('') }
                return (
                <tr key={p.product_code} className={p.sold_out ? 'dim' : ''}>
                  <td><div className="cell-product"><Thumb url={p.image_url} size={56} /><div><strong>{p.name}</strong><br /><span className="muted">{p.category} · </span>{farm ? <span className="muted">{p.seller_name}</span> : <button type="button" className="link farm-link" title="이 농가 상품만 보기" onClick={() => pickFarm(p.seller_code)}>{p.seller_name}</button>}
                    {p.status === 'pending' && p.review_reason && <><br /><span className="muted">{p.review_reason}</span></>}
                    {/* 표시는 가장 급한 하나만, 나머지는 개수로 (마우스를 올리면 전부) */}
                    {flags.length > 0 && (
                      <div className="cell-flags">
                        {flags[0].key === 'item'
                          ? <button type="button" className="chip chip-amber" onClick={() => open('items')}>{flags[0].text}</button>
                          : <Chip tone={flags[0].tone} title={flags[0].title}>{flags[0].text}</Chip>}
                        {flags.length > 1 && <Chip title={flags.slice(1).map((f) => f.text).join(', ')}>+{flags.length - 1}</Chip>}
                      </div>
                    )}
                  </div></div></td>
                  <td>{won(p.price)}{p.options.length > 0 && '부터'}</td>
                  <td><StockChip product={p} />{p.options.length > 0 && <><br /><span className="muted">옵션 {p.options.length}개</span></>}</td>
                  <td><ProductStatus product={p} /></td>
                  {/* 자주 쓰는 버튼 하나만 밖에: 검토 대기 → 승인, 자동 승인 확인 전 → 확인, 나머지 → 수정 */}
                  <td className="row-actions">
                    {p.status === 'pending' ? <button type="button" className="primary" onClick={() => review(p, true)}>승인</button>
                      : autoUnchecked ? <button type="button" className="primary" onClick={() => checkAuto(p)}>확인</button>
                        : <button type="button" onClick={edit}>수정</button>}
                    <MoreMenu label={`${p.name} 다른 작업`}>
                      {(p.status === 'pending' || autoUnchecked) && <button type="button" onClick={edit}>{p.status === 'pending' ? '열어 보기' : '수정'}</button>}
                      {p.status === 'pending' && <button type="button" onClick={() => review(p, false)}>반려</button>}
                      {autoUnchecked && <button type="button" onClick={() => review(p, false)}>판매 내리기</button>}
                      {/* 옵션 상품은 옵션마다 재고가 있어서 [수정]에서 옵션 재고를 바꾼다 */}
                      {!p.sold_out && p.options.length === 0 && <button type="button" onClick={() => quickStock(p, 0)}>품절 처리</button>}
                      <a href={`/p/${encodeURIComponent(p.product_code)}`} target="_blank" rel="noreferrer">손님 화면에서 보기</a>
                    </MoreMenu>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          <Pager paging={productPage} />
          </>
          )}
        </>
      )}
      </div>
    </section>
  )
}

// 상품 줄에 붙는 확인 표시, 급한 순서 (거짓 표시 막기: 고시 미입력, 후기의 '표시와 달랐어요', 당도계 사진 없는 당도, 판매 중 수정 이력)
function productFlags(p) {
  return [
    p.item_status === 'pending' && { key: 'item', tone: 'amber', text: '품목 검수 전' },
    p.notice_missing?.length > 0 && { key: 'notice', tone: 'red', text: `고시 미입력 ${p.notice_missing.length}`, title: p.notice_missing.join(', ') },
    p.info_no > 0 && { key: 'info', tone: 'red', text: `표시와 다름 후기 ${p.info_no}` },
    p.auto_approved_at && !p.auto_checked_at && p.status === 'active' && { key: 'auto', tone: 'amber', text: '자동 승인 · 확인 전' },
    p.show_brix && p.brix && !p.brix_photo_url && { key: 'brix', tone: 'amber', text: '당도 사진 없음' },
    p.changes > 0 && { key: 'changes', tone: 'gray', text: `수정 이력 ${p.changes}` },
  ].filter(Boolean)
}

// 왼쪽 큰 메뉴 아이콘 (선 그림)
const ICONS = {
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  products: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  customers: 'M5 5h14v10H9l-4 4z',
  site: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
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
