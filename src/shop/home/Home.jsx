import { useEffect, useRef, useState } from 'react'
import { Quiz } from '../../Recommend.jsx'
import { RatingBadge } from '../Reviews.jsx'
import { addToCart, cheapestOption, shipDay, thumbUrl, unitPrice, won } from '../shared.js'
import { FAQ, GROUP_PHOTOS, HERO, SEASON, STORY } from './content.js'

// 첫 화면 (디자인 시안): 큰 제목 → 카테고리 → 이달의 상품 → 제철 달력 → 이야기 → 자주 묻는 질문

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

// 옵션 상품(5kg·10kg …)은 판매 중 옵션의 가장 낮은 가격을 "~부터"로, 100g당 가격도 그 옵션으로. 모든 옵션이 품절이면 품절
function ProductCard({ p, onOpen }) {
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
            {/* 등급은 품목·품종별 공식 기준으로 서버가 정한다. 기준이 없거나 보통 당도면 측정값만. 동그라미에는 숫자만 넣고, 등급은 마우스 올림·스크린리더 글로 알린다 */}
            {p.show_brix && p.brix && !p.info_disputed && (
              <span className={`ptag ptag-brix ${p.brix_rank === 3 ? 'brix-high' : p.brix_rank === 2 ? 'brix-mid' : ''}`}
                title={p.brix_rank >= 2 ? `${p.brix_grade} ${Number(p.brix)}°Bx` : `당도 ${Number(p.brix)}°Bx`}
                aria-label={p.brix_rank >= 2 ? `${p.brix_grade} ${Number(p.brix)}°Bx` : `당도 ${Number(p.brix)}°Bx`}>
                <small aria-hidden="true">당도</small><b aria-hidden="true">{Number(p.brix)}</b>
              </span>
            )}
            {p.harvest_days != null && p.harvest_days <= 30 && (
              <span className="ptag ptag-harvest" aria-label={`수확 ${p.harvest_days}일째`}><small aria-hidden="true">수확</small><b aria-hidden="true">{p.harvest_days}일째</b></span>
            )}
            {p.tags?.includes('season') && <span className="ptag ptag-season">제철</span>}
          </span>
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
    </div>
  )
}

// 이달의 상품: 카테고리 탭(노란 밑줄) + 오른쪽 상품 검색 + 정렬 + 카드 + 더 보기
export function ProductSection({ groups, loc, typed, setTyped, list, sorts, onChange, onOpen, onMore, loadingMore }) {
  const tabs = [{ key: 'all', name: '전체' }, ...(groups ?? [])]
  return (
    <section id="products" className="wrap section" aria-labelledby="products-title">
      <div className="products-head">
        <h2 id="products-title" className="display-sm">이달의 상품</h2>
        <form className="underline-search" role="search" onSubmit={(e) => { e.preventDefault(); onChange({ q: typed.trim() }) }}>
          <label htmlFor="product-search">상품 검색</label>
          <input id="product-search" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="사과, 농축액…" maxLength={50} />
        </form>
      </div>
      <div className="products-bar">
        <nav className="text-tabs" aria-label="카테고리">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={t.key === loc.cat ? 'on' : ''} aria-pressed={t.key === loc.cat} onClick={() => onChange({ cat: t.key })}>{t.name}</button>
          ))}
        </nav>
        <label className="brix-filter"><input type="checkbox" checked={loc.brix === 'high'} onChange={(e) => onChange({ brix: e.target.checked ? 'high' : '' })} /> 높은 당도 이상</label>
        <select className="sort" value={loc.sort} onChange={(e) => onChange({ sort: e.target.value })} aria-label="정렬">
          {sorts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {!list ? <p className="muted">불러오는 중…</p> : list.total === 0 ? (
        <div className="empty">
          <p>{loc.q ? `'${loc.q}'에 맞는 상품이 없습니다.` : '조건에 맞는 상품이 없습니다.'}</p>
          <p className="muted">다른 말로 찾아보거나, 오른쪽 아래 상담하기에 원하는 걸 말해 보세요. (예: 부모님 선물로 달달한 거)</p>
        </div>
      ) : (
        <>
          {loc.q && <p className="muted result-count">'{loc.q}' 검색 결과 {list.total}개</p>}
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

// 제철 달력: 품목마다 맛있는 달을 막대로. 이번 달은 노란 밑줄. 품목을 누르면 그 이름으로 상품을 찾는다
export function SeasonCalendar({ onPick }) {
  const [now] = useState(() => new Date().getMonth() + 1) // 이번 달 (처음 그릴 때 한 번 정한다)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const range = (m) => `${Math.min(...m)}~${Math.max(...m)}월`
  return (
    <section id="season" className="section season-section" aria-labelledby="season-title">
      <div className="wrap season">
        <Photo photo={SEASON.photo} className="season-photo" />
        <div className="season-body">
          <h2 id="season-title" className="display-sm">제철 달력</h2>
          <p className="lead">언제 가장 맛있는지 한눈에. 지금은 {now}월입니다.</p>
          <div className="season-chart">
            <div className="season-row season-months" aria-hidden="true">
              <span />
              {months.map((m) => <span key={m} className={m === now ? 'now' : ''}>{m}</span>)}
            </div>
            {SEASON.items.map((item) => (
              <button key={item.name} type="button" className="season-row" onClick={() => onPick(item.name)}
                aria-label={`${item.name} 제철 ${range(item.months)}${item.months.includes(now) ? ', 지금 제철' : ''}. 누르면 ${item.name} 상품 찾기`}
                title={`${item.name} · ${range(item.months)}`}>
                <span className="season-name">{item.name}</span>
                {/* 이어진 달은 막대 하나로 그린다 (12월→1월로 넘어가는 품목은 두 막대) */}
                {months.map((m) => item.months.includes(m) && !item.months.includes(m - 1) && (
                  <span key={m} className="season-bar" style={{ gridColumn: `${m + 1} / span ${spanFrom(item.months, m)}` }} />
                ))}
              </button>
            ))}
          </div>
          <p className="note">{SEASON.note}</p>
        </div>
      </div>
    </section>
  )
}

const spanFrom = (list, start) => {
  let n = 0
  while (list.includes(start + n) && start + n <= 12) n += 1
  return n
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
    .replace('{출고}', policy?.shipping.leadTime ?? '결제 후 1~3일 안에 출고해요')
    .replace('{배송비}', policy ? won(policy.shipping.fee) : '정책에 따라')
    .replace('{무료배송}', policy ? won(policy.shipping.freeOver) : '일정 금액')
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
