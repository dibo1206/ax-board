import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import './console.css'
import { Chat } from './Chat.jsx'
import { B2bForm, QuestionForm } from './Inquiry.jsx'
import { Related } from './Recommend.jsx'
import { RatingBadge, ReviewList } from './shop/Reviews.jsx'
import { addToCart, get, getPolicy, post, preorderNote, thumbUrl, unitPrice } from './shop/shared.js'
import { FarmPage, FarmsPage } from './shop/Farms.jsx'
import { Guide } from './shop/Guide.jsx'
import { NotFound } from './shop/NotFound.jsx'
import { RecipeCards } from './shop/RecipeCards.jsx'
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
const AboutPage = page(() => import('./shop/About.jsx'), 'AboutPage')
const ProductsPage = page(() => import('./shop/ProductsPage.jsx'), 'ProductsPage')
const SitemapPage = page(() => import('./shop/About.jsx'), 'SitemapPage')
const PostListPage = page(() => import('./shop/Posts.jsx'), 'PostListPage')
const PostDetailPage = page(() => import('./shop/Posts.jsx'), 'PostDetailPage')
const NoticePopup = page(() => import('./shop/Posts.jsx'), 'NoticePopup')
const Policy = page(() => import('./shop/Orders.jsx'), 'Policy')
const LoginPage = page(() => import('./account/Account.jsx'), 'LoginPage')
const SignupPage = page(() => import('./account/Account.jsx'), 'SignupPage')
const FindPasswordPage = page(() => import('./account/Account.jsx'), 'FindPasswordPage')
const ResetPasswordPage = page(() => import('./account/Account.jsx'), 'ResetPasswordPage')
const RestockCancelPage = page(() => import('./shop/RestockCancel.jsx'), 'RestockCancelPage')
const MyPage = page(() => import('./account/Account.jsx'), 'MyPage')
const SocialSignupPage = page(() => import('./account/Account.jsx'), 'SocialSignupPage')
const loading = <p className="muted">불러오는 중…</p>

