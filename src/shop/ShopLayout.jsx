import { useEffect, useState } from 'react'
import { cartCount, getAccount, getPolicy } from './shared.js'

// 손님 화면 공통 틀: 위쪽 메뉴(장바구니·주문 조회)와 아래쪽 사업자 정보·약관
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
    <div className="app">
      <header className="shop-head">
        <a href="/" className="brand">{shop?.name ?? '농가 판매 자사몰'}</a>
        <nav className="shop-nav">
          {account ? <a href="/account">{account.name}님</a> : <a href="/account/login">로그인</a>}
          {!account && <a href="/order/lookup">주문 조회</a>}
          <a href="/cart">장바구니{count > 0 && <span className="count">{count}</span>}</a>
        </nav>
      </header>
      <p className="notice">
        개발 중 · 모든 데이터는 [예시]이고, 디자인은 시안이 나오면 바꿉니다.
        {policy?.payment.test && ' 지금은 테스트 결제라 실제로 돈이 나가지 않아요.'} <a href="/admin">관리자</a> · <a href="/seller">판매자</a>
      </p>
      {children}
      <footer className="shop-foot">
        <nav>
          <a href="/policy/terms">이용약관</a>
          <a href="/policy/privacy"><b>개인정보 처리방침</b></a>
          <a href="/policy/refund">교환·환불 정책</a>
        </nav>
        {shop && (
          <p>
            {shop.company} · 대표 {shop.ceo} · 사업자등록번호 {shop.bizNo} · 통신판매업 {shop.mailOrderNo}<br />
            {shop.address} · 고객센터 {shop.phone} · {shop.email}
          </p>
        )}
      </footer>
    </div>
  )
}
