import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import './shop.css'
import { clearChat } from '../chatStore.js'
import { BRAND } from './home/content.js'
import { cartCount, get, getAccount, getPolicy, post, readCart, thumbUrl, won } from './shared.js'

// 손님 화면 공통 틀 (디자인 시안): 위쪽 YOONJU MARKET · 가운데 메뉴 · 오른쪽 검색·로그인·장바구니, 아래쪽 회사 정보·약관
const MENU = [['상품', 'products'], ['제철 달력', 'season'], ['이야기', 'story'], ['문의·FAQ', 'faq']]
const onHome = () => window.location.pathname === '/'

// 첫 화면이면 그 부분으로 부드럽게 내리고, 다른 화면이면 /#부분 으로 이동
function goSection(e, id) {
  if (!onHome()) return
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openQuiz(e) {
  if (!onHome()) return // /#recommend 로 이동하면 첫 화면이 추천받기 창을 연다
  e.preventDefault()
  window.dispatchEvent(new Event('open-quiz'))
}

export function Logo() {
  return <a href="/" className="logo" aria-label={`${BRAND.strong} ${BRAND.light} 처음으로`}><img src="/home/logo.webp" alt={BRAND.company} width="320" height="56" /></a>
}

export function ShopLayout({ children }) {
  const [count, setCount] = useState(cartCount)
  const [policy, setPolicy] = useState(null)
  const [account, setAccount] = useState(null)

  useEffect(() => {
    const update = () => setCount(cartCount())
    window.addEventListener('cart-change', update)
    window.addEventListener('storage', update)
    getPolicy().then(setPolicy).catch(() => {})
    const reloadAccount = () => getAccount().then(setAccount)
    reloadAccount()
    window.addEventListener('account-change', reloadAccount)
    return () => {
      window.removeEventListener('cart-change', update)
      window.removeEventListener('storage', update)
      window.removeEventListener('account-change', reloadAccount)
    }
  }, [])

  async function logout() {
    await post('/account/logout', {}).catch(() => {})
    clearChat()
    window.dispatchEvent(new Event('account-change'))
    window.location.href = '/'
  }

  const shop = policy?.shop
  return (
    <div className="shop">
      <a className="skip" href="#main">본문으로 건너뛰기</a>
      <StaffBar />
      {policy?.payment.test && (
        <p className="dev-bar">개발 중 · 모든 상품은 [예시]이고 테스트 결제라 실제로 돈이 나가지 않아요. <a href="/guide">1분 사용 안내</a> · <a href="/admin">관리자</a> · <a href="/seller">판매자</a></p>
      )}
      <header className="site-head">
        <div className="wrap site-head-inner">
          <Logo />
          <nav className="site-menu" aria-label="메뉴">
            {MENU.map(([label, id]) => <a key={id} href={`/#${id}`} onClick={(e) => goSection(e, id)}>{label}</a>)}
            <a href="/#recommend" onClick={openQuiz}>추천받기</a>
            <a href="/about">회사소개</a>
            <a href="/notice">공지사항</a>
          </nav>
          <HeaderSearch />
          <div className="site-tools">
            <nav className="tools-main" aria-label="내 메뉴">
              <a href="/order/lookup" className="order-link">주문조회</a>
              {/* 마이페이지는 로그인하지 않아도 보인다 (누르면 로그인 화면). 새 답변이 있으면 숫자로 알린다 */}
              <a href={account?.unreadAnswers ? '/account?tab=questions' : '/account'} className="my-link"
                aria-label={account?.unreadAnswers ? `마이페이지, 새 답변 ${account.unreadAnswers}개` : '마이페이지'}>
                마이페이지{account?.unreadAnswers > 0 && <span className="new-dot" aria-hidden="true">{account.unreadAnswers}</span>}
              </a>
              <a href="/cart" className="icon-link cart-link" aria-label={`장바구니 ${count}개`}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.5l2.2 10.5h10.1L20 7H6.3" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></svg>
                {count > 0 && <span className="count-box" aria-hidden="true">{count}</span>}
              </a>
            </nav>
            <p className="tools-auth">
              {account ? (
                <><span>{account.name}님</span><button type="button" className="link-btn" onClick={logout}>로그아웃</button></>
              ) : (
                <><a href="/account/login">로그인</a><a href="/account/signup">회원가입</a></>
              )}
            </p>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-foot">
        <div className="wrap">
          <div className="foot-row">
            <Logo />
            <span>{BRAND.company} · {BRAND.region}</span>
            {BRAND.siteUrl && <a href={BRAND.siteUrl} target="_blank" rel="noopener noreferrer" className="underline">기업 소개 사이트</a>}
            <a href="/order/lookup" className="underline">주문 조회</a>
            <a href="/guide" className="underline">1분 사용 안내</a>
            <a href="/about" className="underline">회사 소개</a>
            <a href="/notice" className="underline">공지사항</a>
            <a href="/press" className="underline">언론보도</a>
            <a href="/about#location" className="underline">오시는 길</a>
            <a href="/sitemap" className="underline">사이트맵</a>
          </div>
          <nav className="foot-links" aria-label="약관">
            <a href="/policy/terms">이용약관</a>
            <a href="/policy/privacy"><b>개인정보 처리방침</b></a>
            <a href="/policy/refund">교환·환불 정책</a>
            <a href="/policy/noemail">이메일무단수집거부</a>
          </nav>
          {shop && (
            <p className="foot-biz">
              {shop.company} · 대표 {shop.ceo} · 사업자등록번호 {shop.bizNo} · 통신판매업 {shop.mailOrderNo}<br />
              {shop.address}<br />
              대표전화 <a href={`tel:${shop.phone.replace(/\D/g, '')}`}>{shop.phone}</a> · {shop.email}{shop.hours && ` · ${shop.hours}`}
            </p>
          )}
          <p className="foot-copy">© Yunjufarm.</p>
        </div>
      </footer>
      <CartToast />
    </div>
  )
}

// 관리자·판매자로 로그인한 채 쇼핑몰을 보면 맨 위에 막대를 띄운다: 관리자 화면으로 돌아가기, 홈페이지 관리, 보고 있는 상품 고치기
function StaffBar() {
  const [staff, setStaff] = useState(null)
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    get('/staff').then(setStaff).catch(() => {})
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  if (!staff) return null
  if (staff.role === 'seller') {
    return <div className="staff-bar" role="region" aria-label="판매자 메뉴"><span>판매자({staff.loginId})로 보는 중</span><a href="/seller">판매자 센터로</a></div>
  }
  const code = path.startsWith('/p/') ? decodeURIComponent(path.slice(3)) : null
  return (
    <div className="staff-bar" role="region" aria-label="관리자 메뉴">
      <span>관리자({staff.loginId})로 보는 중</span>
      <a href="/admin">관리자 화면</a>
      <a href="/admin?tab=site">홈페이지 관리</a>
      <a href="/admin?tab=posts">공지·언론</a>
      {code && <a href={`/admin?tab=products&edit=${encodeURIComponent(code)}`}>이 상품 고치기</a>}
    </div>
  )
}

const SearchIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>

// 첫 화면·상품 상세는 같은 화면(Storefront)이라 주소만 바꾸고 알린다. 다른 화면에서는 이동
function goTo(url) {
  if (onHome() || window.location.pathname.startsWith('/p/')) {
    window.history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
    if (url.startsWith('/p/')) window.scrollTo(0, 0)
  } else {
    window.location.href = url
  }
}

// 헤더 검색: 누르면 그 자리에서 바로 적는다. 적는 동안 맞는 상품을 아래에 6개까지 보여 주고, Enter 면 상품 목록 전체 결과로.
// 휴대폰에서는 돋보기를 누르면 화면 위에 검색칸이 열린다. 위·아래 화살표로 결과를 고르고 Esc 로 닫는다
function HeaderSearch() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(() => (onHome() ? new URLSearchParams(window.location.search).get('q') ?? '' : ''))
  const [result, setResult] = useState(null)
  const [show, setShow] = useState(false)
  const box = useRef(null)
  const input = useRef(null)
  const q = text.trim()

  useEffect(() => {
    if (!q) return undefined
    const timer = setTimeout(() => {
      get(`/catalog?${new URLSearchParams({ q, size: 6 })}`).then((r) => setResult({ ...r, q })).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if (!show && !open) return undefined
    const close = (e) => {
      if (box.current?.contains(e.target)) return
      setShow(false)
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [show, open])

  function go(url) {
    setShow(false)
    setOpen(false)
    goTo(url)
  }

  function onListKey(e) {
    if (e.key === 'Escape') {
      setShow(false)
      input.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const links = [...box.current.querySelectorAll('.head-search-list a')]
    const next = links.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1)
    if (next < 0) input.current?.focus()
    else links[Math.min(next, links.length - 1)]?.focus()
  }

  const ready = Boolean(q) && result?.q === q
  const allUrl = `/?q=${encodeURIComponent(q)}#products`
  return (
    <div className={`head-search${open ? ' open' : ''}`} ref={box}>
      <button type="button" className="head-search-toggle" aria-label="상품 검색 열기" aria-expanded={open}
        onClick={() => { flushSync(() => setOpen(true)); input.current?.focus() }}>
        <SearchIcon />
      </button>
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (q) go(allUrl); else input.current?.focus() }}>
        <label htmlFor="head-search-input" className="sr-only">상품 검색</label>
        <input id="head-search-input" ref={input} type="search" value={text} placeholder="무엇을 찾으세요?" maxLength={50} autoComplete="off"
          aria-controls="head-search-list" aria-expanded={show && ready}
          onChange={(e) => { setText(e.target.value); setShow(true) }} onFocus={() => setShow(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setShow(false); setOpen(false) }
            if (e.key === 'ArrowDown' && ready) { e.preventDefault(); box.current?.querySelector('.head-search-list a')?.focus() }
          }} />
        <button type="submit" className="hs-submit" aria-label="검색"><SearchIcon /></button>
      </form>
      {show && ready && (
        <div className="head-search-list" id="head-search-list" onKeyDown={onListKey}>
          {result.total === 0 ? (
            <p className="muted">'{q}'에 맞는 상품이 없어요. 다른 말로 찾거나 오른쪽 아래 상담하기에 물어보세요.</p>
          ) : (
            <>
              {result.loose && <p className="muted">'{q}'와 딱 맞는 상품이 없어 비슷한 상품을 보여 드려요.</p>}
              <ul>
                {result.items.map((p) => {
                  const url = `/p/${encodeURIComponent(p.product_code)}`
                  return (
                    <li key={p.product_code}>
                      <a className="hs-item" href={url} onClick={(e) => { e.preventDefault(); go(url) }}>
                        {p.image_url ? <img src={thumbUrl(p.image_url)} alt="" width="44" height="44" loading="lazy" /> : <span className="hs-ph" />}
                        <span><b>{p.name}</b><small>{won(p.price)}{p.has_options ? '부터' : ''}{p.sold_out ? ' · 품절' : ''}</small></span>
                      </a>
                    </li>
                  )
                })}
              </ul>
              <a className="hs-item hs-all" href={allUrl} onClick={(e) => { e.preventDefault(); go(allUrl) }}>'{q}' 검색 결과 {result.total}개 모두 보기</a>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// 어디서 장바구니에 담든(상세·첫 화면 상품 카드·추천) 화면 아래에 "장바구니에 담겼어요" 알림을 잠깐 띄운다.
// addToCart 가 보내는 'cart-added' 신호를 받는다. 알림 칸은 늘 두고 글만 바꿔서 화면 낭독기도 읽어 준다
const TOAST_MS = 5000 // 무료 배송 게이지까지 읽을 시간

// 담은 상품의 농가 기준으로 무료 배송까지 남은 금액 (배송비는 농가마다 따로라 서버·장바구니와 같은 규칙)
async function shippingNote(productCode) {
  const [list, policy] = await Promise.all([get('/products'), getPolicy()])
  const products = Object.fromEntries(list.map((p) => [p.product_code, p]))
  const seller = products[productCode]?.seller_code
  if (!seller || !policy?.shipping?.freeOver) return null
  const lines = readCart().map((l) => ({ ...l, p: products[l.productCode] })).filter((l) => l.p)
  const farmAmount = lines.filter((l) => l.p.seller_code === seller).reduce((sum, l) => {
    const option = l.optionId ? l.p.options.find((o) => o.id === l.optionId) : null
    return sum + (l.p.has_options ? (option?.price ?? 0) : l.p.price) * l.quantity
  }, 0)
  const manyFarms = new Set(lines.map((l) => l.p.seller_code)).size > 1
  const farm = manyFarms ? `${products[productCode].seller_name.replace(/\[예시\]\s*/g, '')} 상품 ` : ''
  const left = policy.shipping.freeOver - farmAmount
  // 게이지: 무료 배송 기준 대비 지금 담은 금액 (2026-11-07 피드백)
  const percent = Math.min(100, Math.round((farmAmount / policy.shipping.freeOver) * 100))
  return left > 0
    ? { done: false, percent, text: `${won(left)} 더 담으면 ${farm}무료 배송이에요`, scale: `${won(farmAmount)} / ${won(policy.shipping.freeOver)}` }
    : { done: true, percent, text: `이제 ${farm}무료 배송이에요`, scale: `${won(policy.shipping.freeOver)} 이상 채웠어요` }
}

function CartToast() {
  const [toast, setToast] = useState(null)

  useEffect(() => {
    const show = (e) => {
      const at = Date.now()
      setToast({ ...e.detail, at })
      if (!e.detail?.productCode) return
      shippingNote(e.detail.productCode)
        .then((note) => setToast((prev) => (prev?.at === at ? { ...prev, note } : prev)))
        .catch(() => {}) // 금액을 못 불러와도 '담겼어요' 알림은 그대로
    }
    window.addEventListener('cart-added', show)
    return () => window.removeEventListener('cart-added', show)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <div className="cart-toast-zone" role="status" aria-live="polite">
      {toast && (
        <div className="cart-toast" key={toast.at}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          <span className="cart-toast-text">
            <b>장바구니에 담겼어요</b>
            {toast.name && <span className="cart-toast-name">{toast.name}{toast.quantity > 1 ? ` · ${toast.quantity}개` : ''}</span>}
            {toast.note && (
              <span className={`cart-toast-ship${toast.note.done ? ' done' : ''}`}>
                <span>{toast.note.text}</span>
                <span className="cart-toast-bar" aria-hidden="true"><span style={{ width: `${toast.note.percent}%` }} /></span>
                <small>{toast.note.scale}</small>
              </span>
            )}
          </span>
          <a href="/cart">장바구니 보기</a>
        </div>
      )}
    </div>
  )
}
