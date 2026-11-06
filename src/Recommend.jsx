import { useEffect, useState } from 'react'
import { netFetch } from './net.js'
import { thumbUrl } from './shop/shared.js'

// 6단계: 이번 주 추천 배너 · 질문형 추천 · 함께 보면 좋은 상품
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`

async function get(path) {
  const response = await netFetch(`/api${path}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '추천을 불러오지 못했어요.')
  return data
}

function PickList({ items, onOpen }) {
  return (
    <ul className="picks">
      {items.map((x) => (
        <li key={x.product_code}>
          <button type="button" className="card" onClick={() => onOpen(x.product_code)}>
            {x.image_url && <img className="thumb" src={thumbUrl(x.image_url)} alt="" loading="lazy" width="160" height="160" />}
            <strong>{x.name}</strong>
            <span>{won(x.price)}{x.has_options && '부터'}</span>
            <span className="reasons">{x.reasons.map((r) => <span key={r} className="badge">{r}</span>)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Featured({ onOpen }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    get('/featured').then((d) => setItems(d.items)).catch(() => setItems([]))
  }, [])
  if (!items.length) return null
  return (
    <section className="box">
      <h3>이번 주 추천 <span className="muted">제철·당도 측정 상품</span></h3>
      <PickList items={items} onOpen={onOpen} />
    </section>
  )
}

// 질문 문구는 태그 묶음(tags.csv의 group)마다 하나. 태그를 새로 추가하면 선택지에 자동으로 나오고,
// 처음 보는 묶음은 '기타' 앞에 새 단계로 붙는다. '종류'는 태그가 아니라 품목 분류(과일·채소·가공품)
const QUESTIONS = {
  용도: ['누구를 위한 건가요?', '여러 개 골라도 돼요'],
  종류: ['어떤 걸 찾으세요?', '여러 개 골라도 돼요'],
  '먹는 방식': ['어떻게 드실 건가요?', '여러 개 골라도 돼요'],
  맛: ['어떤 맛이 좋아요?', '여러 개 골라도 돼요'],
  보관: ['언제 드실 건가요?', '한 번에 다 드실지, 두고 드실지'],
  기타: ['더 원하는 게 있나요?', '없으면 건너뛰어도 돼요'],
}
// 선택지 아래 작은 설명. 여기 없는 태그는 이름만 보여 준다
const HINTS = {
  gift: '명절, 부모님, 답례', home: '우리 가족 식탁', cafe: '음료, 디저트 재료', kids: '간식, 도시락',
  raw: '씻거나 깎아서 바로', cook: '반찬, 조림, 구이', drink: '즙, 에이드, 차', spread: '빵, 요거트에',
  sweet: '당도가 높은 것', sour: '상큼한 맛', mild: '달지 않은 것',
  keep_long: '오래 두고 조금씩', eat_soon: '며칠 안에 다 먹기', season: '지금이 제철인 것',
}
const CATEGORY_HINTS = { 과일: '사과, 배, 복숭아', 채소: '감자, 고구마, 당근', 가공품: '배즙, 매실청, 포도잼' }
const BUDGETS = [['15000', '1만 5천 원 이하'], ['20000', '2만 원 이하'], ['30000', '3만 원 이하'], ['', '상관없어요']]

// 화면에서 "지금 조건에 맞는 상품 N개"를 세는 규칙. 서버 recommend()와 같다 (태그는 하나라도 맞으면 남긴다)
const fits = (p, { want, categories, budget }) =>
  (!categories.length || categories.includes(p.category)) && (!budget || p.price <= Number(budget)) && (!want.length || want.some((t) => p.tags.includes(t)))

function stepsOf(tags) {
  const present = [...new Set(tags.map((t) => t.tag_group))]
  const known = Object.keys(QUESTIONS).filter((g) => g === '종류' || present.includes(g))
  const extra = present.filter((g) => !(g in QUESTIONS))
  return [...known.filter((g) => g !== '기타'), ...extra, ...known.filter((g) => g === '기타'), '예산']
}

// 추천 결과 한 줄: 맞은 조건(✓), 안 맞은 조건(✕), 예산·종류 때문에 빠진 이유, 그 밖의 장점(제철, 당도)
function ResultItem({ x, best = false, onOpen }) {
  return (
    <li>
      <button type="button" className="quiz2-item" onClick={() => onOpen(x.product_code)}>
        <span className="quiz2-img">
          {x.image_url && <img src={thumbUrl(x.image_url)} alt="" loading="lazy" width="112" height="112" />}
          {best && <span className="quiz2-best">{x.missed.length ? '가장 가까워요' : '가장 잘 맞아요'}</span>}
        </span>
        <span className="quiz2-info">
          <span className="quiz2-seller">{x.seller_name}{x.seller_region ? ` · ${x.seller_region}` : ''}</span>
          <strong>{x.name}</strong>
          <span className="quiz2-price">{won(x.price)}{x.has_options && <small> 부터</small>}</span>
          <span className="quiz2-why">
            {x.because?.map((r) => <span key={r} className="off">{r}</span>)}
            {x.matched.map((r) => <span key={r} className="hit">✓ {r}</span>)}
            {x.missed.map((r) => <span key={r} className="miss">✕ {r}</span>)}
            {x.reasons.filter((r) => !x.matched.includes(r)).map((r) => <span key={r}>{r}</span>)}
          </span>
        </span>
        <span className="quiz2-go" aria-hidden="true">→</span>
      </button>
    </li>
  )
}

// startOpen·onClose: 추천받기 창(대화상자) 안에서 쓸 때
export function Quiz({ onOpen, startOpen = false, onClose }) {
  const [open, setOpen] = useState(startOpen)
  const [tags, setTags] = useState([])
  const [options, setOptions] = useState(null)
  const [step, setStep] = useState(0)
  const [want, setWant] = useState([])
  const [categories, setCategories] = useState([])
  const [budget, setBudget] = useState('')
  const [result, setResult] = useState(null)
  const [near, setNear] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || options) return
    Promise.all([get('/tags'), get('/recommend/options')])
      .then(([t, o]) => { setTags(t); setOptions(o) })
      .catch((e) => setError(e.message))
  }, [open, options])

  if (!open) {
    return (
      <button type="button" className="box quiz-open" onClick={() => setOpen(true)}>
        <strong>뭘 사야 할지 모르겠다면?</strong> <span className="muted">몇 가지만 고르면 맞는 상품을 골라 드려요 →</span>
      </button>
    )
  }

  const close = () => { if (onClose) onClose(); else setOpen(false) }
  const products = options?.products ?? []
  const choice = { want, categories, budget }
  const matching = products.filter((p) => fits(p, choice)).length
  const steps = stepsOf(tags)
  const total = steps.length
  const current = steps[Math.min(step, total - 1)]
  const last = step + 1 >= total

  const toggle = (setter) => (value) => setter((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))

  async function showResult() {
    setError('')
    try {
      const query = new URLSearchParams({ tags: want.join(','), category: categories.join(','), budget, limit: 'all' })
      // 예산이나 종류 때문에 빠진 상품은 "조건을 조금 넓히면"에 빠진 이유와 함께 따로 보여 준다
      const wide = budget || categories.length ? get(`/recommend?${new URLSearchParams({ tags: want.join(','), limit: 'all' })}`) : null
      const [found, wider] = await Promise.all([get(`/recommend?${query}`), wide])
      const shown = new Set(found.items.map((x) => x.product_code))
      setNear((wider?.items ?? []).filter((x) => !shown.has(x.product_code)).slice(0, 4).map((x) => ({
        ...x, because: [budget && x.price > Number(budget) ? `${won(Number(budget))} 넘음` : null, categories.length && !categories.includes(x.category) ? `다른 종류: ${x.category}` : null].filter(Boolean),
      })))
      setResult(found.items)
    } catch (e) {
      setError(e.message)
    }
  }
  const restart = () => { setWant([]); setCategories([]); setBudget(''); setResult(null); setNear([]); setStep(0) }

  // 선택지마다 "N개": 태그와 종류는 그걸 가진 상품 수, 예산은 지금 조건에 그 예산을 넣었을 때 남는 수
  let cards
  if (current === '종류') {
    cards = [...new Set(products.map((p) => p.category))].map((c) => ({
      key: c, label: c, hint: CATEGORY_HINTS[c], count: products.filter((p) => p.category === c).length, on: categories.includes(c), pick: () => toggle(setCategories)(c),
    }))
  } else if (current === '예산') {
    cards = BUDGETS.map(([value, label]) => ({
      key: label, label, count: products.filter((p) => fits(p, { ...choice, budget: value })).length, on: budget === value, pick: () => setBudget(value),
    }))
  } else {
    const rank = (code) => (code in HINTS ? Object.keys(HINTS).indexOf(code) : 99)
    cards = tags.filter((t) => t.tag_group === current).sort((a, b) => rank(a.tag_code) - rank(b.tag_code)).map((t) => ({
      key: t.tag_code, label: t.label, hint: HINTS[t.tag_code], count: products.filter((p) => p.tags.includes(t.tag_code)).length, on: want.includes(t.tag_code), pick: () => toggle(setWant)(t.tag_code),
    }))
  }
  const [title, sub] = current === '예산' ? ['예산은 얼마인가요?', '상품 하나 가격 기준이에요'] : (QUESTIONS[current] ?? [current, '여러 개 골라도 돼요'])
  const anyOn = current !== '예산' && cards.some((c) => c.on)
  const byStep = (t) => steps.indexOf(t.tag_group)
  const chosen = [...tags.filter((t) => want.includes(t.tag_code)).sort((a, b) => byStep(a) - byStep(b)).map((t) => t.label), ...categories, BUDGETS.find(([v]) => v && v === budget)?.[1]].filter(Boolean)

  return (
    <section className="quiz2" aria-label="추천받기">
      <header className="quiz2-head">
        <p className="quiz2-kicker">추천받기{!result && options && <span> · {step + 1} / {total}</span>}</p>
        <button type="button" className="quiz2-x" onClick={close} aria-label="닫기">×</button>
      </header>
      {!result && <div className="quiz2-bar" aria-hidden="true"><span style={{ width: `${((step + 1) / total) * 100}%` }} /></div>}

      {error && <p className="error quiz2-body">{error}</p>}
      {!options && !error && <p className="muted quiz2-body">선택지를 불러오는 중이에요…</p>}

      {options && !result && (
        <>
          <div className="quiz2-body">
            <h3 id="quiz2-q">{title}</h3>
            <p className="muted">{sub}</p>
            <div className="quiz2-grid" role="group" aria-labelledby="quiz2-q">
              {cards.map((c) => (
                <button key={c.key} type="button" className={`quiz2-opt${c.on ? ' on' : ''}`} aria-pressed={c.on} disabled={!c.count && !c.on} onClick={c.pick}>
                  <span className="quiz2-check" aria-hidden="true" />
                  <strong>{c.label}</strong>
                  {c.hint && <span className="quiz2-hint">{c.hint}</span>}
                  <span className="quiz2-count">{c.count ? `상품 ${c.count}개` : '지금 없음'}</span>
                </button>
              ))}
            </div>
          </div>
          <footer className="quiz2-foot">
            <span className="quiz2-live" aria-live="polite">
              {chosen.length ? <>지금 조건에 맞는 상품 <b>{matching}개</b></> : <>살 수 있는 상품 <b>{products.length}개</b></>}
            </span>
            <span className="quiz2-actions">
              <button type="button" className="button ghost" onClick={() => setStep(step - 1)} disabled={step === 0}>이전</button>
              {!last && <button type="button" className="button ghost" onClick={showResult}>바로 결과 보기</button>}
              <button type="button" className="button" onClick={() => (last ? showResult() : setStep(step + 1))}>
                {last ? '결과 보기' : anyOn || current === '예산' ? '다음' : '건너뛰기'}
              </button>
            </span>
          </footer>
        </>
      )}

      {result && (
        <div className="quiz2-body">
          <h3>{result.length ? `맞는 상품 ${result.length}개를 골랐어요` : '조건에 맞는 상품이 지금은 없어요'}</h3>
          <p className="muted">
            {chosen.length ? `고른 조건: ${chosen.join(' · ')}` : '조건 없이 제철, 당도 측정 상품부터 보여 드려요'}
            {options.soldOut > 0 && ` · 품절 ${options.soldOut}개는 뺐어요`}
          </p>
          {result.length > 0 ? (
            <ol className="quiz2-results">
              {result.map((x, i) => <ResultItem key={x.product_code} x={x} best={i === 0 && x.matched.length > 0} onOpen={onOpen} />)}
            </ol>
          ) : (
            <p>{near.length ? '아래는 조건을 조금 넓혔을 때 고를 수 있는 상품이에요.' : '예산을 올리거나 고른 조건을 줄여 보세요. 오른쪽 아래 [상담하기]에서 물어보셔도 돼요.'}</p>
          )}
          {near.length > 0 && (
            <>
              <h4 className="quiz2-sub">조건을 조금 넓히면</h4>
              <ol className="quiz2-results near">
                {near.map((x) => <ResultItem key={x.product_code} x={x} onOpen={onOpen} />)}
              </ol>
            </>
          )}
          <div className="quiz2-again">
            <button type="button" className="button ghost" onClick={() => { setResult(null); setStep(0) }}>조건 바꾸기</button>
            <button type="button" className="button ghost" onClick={restart}>처음부터 다시</button>
          </div>
        </div>
      )}
    </section>
  )
}

export function Related({ code, onOpen }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    get(`/products/${code}/related`).then((d) => setItems(d.items)).catch(() => setItems([]))
  }, [code])
  if (!items.length) return null
  return (
    <section className="box">
      <h3>함께 보면 좋은 상품</h3>
      <PickList items={items} onOpen={onOpen} />
    </section>
  )
}