// 1단계 데이터 확인용 화면. 실제 디자인은 시안이 나오면 3단계에서 새로 만든다.
async function api(path) {
  const response = await netFetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  // status 를 붙여 둔다: 상품 상세는 404면 '내려간 상품' 안내 화면을 보여 준다
  if (!response.ok) throw Object.assign(new Error(data.error || `요청이 실패했어요 (${response.status})`), { status: response.status })
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
// 품절 상품·옵션: 이메일을 남기면 다시 들어올 때 메일로 한 번 알려 준다 (server/restock.js)
function RestockForm({ productCode, optionId }) {
  const [email, setEmail] = useState('')
  const [agree, setAgree] = useState(false)
  const [state, setState] = useState({ busy: false, done: '', error: '' })
  const submit = async (e) => {
    e.preventDefault()
    setState({ busy: true, done: '', error: '' })
    try {
      const data = await post(`/products/${encodeURIComponent(productCode)}/restock`, { email, optionId, agree })
      setState({ busy: false, done: data.message, error: '' })
    } catch (error) {
      setState({ busy: false, done: '', error: error.message })
    }
  }
  if (state.done) return <p className="success restock-done">{state.done}</p>
  return (
    <form className="restock" onSubmit={submit}>
      <p className="restock-title"><strong>재입고 알림</strong> <span className="muted">다시 들어오면 메일로 한 번 알려 드려요</span></p>
      <div className="restock-row">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="알림 받을 이메일" autoComplete="email" maxLength={254} aria-label="알림 받을 이메일" />
        <button type="submit" className="button" disabled={state.busy || !agree}>알림 받기</button>
      </div>
      <label className="restock-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> 재입고 알림을 위해 이메일을 수집·이용하는 데 동의해요 (보낸 뒤 30일 안에 지워요)</label>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  )
}

function BuyBox({ product, option, onPick, onAsk }) {
  const [quantity, setQuantity] = useState(1)
  const soldOut = (
    <>
      <div className="actions">
        <span className="button ghost">품절</span>
        <button type="button" className="button ghost" onClick={onAsk}>입고 문의하기</button>
      </div>
      <RestockForm key={option?.id ?? 'all'} productCode={product.product_code} optionId={option?.id ?? null} />
    </>
  )
  if (product.sold_out) return <div className="buy">{soldOut}</div>
  const pick = product.has_options && (
    <label className="qty">옵션
      <select value={option?.id ?? ''} onChange={(e) => { onPick(Number(e.target.value) || null); setQuantity(1) }}>
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
      <div className="buy-row">
        <label className="qty">수량
          <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
            {Array.from({ length: Math.min(max, 20) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="buy-total"><small>총 금액</small><span className="price">{won(price * quantity)}</span></span>
      </div>
      <div className="actions">
        {/* 담으면 화면 아래 "장바구니에 담겼어요" 알림이 뜬다 (ShopLayout 의 CartToast) */}
        <button type="button" className="button ghost" onClick={() => addToCart(product.product_code, quantity, option?.id ?? null, `${product.name}${option ? ` ${option.name}` : ''}`)}>장바구니 담기</button>
        <a className="button" href={buyUrl}>{product.preorder ? '예약 구매' : '바로 구매'}</a>
      </div>
    </div>
  )
}

// focus: AI 상담에서 넘어오면 'b2b'(기업 문의 폼 열기) 또는 'qna'(Q&A로 내리기)
// 공개 Q&A 목록(모두에게 같은 캐시)에 내 문의(비밀글 내용 포함)를 덮어 쓴다
function mergeQuestions(list, mine) {
  const byId = new Map(mine.map((q) => [q.id, q]))
  const shown = new Set(list.map((q) => q.id))
  return [...mine.filter((q) => !shown.has(q.id)), ...list.map((q) => byId.get(q.id) ?? q)]
}

function ProductDetail({ code, focus, onBack, onOpen }) {
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  const [showB2b, setShowB2b] = useState(focus === 'b2b')
  const [sentMessage, setSentMessage] = useState('')
  const [optionId, setOptionId] = useState(null) // 옵션 상품에서 고른 옵션
  const tabsRef = useRef(null)
  const [tab, setTab] = useState(focus === 'qna' ? 'qna' : 'info') // 사진 밑 탭 띠에서 보고 있는 탭
  const [reviewCount, setReviewCount] = useState(null)
  const [qnaShown, setQnaShown] = useState(5)
  const [askOpen, setAskOpen] = useState(focus === 'qna')
  const openAsk = () => {
    setTab('qna')
    setAskOpen(true)
    tabsRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  const [myQuestions, setMyQuestions] = useState([]) // 내가 남긴 문의 (비밀글 내용 포함, 로그인했을 때만)

  useEffect(() => {
    // 없는(내려간) 상품이면 한 줄 오류 대신 안내 화면 (NotFound)
    api(`/products/${code}`).then(setProduct).catch((e) => setError(e.status === 404 ? 'not-found' : e.message))
    get(`/products/${code}/my-questions`).then(setMyQuestions).catch(() => {})
  }, [code])

  useEffect(() => {
    if (product && focus === 'qna') tabsRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  if (error === 'not-found') return <NotFound kind="product" onOpen={onOpen} />
  if (error) return <p className="error">{error}</p>
  if (!product) return <p className="muted">불러오는 중…</p>
  const { item, seller } = product
  const fresh = item.category !== '가공품'
  // 옵션을 고르면 가격·100g당 가격·품절 여부가 그 옵션 기준으로 바뀐다 (옵션 이름이 판매 단위)
  const option = product.options?.find((o) => o.id === optionId) ?? null
  const price = option ? option.price : product.price
  const unit = option ? option.name : product.unit

  const questions = mergeQuestions(product.questions, myQuestions)
  const tabs = [
    { key: 'info', name: '상품 설명' },
    { key: 'reviews', name: '후기', count: reviewCount ?? product.review_count },
    { key: 'qna', name: '상품 문의', count: questions.length },
    { key: 'faq', name: 'Q&A', count: product.faq?.length ?? 0 },
  ]
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
        {/* 농가 이름을 누르면 그 농가 페이지 (농가별로 보기, 2026-11-09) */}
        <dt>판매 농가</dt><dd><a href={`/farm/${encodeURIComponent(seller.seller_code)}`} className="farm-name-link">{seller.name}</a> · {seller.region}</dd>
      </dl>
      <BuyBox product={product} option={option} onPick={setOptionId} onAsk={openAsk} />
      <div className="buy-aside">
        <button type="button" onClick={openAsk}>상품 문의하기</button>
        {product.b2b_available && (
          <button type="button" onClick={() => { setShowB2b(true); setTimeout(() => document.getElementById('b2b-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }}>기업 구매 문의 <small>대량·납품</small></button>
        )}
      </div>
      </div>
      </div>

      <div className="detail-body">
        {showB2b && <div id="b2b-form"><B2bForm product={product} onClose={() => setShowB2b(false)} /></div>}

        {/* 사진 밑 탭 띠 (2026-11-14): 누른 탭의 내용만 보여 준다. 후기 수는 후기 목록이 불러오기 전까지 상품에 저장된 값 */}
        <div className="detail-tabs" role="tablist" aria-label="상품 정보 보기" ref={tabsRef}>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`} aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.name}{t.count != null && <span className="tab-count"> {t.count}</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="panel-info" aria-labelledby="tab-info" hidden={tab !== 'info'} className="detail-panel">
        <Description text={product.description} />
        {/* 회사 상세페이지 이미지 (세로로 긴 이미지를 위에서 아래로 이어서) */}
        {product.detail_images?.length > 0 && (
          <section className="box detail-images">
            <h3>상세 정보</h3>
            {product.detail_images.map((src) => <img key={src} src={src} alt="" loading="lazy" />)}
          </section>
        )}
        {/* 상품 설명 탭 순서 (2026-11-08 피드백): 즐기는 법 → 보관·섭취 → 농가 이야기 → 고시. 자주 묻는 질문·후기·문의는 각자 탭으로 */}
        <RecipeCards recipes={item.recipes} />
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

        <section className="box">
          <h3>판매 농가 이야기</h3>
          <p>{seller.story}</p>
          <a className="farm-more-link" href={`/farm/${encodeURIComponent(seller.seller_code)}`}>{seller.name.replace(/\[예시\]\s*/g, '')}의 다른 상품 모두 보기 →</a>
        </section>
        {product.notice_table && (
          <section className="box notice-box">
            <h3>상품정보 제공 고시 <span className="muted">{product.notice_table.title}</span></h3>
            <table className="notice-table"><tbody>
              {product.notice_table.rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th><td className={r.missing ? 'muted' : ''}>{r.value}</td></tr>)}
            </tbody></table>
          </section>
        )}
        </div>

        {/* 후기·문의는 5개씩 보여 주고 [더 보기]로 늘린다. 후기 패널은 숨겨 둬도 그려 둬야 탭의 후기 수가 맞는다 */}
        <section role="tabpanel" id="panel-reviews" aria-labelledby="tab-reviews" hidden={tab !== 'reviews'} className="box detail-panel">
          <ReviewList code={product.product_code} embedded onCount={setReviewCount} />
        </section>
        <section role="tabpanel" id="panel-qna" aria-labelledby="tab-qna" hidden={tab !== 'qna'} className="box detail-panel">
            {askOpen ? (
              <QuestionForm
                productCode={product.product_code}
                onSent={(q) => {
                  setProduct((prev) => ({ ...prev, questions: [q, ...prev.questions] }))
                  setSentMessage(q.is_private ? '비밀글이 올라갔어요. 답변이 달리면 마이페이지에서 알려 드려요.' : '질문이 올라갔어요. 답변이 달리면 여기에 보여요.')
                  setAskOpen(false)
                }}
              />
            ) : (
              <button type="button" className="button ghost talk-ask" onClick={() => setAskOpen(true)}>상품 문의 남기기</button>
            )}
            {sentMessage && <p className="success">{sentMessage}</p>}
            {questions.length === 0 ? <p className="muted">아직 문의가 없어요. 궁금한 점을 남겨 주세요.</p> : (
              <ul className="qna-list">
                {questions.slice(0, qnaShown).map((q) => (
                  <li key={q.id}>
                    {q.is_private && !q.mine ? (
                      <><span className="qna-lock">비밀글</span> 작성자만 볼 수 있는 문의예요. <span className="muted">· {q.author} · {q.answered ? '답변 완료' : '답변을 기다리는 중'}</span></>
                    ) : (
                      <>
                        <strong>Q.</strong> {q.is_private && <span className="qna-lock">비밀글</span>}{q.question} <span className="muted">· {q.author}{q.mine && ' (내 문의)'}</span><br />
                        {q.answer ? <><strong>A.</strong> {q.answer}</> : <span className="muted">답변을 기다리는 중</span>}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {questions.length > qnaShown && (
              <button type="button" className="button ghost talk-more" onClick={() => setQnaShown((n) => n + 5)}>문의 더 보기 ({qnaShown}/{questions.length})</button>
            )}
        </section>
        <section role="tabpanel" id="panel-faq" aria-labelledby="tab-faq" hidden={tab !== 'faq'} className="box detail-panel faq-box">
          <h3>자주 묻는 질문</h3>
          {product.faq?.length > 0
            ? product.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)
            : <p className="muted">아직 등록된 자주 묻는 질문이 없어요. 궁금한 점은 [상품 문의] 탭에 남겨 주세요.</p>}
        </section>
      </div>
      <Related code={product.product_code} onOpen={onOpen} />
    </article>
  )
}

function App() {
  if (window.location.pathname.startsWith('/seller')) {
    return (
      <div className="console">
        <header className="console-bar">
          <a className="brand-mark" href="/seller">YOONJU MARKET<small>판매자 센터</small></a>
          <span className="bar-note">개발 중 · 내 농가 상품만 보여요 · <a href="/">쇼핑몰 보기</a></span>
        </header>
        <main className="console-main"><Suspense fallback={loading}><Seller /></Suspense></main>
      </div>
    )
  }
  if (window.location.pathname.startsWith('/admin')) {
    return (
      <div className="console">
        <header className="console-bar">
          <a className="brand-mark" href="/admin">YOONJU MARKET<small>관리자</small></a>
          <span className="bar-note">개발 중 · <a href="/">홈페이지 보기</a> (위에 관리자 막대가 떠요)</span>
        </header>
        <main className="console-main"><Suspense fallback={loading}><Admin /></Suspense></main>
      </div>
    )
  }
  return <ShopLayout><Suspense fallback={loading}>{shopPage(window.location.pathname)}</Suspense></ShopLayout>
}

const safeDecode = (text) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

// 첫 화면(/, /p/상품코드)은 섹션마다 폭이 다르고, 나머지 화면은 가운데 좁은 칸에 그린다.
// 그 밖의 모르는 주소는 첫 화면 대신 '찾으시는 페이지가 없어요' (2026-11-09)
function shopPage(path) {
  const page = innerPage(path)
  if (page) return <div className="wrap page">{page}</div>
  if (path === '/' || path === '/index.html' || path.startsWith('/p/')) return <Storefront />
  return <div className="wrap page"><NotFound /></div>
}

function innerPage(path) {
  if (path === '/guide') return <Guide />
  if (path === '/cart') return <Cart />
  if (path === '/checkout') return <Checkout />
  if (path === '/order/success') return <OrderSuccess />
  if (path === '/order/fail') return <OrderFail />
  if (path === '/order/lookup') return <OrderLookup />
  if (path.startsWith('/policy/')) return <Policy kind={path.split('/')[2]} />
  if (path === '/products') return <ProductsPage />
  if (path === '/farms') return <FarmsPage />
  const farm = path.match(/^\/farm\/([^/]{1,80})$/)
  if (farm) return <FarmPage code={safeDecode(farm[1])} />
  if (path === '/about') return <AboutPage />
  if (path === '/sitemap') return <SitemapPage />
  if (path === '/notice' || path === '/faq' || path === '/press') return <PostListPage kind={path.slice(1)} />
  const post = path.match(/^\/(notice|faq|press)\/(\d{1,9})$/)
  if (post) return <PostDetailPage kind={post[1]} id={post[2]} />
  if (path === '/account/login') return <LoginPage />
  if (path === '/account/signup') return <SignupPage />
  if (path === '/account/find') return <FindPasswordPage />
  if (path === '/account/reset') return <ResetPasswordPage />
  if (path === '/restock/cancel') return <RestockCancelPage />
  if (path === '/account') return <MyPage />
  if (path === '/account/social') return <SocialSignupPage />
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
  }
}

function listUrl({ q, cat, sort }) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (cat !== 'all') params.set('cat', cat)
  if (sort !== 'recommended') params.set('sort', sort)
  return `/${params.size ? `?${params}` : ''}`
}

function fetchCatalog({ q, cat, sort }, page) {
  const params = new URLSearchParams({ q, sort, page, size: 12 })
  if (cat !== 'all') params.set('group', cat)
  return api(`/catalog?${params}`)
}

const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

function Storefront() {
  const [loc, setLoc] = useState(readLocation)
  const [focus, setFocus] = useState({ value: null, n: 0 })
  const [list, setList] = useState(null)
  const [groups, setGroups] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [quizOpen, setQuizOpen] = useState(() => window.location.hash === '#recommend')
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const pushed = useRef(0) // 이 화면에서 상품을 연 횟수 (뒤로 가기로 목록에 돌아갈 수 있는지)
  const listScroll = useRef(0) // 상품을 열기 전 목록 스크롤 위치 (돌아올 때 그 자리로)
  const first = useRef(loc) // 처음 들어온 주소 (아래로 내려 줄 위치를 정할 때 한 번만 쓴다)

  useEffect(() => {
    const onPop = () => {
      const next = readLocation()
      setLoc(next)
      if (!next.code && window.location.hash === '#products') setTimeout(() => scrollToId('products'), 150)
    }
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

  // 검색어를 빨리 바꾸면 앞선 응답이 늦게 와도 덮어쓰지 않게, 바뀐 뒤 도착한 옛 응답은 버린다
  useEffect(() => {
    if (loc.code) return undefined
    let stale = false
    fetchCatalog(loc, 1)
      .then((data) => { if (!stale) { setList(data); setError('') } })
      .catch((e) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [loc])

  // 상세에서 목록으로 돌아오면(뒤로 가기 포함) 보던 자리로 되돌린다
  const hadCode = useRef(Boolean(loc.code))
  useEffect(() => {
    const was = hadCode.current
    hadCode.current = Boolean(loc.code)
    if (!was || loc.code) return undefined
    const timer = setTimeout(() => window.scrollTo({ top: listScroll.current }), 60)
    return () => clearTimeout(timer)
  }, [loc.code])

  const open = (code, focusOn = null) => {
    if (!loc.code) listScroll.current = window.scrollY
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
  const pickSeason = (name) => { changeList({ q: name, cat: 'all' }); scrollToId('products') }
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
          <ProductSection groups={groups} loc={loc} list={list} sorts={SORT_OPTIONS}
            onChange={changeList} onOpen={open} onMore={more} loadingMore={loadingMore} />
          <SeasonCalendar onPick={pickSeason} />
          <Story />
          <Faq policy={policy} onRecommend={openQuiz} />
        </>
      )}
      <QuizDialog open={quizOpen} onClose={closeQuiz} onOpen={open} />
      {!loc.code && <Suspense fallback={null}><NoticePopup /></Suspense>}
      <Chat productCode={loc.code} onOpenProduct={open} />
    </>
  )
}

export default App
