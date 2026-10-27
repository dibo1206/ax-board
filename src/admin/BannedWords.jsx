import { useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 금지어 사전: 상품 글·AI 초안·답변·후기·손님 문의를 이 목록으로 거른다 (AI 를 부르지 않는 검사라 비용 0)
// 식품 표시·광고법이 바뀌거나 새 광고 문구가 보이면 여기서 바로 고친다. 고치면 바로 적용된다
const KIND_HELP = {
  효능: '건강 효과 표현 — 상품 글·AI 초안·답변·후기에 못 씀 (손님이 궁금해서 묻는 문의는 막지 않음)',
  욕설: '후기·상품 문의에서 거름',
  광고: '후기·상품 문의의 홍보·도박·대출 문구',
  기타: '그 밖에 쓰면 안 되는 말 (후기·상품 글)',
}

export function BannedWords() {
  const [data, setData] = useState(null)
  const [word, setWord] = useState('')
  const [kind, setKind] = useState('효능')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const load = () => adminApi('/banned-words').then(setData).catch((e) => setError(e.message))
  useEffect(() => {
    adminApi('/banned-words').then(setData).catch((e) => setError(e.message))
  }, [])

  async function add(event) {
    event.preventDefault()
    setError('')
    try {
      await adminApi('/banned-words', { method: 'POST', body: { word, kind, note } })
      setWord('')
      setNote('')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(w) {
    if (!window.confirm(`'${w}'를 금지어에서 뺄까요?`)) return
    try {
      await adminApi(`/banned-words/${encodeURIComponent(w)}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  return (
    <section>
      <p className="muted">상품 글·AI 초안·답변·후기·손님 문의를 이 목록으로 걸러요. 띄어 써도("면 역 력") 잡아요. 고치면 바로 적용돼요.</p>
      <form className="box form" onSubmit={add}>
        <div className="row">
          <label>금지어<input value={word} onChange={(e) => setWord(e.target.value)} maxLength={30} placeholder="예: 관절" /></label>
          <label>종류
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {data.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>메모 (선택)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} placeholder="예: 2026 식품표시광고법 개정" /></label>
        </div>
        <p className="muted">{KIND_HELP[kind]}</p>
        <button type="submit" className="button" disabled={word.trim().length < 2}>추가</button>
      </form>
      {error && <p className="error">{error}</p>}
      {data.kinds.map((k) => {
        const list = data.words.filter((w) => w.kind === k)
        return (
          <div key={k} className="box">
            <h3>{k} <span className="muted">{list.length}개 · {KIND_HELP[k]}</span></h3>
            {list.length === 0 ? <p className="muted">없어요.</p> : (
              <div className="chips">
                {list.map((w) => (
                  <button key={w.word} type="button" title={w.note ? `메모: ${w.note}` : '누르면 빼기'} onClick={() => remove(w.word)}>{w.word} ✕</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
