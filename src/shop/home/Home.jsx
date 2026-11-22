import { useEffect, useRef, useState } from 'react'
import { Quiz } from '../../Recommend.jsx'
import { RatingBadge } from '../Reviews.jsx'
import { WishButton } from '../Saved.jsx'
import { addToCart, cheapestOption, get, shipDay, thumbUrl, unitPrice, won } from '../shared.js'
import { FAQ, GROUP_PHOTOS, HERO, SEASON, STORY } from './content.js'

// 첫 화면 (디자인 시안): 큰 제목 → 카테고리 → 상품 → 제철 달력 → 이야기 → 자주 묻는 질문

// 사진. src 가 없으면 빗금 자리표시에 어떤 사진이 필요한지 적는다
export function Photo({ photo, className = '', eager = false }) {
  if (!photo?.src) {
    return (
      <div className={`photo-need ${className}`} role="img" aria-label="사진 준비 중">
        <span>사진 필요</span>
        <small>{photo?.need}</small>
      </div>
    )
  }
  return <img className={className} src={photo.src} alt={photo.alt ?? ''} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} />
}

// 배너 사진이 5초마다 부드럽게 넘어간다. 마우스를 올리거나 키보드로 조작 중이면 멈추고, [정지] 버튼으로 끌 수 있다.
// 움직임을 줄이는 설정(prefers-reduced-motion)이면 처음부터 멈춰 있다. 글(제목·버튼)은 사진이 바뀌어도 그대로다
export function Hero({ onRecommend }) {
  const slides = HERO.slides ?? []
  const many = slides.length > 1
  const [index, setIndex] = useState(0)
  const [stopped, setStopped] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [hold, setHold] = useState(false) // 마우스를 올렸거나 포커스가 있는 동안
  const go = (i) => setIndex((i + slides.length) % slides.length)

  useEffect(() => {
    if (!many || stopped || hold) return undefined
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), HERO.interval ?? 5000)
    return () => clearInterval(timer)
  }, [many, stopped, hold, slides.length])

  return (
    <section className="home-hero" aria-roledescription={many ? 'carousel' : undefined} aria-label="이달의 추천"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      {slides.length ? slides.map((s, i) => (
        <div key={s.src} className={`hero-slide${i === index ? ' on' : ''}${s.cover ? ' is-cover' : ''}`} aria-hidden={i === index ? undefined : true}>
          {/* 사진 높이를 배너에 딱 맞추면 가로가 남는다: 남는 왼쪽은 같은 사진을 흐리게 깔아 이어 붙인다 */}
          <img className="hero-backdrop" src={s.src} alt="" aria-hidden="true" />
          <img className="hero-photo" src={s.src} alt={i === index ? s.alt : ''} loading={i === 0 ? 'eager' : 'lazy'} fetchPriority={i === 0 ? 'high' : undefined} style={{ objectPosition: s.position }} />
        </div>
      )) : <Photo photo={HERO.photo} className="hero-photo" eager />}
      <div className={`hero-scrim${slides[index]?.scrim ? ' on' : ''}`} aria-hidden="true" />
      <div className="hero-text">
        <p className="eyebrow">{HERO.eyebrow}</p>
        <h1 className="display">{HERO.title.map((line) => <span key={line}>{line}</span>)}</h1>
        <p className="lead">{HERO.lead}</p>
        <button type="button" className="btn-dark" onClick={onRecommend}>{HERO.cta} <span aria-hidden="true">→</span></button>
      </div>
      {many && (
        <div className="hero-ctrl-wrap">
          <div className="hero-ctrl" role="group" aria-label="배너 조작">
            <span className="hero-count" aria-live={stopped ? 'polite' : 'off'}>{index + 1} / {slides.length}</span>
            <button type="button" aria-label="이전 배너" onClick={() => go(index - 1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
            </button>
            <button type="button" aria-label={stopped ? '자동 넘김 시작' : '자동 넘김 정지'} aria-pressed={stopped} onClick={() => setStopped((v) => !v)}>
              {stopped
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" className="fill" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>}
            </button>
            <button type="button" aria-label="다음 배너" onClick={() => go(index + 1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export function CategoryRows({ groups, onPick }) {
  if (!groups?.length) return null
  return (
    <section className="wrap section cat-section" aria-labelledby="cat-title">
      <h2 id="cat-title" className="sr-only">카테고리</h2>
      <ul className="cat-rows">
        {groups.map((g) => (
          <li key={g.key}>
            <button type="button" onClick={() => onPick(g.key)}>
              <Photo photo={GROUP_PHOTOS[g.key]} className="cat-photo" />
              <span className="cat-name">{g.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// 사진 오른쪽 아래 장바구니 버튼(마우스를 올리면 나타남): 상세로 들어가기 전에 1개를 바로 담는다 (링크 안에 버튼을 넣을 수 없어 카드 바깥 형제로 둔다)
// 옵션 상품은 옵션을 골라야 담을 수 있어서, 이 버튼이 상세로 보내 준다
function QuickCart({ p, onOpen }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return undefined
    const timer = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(timer)
  }, [done])
  if (p.sold_out) return null
  const name = p.name.replace(/\[예시\]\s*/g, '')
  const pickOption = p.has_options
  return (
    <button type="button" className={`quick-cart${done ? ' done' : ''}`}
      aria-label={pickOption ? `${name} 옵션 고르기` : done ? `${name} 장바구니에 담았어요` : `${name} 장바구니 담기`}
      onClick={() => { if (pickOption) onOpen(p.product_code); else { addToCart(p.product_code, 1, null, name); setDone(true) } }}>
      {/* 담긴 것은 화면 아래 알림(CartToast)이 글로 알려 준다. 여기서는 아이콘만 잠깐 체크로 */}
      {done
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.5l2.2 10.5h10.1L20 7H6.3" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></svg>}
    </button>
  )
}

// 농산물 표준규격 등급 이름 (server/brix.js: 특 이상 = 3, 상 이상 = 2)
const GRADE = { 3: '특', 2: '상' }

// 옵션 상품(5kg·10kg …)은 판매 중 옵션의 가장 낮은 가격을 "~부터"로, 100g당 가격도 그 옵션으로. 모든 옵션이 품절이면 품절
export function ProductCard({ p, onOpen, rank = null }) {
  const cheapest = cheapestOption(p)
  const unit = cheapest ? unitPrice(cheapest.price, cheapest.name) : unitPrice(p.price, p.unit)
  return (
    <div className="pcard-wrap">
      <a href={`/p/${encodeURIComponent(p.product_code)}`} className={`pcard${p.sold_out ? ' soldout' : ''}`} onClick={(e) => { e.preventDefault(); onOpen(p.product_code) }}>
        <span className="pcard-img">
          {p.image_url
            ? <img src={thumbUrl(p.image_url)} alt="" loading="lazy" width="400" height="400" />
            : <span className="photo-need"><span>사진 준비 중</span></span>}
          <span className="pcard-tags">
            {/* 동그라미에는 당도 숫자 대신 농산물 표준규격 등급(특·상)을 쓴다 (2026-11-07 피드백). 서버가 품목·품종별 공식 기준으로 정하고,
                판매자가 고를 수 없다. 보통 등급이거나 공식 기준이 없는 품목은 동그라미를 달지 않는다. 측정값은 마우스 올림·상세 화면에서 */}
            {p.show_brix && p.brix && !p.info_disputed && p.brix_rank >= 2 && (
              <span className={`ptag ptag-brix ${p.brix_rank === 3 ? 'brix-high' : 'brix-mid'}`}
                title={`${GRADE[p.brix_rank]} 등급 · 당도 ${Number(p.brix)}°Bx (농산물 표준규격)`}
                aria-label={`${GRADE[p.brix_rank]} 등급, 당도 ${Number(p.brix)}°Bx`}>
                <small aria-hidden="true">등급</small><b aria-hidden="true">{GRADE[p.brix_rank]}</b>
              </span>
            )}
            {p.harvest_days != null && p.harvest_days <= 30 && (
              <span className="ptag ptag-harvest" aria-label={`수확 ${p.harvest_days}일째`}><small aria-hidden="true">수확</small><b aria-hidden="true">{p.harvest_days}일째</b></span>
            )}
            {p.tags?.includes('season') && <span className="ptag ptag-season">제철</span>}
          </span>
          {rank && <span className="pcard-rank" aria-label={`판매 ${rank}위`}>{rank}</span>}
          {p.sold_out && <span className="pcard-flag">품절</span>}
          {p.preorder && !p.sold_out && <span className="pcard-flag preorder">예약 · {shipDay(p.ship_from)}부터</span>}
        </span>
        <span className="pcard-seller">{p.seller_name.replace(/\[예시\]\s*/g, '')}</span>
        <strong className="pcard-name">{p.name}</strong>
        {p.has_options
          ? <span className="pcard-price">{won(p.price)}부터 {p.options.length > 0 && <small>/ 옵션 {p.options.length}개</small>}</span>
          : <span className="pcard-price">{won(p.price)} <small>/ {p.unit}</small></span>}
        {unit && <span className="pcard-unit">{unit}{cheapest && p.options.length > 1 && ` (${cheapest.name})`}</span>}
        <span className="pcard-meta">
          <RatingBadge rating={p.rating} count={p.review_count} />
        </span>
      </a>
      <QuickCart p={p} onOpen={onOpen} />
      <WishButton code={p.product_code} name={p.name.replace(/\[예시\]\s*/g, '')} />
    </div>
  )
}

// 상품: 카테고리 탭(노란 밑줄) + 정렬 + 카드 + 더 보기. 검색은 위쪽 헤더 검색 하나로만 한다 (2026-11-07 피드백: 상품 옆 검색칸 삭제)
export function ProductSection({ groups, loc, list, sorts, onChange, onOpen, onMore, loadingMore }) {
  const tabs = [{ key: 'all', name: '전체' }, ...(groups ?? [])]
  return (
    <section id="products" className="wrap section" aria-labelledby="products-title">
      <div className="products-head">
        <h2 id="products-title" className="display-sm">상품</h2>
        <a className="products-all" href="/products">전체 상품·베스트 보기 →</a>
      </div>
      <div className="products-bar">
        <nav className="text-tabs" aria-label="카테고리">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={t.key === loc.cat ? 'on' : ''} aria-pressed={t.key === loc.cat} onClick={() => onChange({ cat: t.key })}>{t.name}</button>
          ))}
        </nav>
        <select className="sort" value={loc.sort} onChange={(e) => onChange({ sort: e.target.value })} aria-label="정렬">
          {sorts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {!list ? <p className="muted">불러오는 중…</p> : list.total === 0 ? (
        <div className="empty">
          <p>{loc.q ? `'${loc.q}'에 맞는 상품이 없습니다.` : '조건에 맞는 상품이 없습니다.'}{loc.q && <> <button type="button" className="link-btn" onClick={() => onChange({ q: '' })}>검색어 지우기</button></>}</p>
          <p className="muted">다른 말로 찾아보거나, 오른쪽 아래 상담하기에 원하는 걸 말해 보세요. (예: 부모님 선물로 달달한 거)</p>
        </div>
      ) : (
        <>
          {loc.q && (
            <p className="muted result-count">
              {list.loose ? `'${loc.q}'와 딱 맞는 상품이 없어 비슷한 상품 ${list.total}개를 보여 드려요` : `'${loc.q}' 검색 결과 ${list.total}개`}
              {' '}<button type="button" className="link-btn" onClick={() => onChange({ q: '' })}>검색어 지우기 ×</button>
            </p>
          )}
          <ul className="pgrid">
            {list.items.map((p) => <li key={p.product_code}><ProductCard p={p} onOpen={onOpen} /></li>)}
          </ul>
          {list.page < list.pages && (
            <button type="button" className="btn-line more" onClick={onMore} disabled={loadingMore}>
              {loadingMore ? '불러오는 중…' : `더 보기 (${list.items.length}/${list.total})`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

// 제철 달력 (사진 카드형): 달 띠에서 달을 고르면 그 달 제철 품목을 실제 상품 사진 카드로 보여 준다.
// 카드: 대표 사진 · 막 나왔어요/지금 한창/끝물 · 가장 싼 값 · 상품 수 · 열두 달 제철 막대. 누르면 그 품목 상품을 찾는다.
// 카드 순서는 content.js 목록 순서(인기 많은 품목부터). 달 띠는 옆으로 넘기고, 화살표·좌우 키로도 바꾼다
const SEASON_NAME = (m) => (m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn')
const SEASON_LABEL = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' }
const nextMonth = (m) => (m === 12 ? 1 : m + 1)
const prevMonth = (m) => (m === 1 ? 12 : m - 1)

// 제철 기간 안에서 고른 달이 어디쯤인지: 막 나왔어요 / 지금 한창 / 끝물 (한 달뿐이면 이달만)
function seasonStage(list, month) {
  if (!list.includes(month)) return null
  if (list.length >= 12) return { key: 'peak', text: '사계절' }
  let start = month
  while (list.includes(prevMonth(start)) && start !== nextMonth(month)) start = prevMonth(start)
  let end = month
  while (list.includes(nextMonth(end)) && end !== prevMonth(month)) end = nextMonth(end)
  if (start === end) return { key: 'only', text: '이달만 나와요' }
  if (month === start) return { key: 'new', text: '막 나왔어요' }
  if (month === end) return { key: 'last', text: '끝물이에요' }
  return { key: 'peak', text: '지금 한창' }
}

export function SeasonCalendar({ onPick }) {
  const [now] = useState(() => new Date().getMonth() + 1) // 이번 달 (처음 그릴 때 한 번 정한다)
  const [month, setMonth] = useState(now)
  const [info, setInfo] = useState({}) // 찾을 말 → { products, live, price, image }
  const strip = useRef(null)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const term = (item) => item.search ?? item.name

  useEffect(() => {
    get(`/season-items?${new URLSearchParams({ q: SEASON.items.map(term).join(',') })}`).then(setInfo).catch(() => {})
  }, [])

  // 고른 달 버튼이 띠 가운데 오도록 (휴대폰에서 옆으로 넘긴 상태여도)
  const rail = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const checkEdge = () => {
    const box = rail.current
    if (!box) return
    setEdge({ left: box.scrollLeft > 4, right: box.scrollLeft + box.clientWidth < box.scrollWidth - 4 })
  }
  const slide = (dir) => {
    const box = rail.current
    if (box) box.scrollBy({ left: dir * box.clientWidth * 0.9, behavior: 'smooth' })
  }
  // 달을 바꾸거나 상품 정보가 들어오면 카드 줄을 처음으로 돌리고 화살표를 다시 정한다
  useEffect(() => {
    if (rail.current) rail.current.scrollLeft = 0
    const timer = setTimeout(checkEdge, 50)
    window.addEventListener('resize', checkEdge)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', checkEdge)
    }
  }, [month, info])

  const firstScroll = useRef(true)
  useEffect(() => {
    const box = strip.current
    const btn = box?.querySelector(`[data-month="${month}"]`)
    // 처음에는 바로(페이지 스크롤과 겹쳐도 끊기지 않게), 그다음부터는 부드럽게
    if (box && btn) box.scrollTo({ left: btn.offsetLeft - box.clientWidth / 2 + btn.offsetWidth / 2, behavior: firstScroll.current ? 'auto' : 'smooth' })
    firstScroll.current = false
  }, [month])

  // 판매 중인 상품이 있는 품목만, 인기 많은 품목부터 (content.js 목록 순서 그대로)
  const picked = SEASON.items
    .map((item) => ({ item, stage: seasonStage(item.months, month), data: info[term(item)] }))
    .filter((x) => x.stage && (!x.data || x.data.products > 0))
  const season = SEASON_NAME(month)

  return (
    <section id="season" className={`section season-section season-${season}`} aria-labelledby="season-title">
      <div className="wrap season2">
        <div className="season2-head">
          <div>
            <h2 id="season-title" className="display-sm">제철 달력</h2>
            <p className="lead">달을 고르면 그때 가장 맛있는 것을 보여 드려요. 지금은 {now}월이에요.</p>
          </div>
          <div className="season2-arrows">
            <button type="button" aria-label="이전 달" onClick={() => setMonth(prevMonth)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
            <button type="button" aria-label="다음 달" onClick={() => setMonth(nextMonth)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
          </div>
        </div>

        <div className="season2-strip" ref={strip} role="group" aria-label="달 고르기"
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') setMonth(prevMonth); if (e.key === 'ArrowRight') setMonth(nextMonth) }}>
          {months.map((m) => (
            <button key={m} type="button" data-month={m} className={`s2-${SEASON_NAME(m)}${m === month ? ' on' : ''}`} aria-pressed={m === month} onClick={() => setMonth(m)}>
              <small>{m === now ? <span className="now-pill">지금</span> : SEASON_LABEL[SEASON_NAME(m)]}</small>
              <b>{m}월</b>
            </button>
          ))}
        </div>

        <div className="season2-title" aria-live="polite">
          <h3>{month}월에 맛있는 것 <span>{picked.length}가지</span></h3>
          <span className="season2-legend" aria-hidden="true"><i className="st-new" />막 나왔어요<i className="st-peak" />지금 한창<i className="st-last" />끝물</span>
        </div>

        {picked.length ? (
          <div className="season2-rail">
          {edge.left && <button type="button" className="rail-btn prev" aria-label="이전 카드" onClick={() => slide(-1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>}
          {edge.right && <button type="button" className="rail-btn next" aria-label="다음 카드" onClick={() => slide(1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>}
          <ul className="season2-cards" ref={rail} onScroll={checkEdge}>
            {picked.map(({ item, stage, data }) => (
              <li key={item.name}>
                <button type="button" className="season2-card" onClick={() => onPick(term(item))}
                  aria-label={`${item.name}, ${stage.text}, 제철 ${seasonRange(item.months)}${data?.price ? `, ${won(data.price)}부터` : ''}. 누르면 상품 보기`}>
                  <span className="s2-photo">
                    {data?.image ? <img src={thumbUrl(data.image)} alt="" loading="lazy" width="400" height="300" /> : <span className="s2-photo-empty">{item.name}</span>}
                    <em className={`s2-stage st-${stage.key}`}>{stage.text}</em>
                    {data && data.live === 0 && <em className="s2-sold">지금은 품절</em>}
                  </span>
                  <span className="s2-body">
                    <strong>{item.name}</strong>
                    <span className="s2-range">{seasonRange(item.months)}</span>
                    <span className="s2-bar" aria-hidden="true">
                      {months.map((m) => <i key={m} className={`${item.months.includes(m) ? 'in' : ''}${m === month ? ' cur' : ''}`} />)}
                    </span>
                    <span className="s2-foot">
                      {data?.price ? <b>{won(data.price)}부터</b> : <b className="muted">{data ? '준비 중' : '…'}</b>}
                      {data?.products > 0 && <span>상품 {data.products}개 →</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          </div>
        ) : <p className="muted season2-empty">이 달에 제철로 표시한 품목이 없어요. 다른 달을 골라 보세요.</p>}

        <p className="note">{SEASON.note}</p>
      </div>
    </section>
  )
}

// [11, 12, 1, 2] → '11~2월', [3, 4, 5, 9, 10, 11] → '3~5월, 9~11월'
function seasonRange(list) {
  if (list.length >= 12) return '사계절'
  return [...list].sort((a, b) => a - b).filter((m) => !list.includes(prevMonth(m))).map((start) => {
    let end = start
    while (list.includes(nextMonth(end)) && nextMonth(end) !== start) end = nextMonth(end)
    return end === start ? `${start}월` : `${start}~${end}월`
  }).join(', ')
}


// 이야기: 3장짜리 슬라이드 배너 (왼쪽 글, 오른쪽 사진). 저절로 넘어가고, 마우스·포커스가 있거나 정지를 누르면 멈춘다.
// '움직임 줄이기'를 켠 손님에게는 처음부터 멈춰 있다. 화살표 키로도 넘긴다
export function Story() {
  const slides = STORY.slides
  const [index, setIndex] = useState(0)
  const [stopped, setStopped] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [hold, setHold] = useState(false)
  const go = (i) => setIndex((i + slides.length) % slides.length)
  useEffect(() => {
    if (stopped || hold) return undefined
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), STORY.interval)
    return () => clearInterval(timer)
  }, [stopped, hold, slides.length])
  const now = slides[index]
  return (
    <section id="story" className="section story-section" aria-roledescription="carousel" aria-label={STORY.label}
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(index - 1); if (e.key === 'ArrowRight') go(index + 1) }}>
      <div className="wrap story">
      <div className="story-banner">
        <div className="story-photos" aria-hidden="true">
          {slides.map((sl, i) => <img key={sl.photo.src} className={i === index ? 'on' : ''} src={sl.photo.src} alt="" loading="lazy" style={{ objectPosition: sl.photo.position }} />)}
        </div>
        <div className="story-text" aria-live={stopped ? 'polite' : 'off'}>
          <p className="story-label">{STORY.label} <span>{index + 1} / {slides.length}</span></p>
          <h2 key={index} className="display-sm story-title">{now.title.map((line) => <span key={line}>{line}</span>)}</h2>
          <p className="story-lead">{now.text}</p>
          <span className="sr-only">사진: {now.photo.alt}</span>
          <div className="story-links">
            {now.links.map((l, i) => (
              <a key={l.label} className={i === 0 ? 'story-btn' : 'story-btn ghost'} href={l.href}
                {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{l.label}</a>
            ))}
          </div>
          <div className="story-ctrl" role="group" aria-label="이야기 넘기기">
            <button type="button" aria-label="이전 이야기" onClick={() => go(index - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
            <button type="button" aria-label={stopped ? '자동 넘김 시작' : '자동 넘김 정지'} aria-pressed={stopped} onClick={() => setStopped((v) => !v)}>
              {stopped ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" className="fill" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>}
            </button>
            <button type="button" aria-label="다음 이야기" onClick={() => go(index + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
            <span className="story-bars" aria-hidden="true">{slides.map((sl, i) => <button key={sl.photo.src} type="button" tabIndex={-1} className={i === index ? 'on' : ''} onClick={() => go(i)} />)}</span>
          </div>
        </div>
      </div>
      </div>
    </section>
  )
}

// 질문 분류 태그: 이름과 작은 아이콘
const FAQ_TAGS = {
  order: ['주문·결제', 'M5 4h2l1.6 9h9L19 7H7.2M9 18a1 1 0 1 0 0 .01M16 18a1 1 0 1 0 0 .01'],
  delivery: ['배송', 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.6 1.6 0 1 0 0 .01M17 19a1.6 1.6 0 1 0 0 .01'],
  keep: ['보관', 'M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9'],
  pick: ['추천', 'M12 3l2.2 5.6L20 9.3l-4.4 3.8 1.4 5.9L12 16l-5 3 1.4-5.9L4 9.3l5.8-.7z'],
  bulk: ['대량 구매', 'M3 8l9-4 9 4-9 4zM3 8v8l9 4 9-4V8M12 12v8'],
}

export function Faq({ policy, onRecommend }) {
  const fill = (text) => text
    .replace('{출고}', policy?.shipping.leadTime ?? '평일 오후 2시까지 결제하면 그날 출고해요')
    .replace('{배송비}', policy ? won(policy.shipping.fee) : '정책에 따라')
    .replace('{무료배송}', policy ? won(policy.shipping.freeOver) : '일정 금액')
    .replaceAll('{전화}', policy?.shop.phone ?? '고객센터')
    .replaceAll('{업무시간}', policy?.shop.hours ?? '업무 시간')
  return (
    <section id="faq" className="wrap section faq" aria-labelledby="faq-title">
      <div>
        <h2 id="faq-title" className="display-sm">자주 묻는 질문</h2>
        <p className="lead">{FAQ.lead}</p>
        {policy?.shop?.phone && (
          <div className="faq-help">
            <p className="faq-help-title">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2L19 14.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>
              전화 문의
            </p>
            <a href={`tel:${policy.shop.phone.replace(/\D/g, '')}`} className="faq-help-phone">{policy.shop.phone}</a>
            {policy.shop.hours && <p className="faq-help-hours">{policy.shop.hours}</p>}
          </div>
        )}
      </div>
      <div>
        <div className="faq-list">
          {FAQ.items.map((item) => (
            <details key={item.q}>
              <summary>
                {FAQ_TAGS[item.tag] && (
                  <span className="faq-tag">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={FAQ_TAGS[item.tag][1]} /></svg>
                    {FAQ_TAGS[item.tag][0]}
                  </span>
                )}
                <span className="faq-q">{item.q}</span>
              </summary>
              <p>{fill(item.a)}</p>
              {item.action === 'recommend' && <button type="button" className="btn-line" onClick={onRecommend}>추천받기</button>}
            </details>
          ))}
        </div>
        <p className="faq-more"><a href="/faq">자주 묻는 질문 더 보기 →</a></p>
        <p className="note">{FAQ.note}</p>
      </div>
    </section>
  )
}

// 추천받기 창 (질문형 추천을 대화상자로)
export function QuizDialog({ open, onClose, onOpen }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className="quiz-dialog" onClose={onClose} aria-label="추천받기">
      {open && <Quiz startOpen onClose={onClose} onOpen={(code) => { onClose(); onOpen(code) }} />}
    </dialog>
  )
}
