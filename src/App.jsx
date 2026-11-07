import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { Chat } from './Chat.jsx'
import { B2bForm, QuestionForm } from './Inquiry.jsx'
import { Related } from './Recommend.jsx'
import { RatingBadge, ReviewList } from './shop/Reviews.jsx'
import { addToCart, getPolicy, preorderNote, thumbUrl, unitPrice } from './shop/shared.js'
import { Guide } from './shop/Guide.jsx'
import { CategoryRows, Faq, Hero, ProductSection, QuizDialog, SeasonCalendar, Story } from './shop/home/Home.jsx'
import { ShopLayout } from './shop/ShopLayout.jsx'
import { netFetch } from './net.js'

// 첫 화면(상품 목록)에 필요 없는 페이지는 그 주소에 들어갈 때 따로 받는다 → 손님이 처음 받는 파일이 작아진다
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })))
const Admin = lazy(() => import('./admin/Admin.jsx'))
const Seller = lazy(() => import('./seller/Seller.jsx'))
const Cart = page(() => import('./shop/Cart.jsx'), 'Cart')
const Checkout = page(() => import('./shop/Checkout.jsx'), 'Checkout')
const OrderSuccess = page(() => import('./shop/Orders.jsx'), 'OrderSuccess')
const OrderFail = page(() => import('./shop/Orders.jsx'), 'OrderFail')
const OrderLookup = page(() => import('./shop/Orders.jsx'), 'OrderLookup')
const Policy = page(() => import('./shop/Orders.jsx'), 'Policy')
const LoginPage = page(() => import('./account/Account.jsx'), 'LoginPage')
const SignupPage = page(() => import('./account/Account.jsx'), 'SignupPage')
const FindPasswordPage = page(() => import('./account/Account.jsx'), 'FindPasswordPage')
const ResetPasswordPage = page(() => import('./account/Account.jsx'), 'ResetPasswordPage')
const MyPage = page(() => import('./account/Account.jsx'), 'MyPage')
const loading = <p className="muted">불러오는 중…</p>

// 1단계 데이터 확인용 화면. 실제 디자인은 시안이 나오면 3단계에서 새로 만든다.
async function api(path) {
  const response = await netFetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `요청이 실패했어요 (${response.status})`)
  return data
}

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

