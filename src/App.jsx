import { useEffect, useState } from 'react'
import './App.css'
import Admin from './admin/Admin.jsx'

// 1단계 데이터 확인용 화면. 실제 디자인은 시안이 나오면 3단계에서 새로 만든다.
async function api(path) {
  const response = await fetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `요청이 실패했어요 (${response.status})`)
  return data
}

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`
const CATEGORIES = ['전체', '과일', '채소', '가공품']

function ProductDetail({ code, onBack }) {
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api(`/products/${code}`).then(setProduct).catch((e) => setError(e.message))
  }, [code])

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

      <div className="actions">
        {product.external_url ? (
          <a className="button" href={product.external_url} target="_blank" rel="noreferrer">구매하기</a>
        ) : (
          <span className="button ghost">문의하기 (판매 링크 없음)</span>
        )}
        {product.b2b_available && <span className="button ghost">기업 구매 문의 (4단계)</span>}
      </div>

      <section className="box">
        <h3>Q&A {product.questions.length}개</h3>
        <ul>
          {product.questions.map((q) => (
            <li key={q.id}>
              <strong>Q.</strong> {q.question}<br />
              {q.answer ? <><strong>A.</strong> {q.answer}</> : <span className="muted">답변을 기다리는 중</span>}
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}

function App() {
  if (window.location.pathname.startsWith('/admin')) {
    return (
      <div className="app">
        <header>
          <h1>농가 판매 자사몰 · 관리자</h1>
          <p className="notice">개발 중 · 2단계 관리자 화면입니다. <a href="/">소비자 화면으로</a></p>
        </header>
        <Admin />
      </div>
    )
  }
  return <Storefront />
}

function Storefront() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('전체')
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const query = category === '전체' ? '' : `?category=${encodeURIComponent(category)}`
    api(`/products${query}`).then(setProducts).catch((e) => setError(e.message))
  }, [category])

  return (
    <div className="app">
      <header>
        <h1>농가 판매 자사몰</h1>
        <p className="notice">개발 중 · 데이터 확인 화면입니다. 모든 데이터는 [예시]이고, 디자인은 시안이 나오면 바꿉니다. <a href="/admin">관리자</a></p>
      </header>

      {error && <p className="error">{error}</p>}

      {selected ? (
        <ProductDetail code={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <nav className="tabs">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className={c === category ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </nav>
          <ul className="grid">
            {products.map((p) => (
              <li key={p.product_code}>
                <button type="button" className={`card${p.sold_out ? ' dim' : ''}`} onClick={() => setSelected(p.product_code)}>
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
    </div>
  )
}

export default App
