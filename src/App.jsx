import { useEffect, useRef, useState } from 'react'
import './App.css'
import Admin from './admin/Admin.jsx'
import Seller from './seller/Seller.jsx'
import { Chat } from './Chat.jsx'
import { B2bForm, QuestionForm } from './Inquiry.jsx'
import { Featured, Quiz, Related } from './Recommend.jsx'
import { Cart } from './shop/Cart.jsx'
import { Checkout } from './shop/Checkout.jsx'
import { OrderFail, OrderLookup, OrderSuccess, Policy } from './shop/Orders.jsx'
import { addToCart } from './shop/shared.js'
import { ShopLayout } from './shop/ShopLayout.jsx'
import { FindPasswordPage, LoginPage, MyPage, ResetPasswordPage, SignupPage } from './account/Account.jsx'
import { netFetch } from './net.js'

// 1단계 데이터 확인용 화면. 실제 디자인은 시안이 나오면 3단계에서 새로 만든다.
async function api(path) {
  const response = await netFetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `요청이 실패했어요 (${response.status})`)
  return data
}

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`
const CATEGORIES = ['전체', '과일', '채소', '가공품']

// 7단계: 수량 고르기 → 장바구니 담기 / 바로 구매 (가격은 주문할 때 서버가 다시 계산)
function BuyBox({ product, onAsk }) {
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  if (product.sold_out) {
    return (
      <div className="actions">
        <span className="button ghost">품절</span>
        <button type="button" className="button ghost" onClick={onAsk}>입고 문의하기</button>
      </div>
    )
  }
  const max = Math.min(product.stock, 99)
  return (
    <div className="buy">
      <label className="qty">수량
        <select value={quantity} onChange={(e) => { setQuantity(Number(e.target.value)); setAdded(false) }}>
          {Array.from({ length: Math.min(max, 20) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span className="price">{won(product.price * quantity)}</span>
      <div className="actions">
        <button type="button" className="button ghost" onClick={() => { addToCart(product.product_code, quantity); setAdded(true) }}>장바구니 담기</button>
        <a className="button" href={`/checkout?item=${encodeURIComponent(product.product_code)}&qty=${quantity}`}>바로 구매</a>
      </div>
      {added && <p className="success">장바구니에 담았어요. <a href="/cart">장바구니 보기</a></p>}
    </div>
  )
}

// focus: AI 상담에서 넘어오면 'b2b'(기업 문의 폼 열기) 또는 'qna'(Q&A로 내리기)
function ProductDetail({ code, focus, onBack, onOpen }) {
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  const [showB2b, setShowB2b] = useState(focus === 'b2b')
  const [sentMessage, setSentMessage] = useState('')
  const qnaRef = useRef(null)

  useEffect(() => {
    api(`/products/${code}`).then(setProduct).catch((e) => setError(e.message))
  }, [code])

  useEffect(() => {
    if (product && focus === 'qna') qnaRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [product, focus])

  if (error) return <p className="error">{error}</p>
  if (!product) return <p className="muted">불러오는 중…</p>
  const { item, seller } = product
  const fresh = item.category !== '가공품'

  return (
    <article className="detail">
      <button type="button" className="link" onClick={onBack}>← 목록</button>
      {product.image_url && <img className="hero" src={product.image_url} alt={product.name} />}
      <h2>{product.name}</h2>
      <p className="price">{won(product.price)} <span className="muted">/ {product.unit}</span></p>
      {product.sold_out && <p className="badge soldout">품절</p>}

      <dl>
        {product.weight_g && <><dt>1개 무게</dt><dd>{product.weight_g}g</dd></>}
        {product.count_per_box && <><dt>박스당</dt><dd>{product.count_per_box}개</dd></>}
        {item.show_brix && product.brix && (
          <><dt>당도</dt><dd>{product.brix}Brix{product.brix_measured_at && ` · ${product.brix_measured_at.slice(0, 10)} 측정`}</dd></>
        )}
        {product.harvest_date && <><dt>수확일</dt><dd>{product.harvest_date.slice(0, 10)}</dd></>}
        <dt>판매 농가</dt><dd>{seller.name} · {seller.region}</dd>
      </dl>

      <section className="box">
        <h3>보관·섭취 안내</h3>
        <p>{item.storage_method}</p>
        {fresh && item.fresh_days_stage1 && (
          <p>받은 날부터 {item.fresh_days_stage1}일까지: {item.stage1_uses.join(', ')} → {item.fresh_days_stage2}일까지: {item.stage2_uses.join(', ')} → 그 뒤: {item.stage3_uses.join(', ')}</p>
        )}
        {item.opened_note && <p>{item.opened_note}</p>}
        {item.allergens.length > 0 && <p className="warn">알레르기: {item.allergens.join(', ')}</p>}
        {item.danger_signs.length > 0 && <p className="muted">이런 상태면 드시지 마세요: {item.danger_signs.join(', ')}</p>}
      </section>

      <section className="box">
        <h3>이렇게 즐겨 보세요</h3>
        <ul>
          {item.recipes.map((r) => (
            <li key={r.title}><strong>{r.title}</strong> — {r.ingredients} · {r.method}</li>
          ))}
        </ul>
      </section>

      <section className="box">
        <h3>판매 농가 이야기</h3>
        <p>{seller.story}</p>
      </section>

      <BuyBox product={product} onAsk={() => qnaRef.current?.scrollIntoView({ behavior: 'smooth' })} />
      <div className="actions">
        <button type="button" className="link" onClick={() => qnaRef.current?.scrollIntoView({ behavior: 'smooth' })}>상품 문의하기</button>
        {product.b2b_available && (
          <button type="button" className="button ghost" onClick={() => setShowB2b(true)}>기업 구매 문의 (대량·납품)</button>
        )}
      </div>
      {showB2b && <B2bForm product={product} onClose={() => setShowB2b(false)} />}

      <section className="box" ref={qnaRef}>
        <h3>Q&A {product.questions.length}개</h3>
        <QuestionForm
          productCode={product.product_code}
          onSent={(q) => {
            setProduct((prev) => ({ ...prev, questions: [q, ...prev.questions] }))
            setSentMessage('질문이 올라갔어요. 답변이 달리면 여기에 보여요.')
          }}
        />
        {sentMessage && <p className="success">{sentMessage}</p>}
        <ul>
          {product.questions.map((q) => (
            <li key={q.id}>
              <strong>Q.</strong> {q.question} <span className="muted">· {q.author}</span><br />
              {q.answer ? <><strong>A.</strong> {q.answer}</> : <span className="muted">답변을 기다리는 중</span>}
            </li>
          ))}
        </ul>
      </section>
      <Related code={product.product_code} onOpen={onOpen} />
    </article>
  )
}

function App() {
  if (window.location.pathname.startsWith('/seller')) {
    return (
      <div className="app">
        <header>
          <h1>농가 판매 자사몰 · 판매자</h1>
          <p className="notice">개발 중 · 농가 판매자 화면입니다. 내 농가 상품만 보여요. <a href="/">소비자 화면으로</a></p>
        </header>
        <Seller />
      </div>
    )
  }
  if (window.location.pathname.startsWith('/admin')) {
    return (
      <div className="app">
        <header>
          <h1>농가 판매 자사몰 · 관리자</h1>
          <p className="notice">개발 중 · 관리자 화면입니다. <a href="/">소비자 화면으로</a></p>
        </header>
        <Admin />
      </div>
    )
  }
  return <ShopLayout>{shopPage(window.location.pathname)}</ShopLayout>
}

function shopPage(path) {
  if (path === '/cart') return <Cart />
  if (path === '/checkout') return <Checkout />
  if (path === '/order/success') return <OrderSuccess />
  if (path === '/order/fail') return <OrderFail />
  if (path === '/order/lookup') return <OrderLookup />
  if (path.startsWith('/policy/')) return <Policy kind={path.split('/')[2]} />
  if (path === '/account/login') return <LoginPage />
  if (path === '/account/signup') return <SignupPage />
  if (path === '/account/find') return <FindPasswordPage />
  if (path === '/account/reset') return <ResetPasswordPage />
  if (path === '/account') return <MyPage />
  return <Storefront />
}

function Storefront() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('전체')
  const [selected, setSelected] = useState(null) // { code, focus, n }
  const [error, setError] = useState('')

  useEffect(() => {
    const query = category === '전체' ? '' : `?category=${encodeURIComponent(category)}`
    api(`/products${query}`).then(setProducts).catch((e) => setError(e.message))
  }, [category])

  const open = (code, focus = null) => {
    setSelected((prev) => ({ code, focus, n: (prev?.n ?? 0) + 1 }))
    window.scrollTo({ top: 0 })
  }

  return (
    <>
      {error && <p className="error">{error}</p>}

      {selected ? (
        <ProductDetail key={`${selected.code}-${selected.n}`} code={selected.code} focus={selected.focus} onBack={() => setSelected(null)} onOpen={open} />
      ) : (
        <>
          <Featured onOpen={open} />
          <Quiz onOpen={open} />
          <nav className="tabs">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className={c === category ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </nav>
          <ul className="grid">
            {products.map((p) => (
              <li key={p.product_code}>
                <button type="button" className={`card${p.sold_out ? ' dim' : ''}`} onClick={() => open(p.product_code)}>
                  {p.image_url && <img className="thumb" src={p.image_url} alt="" />}
                  <span className="cat">{p.category}</span>
                  <strong>{p.name}</strong>
                  <span>{p.sold_out ? '품절' : won(p.price)}</span>
                  <span className="muted">{p.seller_name}</span>
                  {p.show_brix && p.brix && <span className="badge">당도 {p.brix}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Chat productCode={selected?.code ?? null} onOpenProduct={open} />
    </>
  )
}

export default App
