import { useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 5단계 상담 기록: 손님이 물은 것과 답, 답 못 한 질문 모아 보기. 틀린 답을 찾아 chat_rules.md·상품 정보를 고치는 데 쓴다
const when = (t) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

// 답 못 한 질문: 비슷한 질문끼리 묶어 많은 순. 위에서부터 품목 정보·Q&A를 채우면 AI 호출이 가장 많이 준다
function Gaps() {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    adminApi(`/chat-logs/gaps?days=${days}`)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [days])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">불러오는 중…</p>
  return (
    <div className="box">
      <h3>답 못 한 질문 <span className="muted">최근 {days}일 · 비슷한 질문끼리 묶음</span></h3>
      <div className="filters">
        {[7, 30, 90].map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>최근 {n}일</button>)}
      </div>
      <p className="muted">규칙으로 못 답해 안내로 끝났거나, AI가 답했거나, 하루 상한 때문에 못 답한 질문 {data.total}건. 위에서부터 채우면 AI 호출이 가장 많이 줄어요.</p>
      {data.groups.length === 0 ? <p className="muted">없어요. 모든 질문을 AI 없이 답했어요.</p> : (
        <table className="table">
          <thead><tr><th>질문 (비슷한 질문)</th><th className="nowrap">횟수</th><th className="nowrap">처리</th><th>할 일</th></tr></thead>
          <tbody>
            {data.groups.map((g) => (
              <tr key={g.question} className={g.resolved ? 'muted' : ''}>
                <td>{g.question}{g.examples.length > 0 && <><br /><span className="muted">{g.examples.join(' / ')}</span></>}</td>
                <td><b>{g.count}</b></td>
                <td className="muted nowrap">{[g.guided && `안내 ${g.guided}`, g.ai && `AI ${g.ai}`, g.limit && `상한 ${g.limit}`].filter(Boolean).join(' · ')}</td>
                <td className="muted">{g.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function ChatLogs() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi('/chat-logs').then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">불러오는 중…</p>
  const { summary, logs } = data

  return (
    <section>
      <p>전체 {summary.total}건 · AI 없이 답함(규칙·저장된 답) {summary.no_ai}건 · 담당자로 넘김 {summary.handed_off}건 · 답 검사에 걸림 {summary.blocked}건 <span className="muted">(최근 200건 표시)</span></p>
      <p className="muted">오늘 AI 호출 {summary.ai_today} / {summary.ai_limit}회 (모든 손님 합계, 넘으면 Q&A로 안내)</p>
      <Gaps />
      <h3>전체 기록</h3>
      {logs.length === 0 ? <p className="muted">아직 상담 기록이 없어요.</p> : (
        <table className="table">
          <thead><tr><th>때</th><th>질문</th><th>답</th><th>근거·처리</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="muted">{when(l.created_at)}</td>
                <td>{l.question}</td>
                <td>{l.answer}</td>
                <td>
                  {l.sources?.length > 0 && <span className="muted">{l.sources.join(', ')}<br /></span>}
                  {l.handed_off && <span className="badge">넘김</span>} {l.blocked && <span className="badge soldout">검사 걸림</span>}
                  <br /><span className="muted">{l.model}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
