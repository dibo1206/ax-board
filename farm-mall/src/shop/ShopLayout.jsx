import { useEffect, useState } from 'react'
import './shop.css'
import { BRAND } from './home/content.js'
import { cartCount, getAccount, getPolicy } from './shared.js'

// 손님 화면 공통 틀 (디자인 시안): 위쪽 YOONJU MARKET · 가운데 메뉴 · 오른쪽 검색·로그인·장바구니, 아래쪽 회사 정보·약관
const MENU = [['상품', 'products'], ['제철 달력', 'season'], ['이야기', 'story'], ['문의·FAQ', 'faq']]
const onHome = () => window.location.pathname === '/'

// 첫 화면이면 그 부분으로 부드럽게 내리고, 다른 화면이면 /#부분 으로 이동
function goSection(e, id) {
  if (!onHome()) return
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (id === 'products') setTimeout(() => document.getElementById('product-search')?.focus({ preventScroll: true }), 400)
}

function openQuiz(e) {
  if (!onHome()) return // /#recommend 로 이동하면 첫 화면이 추천받기 창을 연다
  e.preventDefault()
  window.dispatchEvent(new Event('open-quiz'))
}

export function Logo() {
  return <a href="/" className="logo" aria-label={`${BRAND.strong} ${BRAND.light} 처음으로`}><b>{BRAND.strong}</b> {BRAND.light}</a>
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

  const shop = policy?.shop
  return (
    <div className="shop">
      <a className="skip" href="#main">본문으로 건너뛰기</a>
      {policy?.payment.test && (
        <p className="dev-bar">개발 중 · 모든 상품은 [예시]이고 테스트 결제라 실제로 돈이 나가지 않아요. <a href="/admin">관리자</a> · <a href="/seller">판매자</a></p>
      )}
      <header className="site-head">
        <div className="wrap site-head-inner">
          <Logo />
          <nav className="site-menu" aria-label="메뉴">
            {MENU.map(([label, id]) => <a key={id} href={`/#${id}`} onClick={(e) => goSection(e, id)}>{label}</a>)}
            <a href="/#recommend" onClick={openQuiz}>추천받기</a>
          </nav>
          <nav className="site-tools" aria-label="내 메뉴">
            <a href="/#products" className="tool-search" onClick={(e) => goSection(e, 'products')}>검색</a>
            {account ? <a href="/account">{account.name}님</a> : <a href="/account/login">로그인</a>}
            <a href="/cart" className="cart-link">장바구니 <span className="count-box" aria-label={`${count}개`}>{count}</span></a>
          </nav>
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
          </div>
          <nav className="foot-links" aria-label="약관">
            <a href="/policy/terms">이용약관</a>
            <a href="/policy/privacy"><b>개인정보 처리방침</b></a>
            <a href="/policy/refund">교환·환불 정책</a>
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
    </div>
  )
}