// 대표 사진 + 상세 사진: 작은 사진을 누르면 큰 사진이 바뀐다
function Gallery({ product }) {
  const photos = [product.image_url, ...(product.images ?? [])].filter(Boolean)
  const [index, setIndex] = useState(0)
  if (!photos.length) return null
  return (
    <div className="gallery">
      <img className="hero" src={photos[index]} alt={product.name} width="1200" height="900" fetchPriority="high" />
      {photos.length > 1 && (
        <div className="gallery-thumbs">
          {photos.map((url, i) => (
            <button key={url} type="button" className={i === index ? 'on' : ''} onClick={() => setIndex(i)} aria-label={`사진 ${i + 1}`}>
              <img src={thumbUrl(url)} alt="" loading="lazy" width="64" height="64" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 상품 설명: 글만 보여 준다 (HTML로 해석하지 않음). 빈 줄로 문단을 나눈다
function Description({ text }) {
  if (!text) return null
  return (
    <section className="box">
      <h3>상품 설명</h3>
      {/* "■ 제목" 줄은 섹션 제목으로 (AI 초안의 상세페이지 패턴) */}
      {text.split(/\n{2,}/).map((para, i) => {
        const [first, ...rest] = para.split('\n')
        return /^■\s/.test(first)
          ? <div key={i}><h4 className="para-title">{first.replace(/^■\s*/, '')}</h4>{rest.length > 0 && <p className="para">{rest.join('\n')}</p>}</div>
          : <p key={i} className="para">{para}</p>
      })}
    </section>
  )
}

// 7단계: (옵션 상품은 옵션 고르기 →) 수량 고르기 → 장바구니 담기 / 바로 구매 (가격은 주문할 때 서버가 다시 계산)
// 옵션 상품은 옵션을 고르기 전에는 담거나 살 수 없다. 옵션마다 가격·재고가 다르다
function BuyBox({ product, option, onPick, onAsk }) {
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  const soldOut = (
    <div className="actions">
      <span className="button ghost">품절</span>
      <button type="button" className="button ghost" onClick={onAsk}>입고 문의하기</button>
    </div>
  )
  if (product.sold_out) return soldOut
  const pick = product.has_options && (
    <label className="qty">옵션
      <select value={option?.id ?? ''} onChange={(e) => { onPick(Number(e.target.value) || null); setQuantity(1); setAdded(false) }}>
        <option value="">옵션을 골라 주세요</option>
        {product.options.map((o) => <option key={o.id} value={o.id}>{o.name} — {won(o.price)}{o.stock === 0 ? ' (품절)' : ''}</option>)}
      </select>
    </label>
  )
  if (product.has_options && !option) {
    return (
      <div className="buy">
        {pick}
        <p className="muted">옵션을 고르면 장바구니에 담거나 바로 살 수 있어요.</p>
        <div className="actions">
          <button type="button" className="button ghost" disabled>장바구니 담기</button>
          <button type="button" className="button" disabled>바로 구매</button>
        </div>
      </div>
    )
  }
  if (option?.stock === 0) return <div className="buy">{pick}{soldOut}</div>
  const price = option ? option.price : product.price
  const max = Math.min(option ? option.stock : product.stock, 99)
  const buyUrl = `/checkout?item=${encodeURIComponent(product.product_code)}${option ? `&option=${option.id}` : ''}&qty=${quantity}`
  return (
    <div className="buy">
      {pick}
      <label className="qty">수량
        <select value={quantity} onChange={(e) => { setQuantity(Number(e.target.value)); setAdded(false) }}>
          {Array.from({ length: Math.min(max, 20) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span className="price">{won(price * quantity)}</span>
      <div className="actions">
        <button type="button" className="button ghost" onClick={() => { addToCart(product.product_code, quantity, option?.id ?? null); setAdded(true) }}>장바구니 담기</button>
        <a className="button" href={buyUrl}>{product.preorder ? '예약 구매' : '바로 구매'}</a>
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
  const [optionId, setOptionId] = useState(null) // 옵션 상품에서 고른 옵션
  const qnaRef = useRef(null)

  useEffect(() => {
    api(`/products/${code}`).then(setProduct).catch((e) => setError(e.message))
  }, [code])

  useEffect(() => {
    if (product && focus === 'qna') qnaRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [product, focus])

  useEffect(() => {
    if (!product) return undefined
    const before = document.title
    document.title = `${product.name.replace(/\[예시\]\s*/g, '')} · ${product.seller_name}`
    const meta = document.querySelector('meta[name="description"]')
    const beforeDescription = meta?.content
    if (meta) meta.content = product.summary ?? product.name
    return () => {
      document.title = before
      if (meta) meta.content = beforeDescription ?? ''
    }
  }, [product])

  if (error) return <p className="error">{error}</p>
  if (!product) return <p className="muted">불러오는 중…</p>
  const { item, seller } = product
  const fresh = item.category !== '가공품'
  // 옵션을 고르면 가격·100g당 가격·품절 여부가 그 옵션 기준으로 바뀐다 (옵션 이름이 판매 단위)
  const option = product.options?.find((o) => o.id === optionId) ?? null
  const price = option ? option.price : product.price
  const unit = option ? option.name : product.unit

  return (
    <article className="detail">
      <button type="button" className="link" onClick={onBack}>← 목록</button>
      {/* 사진은 왼쪽, 이름·가격·정보·구매 칸은 오른쪽에 한 덩어리로 (사진 옆이 비지 않게) */}
      <div className="detail-top">
      <Gallery product={product} />
      <div className="detail-info">
      <h2>{product.name}</h2>
      {product.has_options && !option
        ? <p className="price">{won(product.price)}부터 <span className="muted">/ {product.options.length > 0 ? `옵션 ${product.options.length}개 중 골라 주세요` : '판매 중인 옵션이 없어요'}</span></p>
        : <p className="price">{won(price)} <span className="muted">/ {unit}</span></p>}
      <p className="unit-price muted">
        {(option || !product.has_options) && unitPrice(price, unit) && <>{unitPrice(price, unit)} · </>}
        {product.price_updated_at && <>가격 기준 {product.price_updated_at.slice(0, 10)}</>}
      </p>
      <ShareButton name={product.name.replace(/\[예시\]\s*/g, '')} />
      <RatingBadge rating={product.rating} count={product.review_count} />
      {(product.sold_out || option?.stock === 0) && <p className="badge soldout">품절</p>}
      {product.preorder && !product.sold_out && (
        <p className="preorder-note"><span className="badge pending">예약 판매</span> {preorderNote(product.ship_from)}. 결제는 지금 하고, 상품은 그날부터 받아요. 보내기 전에는 [주문 조회]에서 취소할 수 있어요.</p>
      )}

      <dl>
        {product.weight_g && <><dt>1개 무게</dt><dd>{product.weight_g}g</dd></>}
        {product.count_per_box && <><dt>박스당</dt><dd>{product.count_per_box}개</dd></>}
        {/* 당도는 판매자가 잰 값: 측정일과 당도계 사진을 함께 보여 준다. 후기에서 '표시와 달랐어요'가 많으면 내린다 */}
        {item.show_brix && product.brix && !product.info_disputed && (
          <><dt>당도</dt><dd>{product.brix_grade && <strong className={`brix-grade rank-${product.brix_rank}`}>{product.brix_grade}</strong>} {Number(product.brix)}°Bx <span className="muted">(판매자 측정{product.brix_measured_at && ` · ${product.brix_measured_at.slice(0, 10)}`})</span>
            {product.brix_photo_url && <> <a href={product.brix_photo_url} target="_blank" rel="noreferrer">측정 사진</a></>}
            {product.brix_grade && <><br /><span className="muted">{product.variety && product.variety !== '공통' ? `${product.variety} 기준 ` : ''}높은 당도 {Number(product.brix_high)} 이상 · 매우높은 당도 {Number(product.brix_top)} 이상 · 출처: {product.brix_standard_source}</span></>}</dd></>
        )}
        {item.show_brix && product.brix && product.info_disputed && (
          <><dt>당도</dt><dd className="muted">구매 후기에서 표시와 다르다는 의견이 많아 당도 표시를 잠시 내렸어요</dd></>
        )}
        {product.harvest_date && <><dt>수확일</dt><dd>{product.harvest_date.slice(0, 10)}{product.harvest_days != null && <span className="muted"> (수확 {product.harvest_days}일째)</span>}</dd></>}
        {product.preorder && <><dt>출고 시작일</dt><dd>{product.ship_from.slice(0, 10)} <span className="muted">(예약 판매)</span></dd></>}
        {item.keep_period && <><dt>보관 참고</dt><dd>{item.keep_period}</dd></>}
        {product.info_answers >= 3 && <><dt>구매자 확인</dt><dd>표시와 맞았어요 {product.info_matched}/{product.info_answers}</dd></>}
        <dt>판매 농가</dt><dd>{seller.name} · {seller.region}</dd>
      </dl>
      <BuyBox product={product} option={option} onPick={setOptionId} onAsk={() => qnaRef.current?.scrollIntoView({ behavior: 'smooth' })} />
      </div>
      </div>

      <Description text={product.description} />
      {product.notice_table && (
        <section className="box notice-box">
          <h3>상품정보 제공 고시 <span className="muted">{product.notice_table.title}</span></h3>
          <table className="notice-table"><tbody>
            {product.notice_table.rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th><td className={r.missing ? 'muted' : ''}>{r.value}</td></tr>)}
          </tbody></table>
        </section>
      )}
      {product.faq?.length > 0 && (
        <section className="box faq-box">
          <h3>자주 묻는 질문</h3>
          {product.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </section>
      )}
      <section className="box">
        <h3>보관·섭취 안내</h3>
        {item.pending && <p className="muted">새로 들어온 품목이라 담당자가 보관·섭취 정보를 확인하고 있어요. 궁금한 점은 아래 상품 Q&A로 물어봐 주세요.</p>}
        {item.storage_method && <p>{item.storage_method}</p>}
        {item.keep_period && <p>보관 기간 참고: {item.keep_period}</p>}
        {/* 신선도는 날짜가 아니라 지금 상태로 판단한다 (팀 식품 기준표). 옛 데이터(며칠)도 그대로 보여 준다 */}
        {fresh && item.stage1_state && (
          <ul className="fresh-stages">
            <li><strong>신선</strong> {item.stage1_state} → {item.stage1_uses.join(', ')}</li>
            <li><strong>품질 저하</strong> {item.stage2_state} → {item.stage2_uses.join(', ')}</li>
            <li><strong>섭취 부적합</strong> 아래 신호가 보이면 → 조리하지 말고 폐기</li>
          </ul>
        )}
        {fresh && !item.stage1_state && item.fresh_days_stage1 && (
          <p>받은 날부터 {item.fresh_days_stage1}일까지: {item.stage1_uses.join(', ')} → {item.fresh_days_stage2}일까지: {item.stage2_uses.join(', ')} → 그 뒤: {item.stage3_uses.join(', ')}</p>
        )}
        {item.opened_note && <p>{item.opened_note}</p>}
        {item.allergens.length > 0 && <p className="warn">알레르기: {item.allergens.join(', ')}</p>}
        {item.allergen_note && <p className="muted">{item.allergen_note}</p>}
        {item.danger_signs.length > 0 && <p className="muted">이런 상태면 드시지 마세요: {item.danger_signs.join(' / ')}</p>}
        {item.danger_note && <p className="muted">{item.danger_note}</p>}
        {item.cafe_note && <p className="muted">카페·업소 메뉴 비율: {item.cafe_note}</p>}
        {item.reviewed_by && item.source && <p className="note">출처: {item.source}</p>}
      </section>

      {item.recipes.length > 0 && (
        <section className="box">
          <h3>이렇게 즐겨 보세요</h3>
          <ul>
            {item.recipes.map((r) => (
              <li key={r.title}><strong>{r.title}</strong> — {r.ingredients} · {r.method}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="box">
        <h3>판매 농가 이야기</h3>
        <p>{seller.story}</p>
      </section>

      <div className="actions">
        <button type="button" className="link" onClick={() => qnaRef.current?.scrollIntoView({ behavior: 'smooth' })}>상품 문의하기</button>
        {product.b2b_available && (
          <button type="button" className="button ghost" onClick={() => setShowB2b(true)}>기업 구매 문의 (대량·납품)</button>
        )}
      </div>
      {showB2b && <B2bForm product={product} onClose={() => setShowB2b(false)} />}

      <ReviewList code={product.product_code} />
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
        <Suspense fallback={loading}><Seller /></Suspense>
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
        <Suspense fallback={loading}><Admin /></Suspense>
      </div>
    )
  }
  return <ShopLayout><Suspense fallback={loading}>{shopPage(window.location.pathname)}</Suspense></ShopLayout>
}

// 첫 화면(/, /p/상품코드)은 섹션마다 폭이 다르고, 나머지 화면은 가운데 좁은 칸에 그린다
function shopPage(path) {
  const page = innerPage(path)
  return page ? <div className="wrap page">{page}</div> : <Storefront />
}

function innerPage(path) {
  if (path === '/guide') return <Guide />
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
  return null
}

// 상품 목록 상태는 주소(?q=&cat=&sort=)에, 상품 상세는 /p/상품코드 에 둔다 → 새로고침·공유·뒤로 가기가 그대로 된다
// cat 은 손님 화면 카테고리 키(fresh·base·processed…, server/shopGroups.js)
// 상품 주소 공유: 휴대폰은 공유 창, 그 밖에는 주소 복사. 둘 다 안 되면 주소를 보여 준다
function ShareButton({ name }) {
  const [message, setMessage] = useState('')
  async function share() {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url })
      } else {
        await navigator.clipboard.writeText(url)
        setMessage('주소를 복사했어요')
      }
    } catch (error) {
      if (error.name !== 'AbortError') setMessage(`이 주소를 복사해 주세요: ${url}`)
    }
  }
  return (
    <p className="share">
      <button type="button" className="link" onClick={share}>상품 주소 공유</button>
      {message && <span className="muted" role="status"> {message}</span>}
    </p>
  )
}

const SORT_OPTIONS = [['recommended', '추천순'], ['popular', '인기순'], ['brix', '당도 등급 높은 순'], ['new', '신상품순'], ['rating', '별점순'], ['price_asc', '낮은 가격순'], ['price_desc', '높은 가격순']]

function readLocation() {
  const params = new URLSearchParams(window.location.search)
  const path = window.location.pathname
  return {
    code: path.startsWith('/p/') ? decodeURIComponent(path.slice(3)) : null,
    q: params.get('q') ?? '',
    cat: /^[a-z]{2,20}$/.test(params.get('cat') ?? '') ? params.get('cat') : 'all',
    sort: SORT_OPTIONS.some(([key]) => key === params.get('sort')) ? params.get('sort') : 'recommended',
    brix: params.get('brix') === 'high' ? 'high' : '',
  }
}

function listUrl({ q, cat, sort, brix }) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (cat !== 'all') params.set('cat', cat)
  if (sort !== 'recommended') params.set('sort', sort)
  if (brix) params.set('brix', brix)
  return `/${params.size ? `?${params}` : ''}`
}

function fetchCatalog({ q, cat, sort, brix }, page) {
  const params = new URLSearchParams({ q, sort, page, size: 12 })
  if (cat !== 'all') params.set('group', cat)
  if (brix) params.set('brix', brix)
  return api(`/catalog?${params}`)
}

const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

function Storefront() {
  const [loc, setLoc] = useState(readLocation)
  const [focus, setFocus] = useState({ value: null, n: 0 })
  const [typed, setTyped] = useState(loc.q)
  const [list, setList] = useState(null)
  const [groups, setGroups] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [quizOpen, setQuizOpen] = useState(() => window.location.hash === '#recommend')
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const pushed = useRef(0) // 이 화면에서 상품을 연 횟수 (뒤로 가기로 목록에 돌아갈 수 있는지)
  const first = useRef(loc) // 처음 들어온 주소 (아래로 내려 줄 위치를 정할 때 한 번만 쓴다)

  useEffect(() => {
    const onPop = () => setLoc(readLocation())
    const onQuiz = () => setQuizOpen(true)
    window.addEventListener('popstate', onPop)
    window.addEventListener('open-quiz', onQuiz)
    api('/shop-groups').then(setGroups).catch(() => setGroups([]))
    getPolicy().then(setPolicy).catch(() => {})
    // 다른 화면에서 /#season 처럼 들어오거나, 검색·카테고리가 걸린 주소로 들어오면 그 부분으로 내린다
    const start = first.current
    const id = window.location.hash.slice(1) || (start.q || start.cat !== 'all' ? 'products' : '')
    const timer = id && id !== 'recommend' && !start.code ? setTimeout(() => scrollToId(id), 300) : null
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('open-quiz', onQuiz)
      clearTimeout(timer)
    }
  }, [])

  const changeList = useCallback((change) => {
    setLoc((prev) => {
      const next = { ...prev, ...change, code: null }
      window.history.replaceState(null, '', listUrl(next))
      return next
    })
  }, [])

  // 검색어는 입력을 멈추고 0.3초 뒤에 찾는다 (글자마다 서버를 부르지 않게)
  useEffect(() => {
    if (typed === loc.q) return undefined
    const timer = setTimeout(() => changeList({ q: typed.trim() }), 300)
    return () => clearTimeout(timer)
  }, [typed, loc.q, changeList])

  // 검색어를 빨리 바꾸면 앞선 응답이 늦게 와도 덮어쓰지 않게, 바뀐 뒤 도착한 옛 응답은 버린다
  useEffect(() => {
    if (loc.code) return undefined
    let stale = false
    fetchCatalog(loc, 1)
      .then((data) => { if (!stale) { setList(data); setError('') } })
      .catch((e) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [loc])

  const open = (code, focusOn = null) => {
    window.history.pushState(null, '', `/p/${encodeURIComponent(code)}`)
    pushed.current += 1
    setLoc((prev) => ({ ...prev, code }))
    setFocus((prev) => ({ value: focusOn, n: prev.n + 1 }))
    window.scrollTo({ top: 0 })
  }

  const back = () => {
    if (pushed.current > 0) {
      pushed.current -= 1
      window.history.back()
    } else {
      window.history.pushState(null, '', listUrl(loc))
      setLoc((prev) => ({ ...prev, code: null }))
    }
  }

  async function more() {
    setLoadingMore(true)
    try {
      const data = await fetchCatalog(loc, list.page + 1)
      setList((prev) => ({ ...data, items: [...prev.items, ...data.items] }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const pickGroup = (cat) => { changeList({ cat }); scrollToId('products') }
  const pickSeason = (name) => { setTyped(name); changeList({ q: name, cat: 'all' }); scrollToId('products') }
  const openQuiz = () => setQuizOpen(true)
  const closeQuiz = () => {
    setQuizOpen(false)
    if (window.location.hash === '#recommend') window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return (
    <>
      {error && <p className="error wrap">{error}</p>}

      {loc.code ? (
        <div className="wrap section detail-wrap">
          <ProductDetail key={`${loc.code}-${focus.n}`} code={loc.code} focus={focus.value} onBack={back} onOpen={open} />
        </div>
      ) : (
        <>
          <Hero onRecommend={openQuiz} />
          <CategoryRows groups={groups} onPick={pickGroup} />
          <ProductSection groups={groups} loc={loc} typed={typed} setTyped={setTyped} list={list} sorts={SORT_OPTIONS}
            onChange={changeList} onOpen={open} onMore={more} loadingMore={loadingMore} />
          <SeasonCalendar onPick={pickSeason} />
          <Story />
          <Faq policy={policy} onRecommend={openQuiz} />
        </>
      )}
      <QuizDialog open={quizOpen} onClose={closeQuiz} onOpen={open} />
      <Chat productCode={loc.code} onOpenProduct={open} />
    </>
  )
}

export default App
