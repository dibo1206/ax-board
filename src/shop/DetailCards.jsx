// 자동 상세 카드 (2026-11-14): 모든 상품 상세 화면에 저장된 값만으로 그린다 (내용 고르기는 detailFacts.js)
// 판매 농가가 상세 블록을 쓰지 않은 상품도 쿠팡 상세페이지처럼 한눈에 보이게. 사진 속 글자가 아니라 화면 글이라
// 가격·당도가 바뀌면 바로 바뀌고, 휴대폰 글자 크기·화면 낭독기·검색엔진에도 그대로 읽힌다
import { useEffect, useState } from 'react'
import { brixGauge, headline, keyFacts, optionRows } from './detailFacts.js'
import { getPolicy, won } from './shared.js'

// 맨 위 [한눈에 보기]: 농가 한 줄 · 상품 소개 · 값 타일
export function KeyFactsCard({ product }) {
  const facts = keyFacts(product)
  const { kicker, title } = headline(product)
  if (facts.length < 2) return null
  return (
    <section className="box auto-card key-facts" aria-labelledby="key-facts-title">
      {kicker && <p className="auto-kicker">{kicker}</p>}
      <h3 id="key-facts-title" className="auto-title">{title}</h3>
      <dl className="fact-tiles">
        {facts.map((f) => (
          <div key={f.label} className="fact-tile">
            <dt>{f.label}</dt>
            <dd>{f.value}{f.note && <small>{f.note}</small>}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// [당도] 눈금: 측정값 위치와 공식 기준선. 등급 이름은 서버가 정한 것만 (판매자가 고를 수 없다)
export function BrixCard({ product }) {
  const g = brixGauge(product)
  if (!g) return null
  return (
    <section className="box auto-card brix-card" aria-labelledby="brix-card-title">
      <h3 id="brix-card-title">당도</h3>
      <p className="brix-big"><strong>{g.value}</strong> Brix{g.grade && <span className={`brix-grade rank-${product.brix_rank}`}>{g.grade}</span>}</p>
      <div className="brix-scale" role="img" aria-label={`당도 ${g.value}Brix, 눈금 ${g.lo}~${g.hi}${g.standards.map((s) => `, ${s.label} ${s.value} 이상`).join('')}`}>
        <div className="brix-bar" />
        {g.standards.map((s) => <span key={s.label} className="brix-std" style={{ left: `${s.at}%` }}><i />{s.label} {s.value}</span>)}
        <span className="brix-dot" style={{ left: `${g.at}%` }} />
        <span className="brix-end lo">{g.lo}</span><span className="brix-end hi">{g.hi}</span>
      </div>
      <p className="muted">
        {g.variety && `${g.variety} · `}{g.measuredAt ? `${g.measuredAt} 판매 농가가 당도계로 잰 값이에요.` : '판매 농가가 당도계로 잰 값이에요.'} 과일마다 차이가 있을 수 있어요.
        {g.photo && <> <a href={g.photo} target="_blank" rel="noreferrer">측정 사진 보기</a></>}
      </p>
      {g.standards.length > 0 && g.source && <p className="note">기준 출처: {g.source}</p>}
    </section>
  )
}

// [구성 비교]: 옵션이 2개 이상일 때. 누르면 위 구매 칸의 옵션이 그걸로 바뀐다
export function OptionsCard({ product, optionId, onPick }) {
  const rows = optionRows(product)
  const [shipping, setShipping] = useState(null)
  useEffect(() => { getPolicy().then((p) => setShipping(p.shipping)).catch(() => {}) }, [])
  if (!rows) return null
  return (
    <section className="box auto-card options-card" aria-labelledby="options-card-title">
      <h3 id="options-card-title">구성 비교</h3>
      <ul className="option-tiles">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className={`option-tile${r.id === optionId ? ' on' : ''}${r.soldOut ? ' sold-out' : ''}`} onClick={() => onPick(r.id)} disabled={r.soldOut} aria-pressed={r.id === optionId}>
              {r.best && <span className="option-best">100g당 가장 낮은 가격</span>}
              <strong>{r.name}</strong>
              <span className="option-price">{r.soldOut ? '품절' : won(r.price)}</span>
              {r.per100 && !r.soldOut && <small>{r.per100}</small>}
            </button>
          </li>
        ))}
      </ul>
      {shipping && <p className="ship-line">상품 {won(shipping.freeOver)} 이상이면 무료 배송 · 그 아래는 주문 한 번에 {won(shipping.fee)} · {shipping.courier}</p>}
    </section>
  )
}
