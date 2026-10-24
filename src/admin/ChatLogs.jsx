import { useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 5단계 상담 기록: 손님이 AI에게 물은 것과 답. 틀린 답을 찾아 chat_rules.md·상품 정보를 고치는 데 쓴다
const when = (t) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

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
