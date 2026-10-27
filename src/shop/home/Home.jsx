import { useEffect, useRef, useState } from 'react'
import { Quiz } from '../../Recommend.jsx'
import { RatingBadge } from '../Reviews.jsx'
import { thumbUrl, unitPrice, won } from '../shared.js'
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

export function Hero({ onRecommend }) {
  return (
    <section className="home-hero">
      <div className="hero-text">
        <p className="eyebrow">{HERO.eyebrow}</p>
        <h1 className="display">{HERO.title.map((line) => <span key={line}>{line}</span>)}</h1>
        <p className="lead">{HERO.lead}</p>
        <button type="button" className="btn-dark" onClick={onRecommend}>{HERO.cta} <span aria-hidden="true">→</span></button>
      </div>
      <Photo photo={HERO.photo} className="hero-photo" eager />
    </section>
  )
}

export function CategoryRows({ groups, onPick }) {
  if (!groups?.length) return null
  return (
    <section className="wrap section cat-section" aria-labelledby="cat-title">
      <h2 id="cat-title" className="rule-label">카테고리</h2>
      <ul className="cat-rows">
        {groups.map((g, i) => (
          <li key={g.key}>
            <button type="button" onClick={() => onPick(g.key)}>
              <span className="cat-no">{String(i + 1).padStart(2, '0')}</span>
              <span className="cat-name">{g.name}</span>
              <span className="cat-desc">{g.desc}</span>
              <span className="cat-count">{g.count}개 상품</span>
              <Photo photo={GROUP_PHOTOS[g.key]} className="cat-photo" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProductCard({ p, onOpen }) {
  return (
    <a href={`/p/${encodeURIComponent(p.product_code)}`} className={`pcard${p.sold_out ? ' soldout' : ''}`} onClick={(e) => { e.preventDefault(); onOpen(p.product_code) }}>
      <span className="pcard-img">
        {p.image_url
          ? <img src={thumbUrl(p.image_url)} alt="" loading="lazy" width="400" height="400" />
          : <span className="photo-need"><span>사진 준비 중</span></span>}
        {p.sold_out && <span className="pcard-flag">품절</span>}
      </span>
      <span className="pcard-seller">{p.seller_name.replace(/\[예시\]\s*/g, '')}</span>
      <strong className="pcard-name">{p.name}</strong>
      <span className="pcard-price">{won(p.price)} <small>/ {p.unit}</small></span>
      {unitPrice(p.price, p.unit) && <span className="pcard-unit">{unitPrice(p.price, p.unit)}</span>}
      <span className="pcard-meta">
        {p.tags?.includes('season') && <span className="tag">제철</span>}
        {p.show_brix && p.brix && <span className="tag">당도 {p.brix}Brix</span>}
        <RatingBadge rating={p.rating} count={p.review_count} />
      </span>
    </a>
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
          <p className="lead">언제 가장 맛있는지 한눈에. 지금은 {now}月입니다.</p>
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

export function Story() {
  return (
    <section id="story" className="section story-section" aria-labelledby="story-title">
      <div className="wrap story">
        <div>
          <h2 id="story-title" className="display-sm">{STORY.title.map((line) => <span key={line}>{line}</span>)}</h2>
          <Photo photo={STORY.photos[0]} className="story-photo" />
        </div>
        <div>
          <ol className="story-points">
            {STORY.points.map((p, i) => (
              <li key={p.title}>
                <span className="story-no">{String(i + 1).padStart(2, '0')}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </li>
            ))}
          </ol>
          <Photo photo={STORY.photos[1]} className="story-photo tall" />
        </div>
      </div>
    </section>
  )
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
      </div>
      <div>
        <div className="faq-list">
          {FAQ.items.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
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
