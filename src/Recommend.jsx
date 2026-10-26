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
            <span>{won(x.price)}</span>
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

// 질문 문구는 태그 묶음(tags.csv의 group)마다 하나. 태그를 새로 추가하면 선택지에 자동으로 나온다
const QUESTIONS = {
  용도: '누구를 위한 건가요?',
  '먹는 방식': '어떻게 드실 건가요?',
  맛: '어떤 맛이 좋아요?',
  보관: '언제 드실 건가요?',
  기타: '더 원하는 게 있나요?',
}
const BUDGETS = [['', '상관없어요'], ['20000', '2만 원 이하'], ['30000', '3만 원 이하'], ['50000', '5만 원 이하']]

export function Quiz({ onOpen }) {
  const [tags, setTags] = useState([])
  const [open, setOpen] = useState(false)
  const [want, setWant] = useState([])
  const [budget, setBudget] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && !tags.length) get('/tags').then(setTags).catch((e) => setError(e.message))
  }, [open, tags.length])

  const toggle = (code) => setWant((prev) => (prev.includes(code) ? prev.filter((t) => t !== code) : [...prev, code]))

  async function submit() {
    setError('')
    try {
      const query = new URLSearchParams({ tags: want.join(','), budget })
      setResult((await get(`/recommend?${query}`)).items)
    } catch (e) {
      setError(e.message)
    }
  }

  if (!open) {
    return (
      <button type="button" className="box quiz-open" onClick={() => setOpen(true)}>
        <strong>뭘 사야 할지 모르겠다면?</strong> <span className="muted">몇 가지만 고르면 맞는 상품을 골라 드려요 →</span>
      </button>
    )
  }

  // 질문 순서는 QUESTIONS에 적은 순서, 새로 생긴 묶음은 맨 뒤
  const present = [...new Set(tags.map((t) => t.tag_group))]
  const groups = [...Object.keys(QUESTIONS).filter((g) => present.includes(g)), ...present.filter((g) => !(g in QUESTIONS))]
  return (
    <section className="box quiz">
      <h3>추천 받기</h3>
      {groups.map((g) => (
        <div key={g} className="quiz-row">
          <span>{QUESTIONS[g] ?? g}</span>
          <div className="chips">
            {tags.filter((t) => t.tag_group === g).map((t) => (
              <button key={t.tag_code} type="button" className={want.includes(t.tag_code) ? 'on' : ''} onClick={() => toggle(t.tag_code)}>{t.label}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="quiz-row">
        <span>예산은요?</span>
        <div className="chips">
          {BUDGETS.map(([value, label]) => (
            <button key={label} type="button" className={budget === value ? 'on' : ''} onClick={() => setBudget(value)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="actions">
        <button type="button" className="button ghost" onClick={() => { setOpen(false); setResult(null) }}>닫기</button>
        <button type="button" className="button" onClick={submit}>추천 받기</button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (result.length
        ? <><p className="muted">고른 조건에 많이 맞는 순서예요. 품절 상품은 빼고 골랐어요.</p><PickList items={result} onOpen={onOpen} /></>
        : <p className="muted">조건에 맞는 상품이 지금은 없어요. 조건을 줄여 보세요.</p>)}
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
