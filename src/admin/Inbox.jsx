import { useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 4단계 관리자 문의함: 상품 Q&A 답변 / 기업 구매 문의 처리 상태
const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const STATUSES = ['접수', '확인', '완료']

// request(body): 저장 요청. canHide: 숨기기 버튼 (판매자 화면은 없음)
export function QuestionRow({ q, onSaved, onError, request, canHide = true }) {
  const [answer, setAnswer] = useState(q.answer ?? '')
  const [open, setOpen] = useState(!q.answer)

  async function save(body, text) {
    try {
      onSaved(await request(body), text)
      setOpen(false)
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <li className={`box${q.hidden ? ' dim' : ''}`}>
      <p className="muted">{q.product_name} · {q.author} · {when(q.created_at)}{q.contact && ` · 연락처 ${q.contact}`}{q.hidden && ' · 숨김'}</p>
      <p><strong>Q.</strong> {q.question}</p>
      {open ? (
        <div className="form">
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} maxLength={1000} placeholder="상품 정보에 있는 내용으로 답해 주세요. 효능 표현은 쓰지 않아요." />
          <div className="actions">
            {q.answer && <button type="button" className="button ghost" onClick={() => setOpen(false)}>취소</button>}
            <button type="button" className="button" onClick={() => save({ answer }, '답변을 올렸어요')}>답변 저장</button>
          </div>
        </div>
      ) : (
        <p><strong>A.</strong> {q.answer} <span className="muted">({when(q.answered_at)})</span></p>
      )}
      <div className="row-actions">
        {!open && <button type="button" onClick={() => setOpen(true)}>답변 고치기</button>}
        {canHide && (
          <button type="button" onClick={() => save({ hidden: !q.hidden }, q.hidden ? '다시 보이게 했어요' : '소비자 화면에서 숨겼어요')}>
            {q.hidden ? '다시 보이기' : '숨기기'}
          </button>
        )}
      </div>
    </li>
  )
}

function B2bRow({ b, onSaved, onError }) {
  async function change(status) {
    try {
      onSaved(await adminApi(`/inquiries/b2b-inquiries/${b.id}`, { method: 'PATCH', body: { status } }), `처리 상태를 '${status}'(으)로 바꿨어요`)
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <tr className={b.status === '완료' ? 'dim' : ''}>
      <td><strong>{b.company}</strong><br /><span className="muted">{b.contact_name} · {b.contact}</span></td>
      <td>{b.product_name ?? '상품 미지정'}{b.quantity && <><br /><span className="muted">{b.quantity}개</span></>}</td>
      <td>{b.message ?? <span className="muted">-</span>}</td>
      <td className="muted">{when(b.created_at)}</td>
      <td>
        <select value={b.status} onChange={(e) => change(e.target.value)} aria-label="처리 상태">
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </td>
    </tr>
  )
}

export function Inbox({ onCount }) {
  const [questions, setQuestions] = useState(null)
  const [inquiries, setInquiries] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([adminApi('/inquiries/questions'), adminApi('/inquiries/b2b-inquiries')])
      .then(([q, b]) => { setQuestions(q); setInquiries(b) })
      .catch((e) => setError(e.message))
  }, [])

  function done(text) {
    setMessage(text)
    setError('')
    adminApi('/inquiries/summary').then(onCount).catch(() => {})
  }
  const replace = (list, row) => list.map((x) => (x.id === row.id ? { ...x, ...row } : x))

  if (!questions || !inquiries) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  const waiting = questions.filter((q) => !q.answer && !q.hidden)

  return (
    <section>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      <h3>기업 구매 문의 {inquiries.filter((b) => b.status === '접수').length}건 새로 들어옴</h3>
      {inquiries.length === 0 ? <p className="muted">아직 문의가 없어요.</p> : (
        <table className="table">
          <thead><tr><th>회사·연락처</th><th>상품·수량</th><th>요청사항</th><th>받은 때</th><th>상태</th></tr></thead>
          <tbody>
            {inquiries.map((b) => (
              <B2bRow key={b.id} b={b} onError={setError} onSaved={(row, text) => { setInquiries((list) => replace(list, row)); done(text) }} />
            ))}
          </tbody>
        </table>
      )}

      <h3>상품 Q&A · 답변 기다리는 질문 {waiting.length}개</h3>
      <ul className="inbox">
        {questions.map((q) => (
          <QuestionRow key={q.id} q={q} onError={setError} request={(body) => adminApi(`/inquiries/questions/${q.id}`, { method: 'PATCH', body })} onSaved={(row, text) => { setQuestions((list) => replace(list, row)); done(text) }} />
        ))}
      </ul>
    </section>
  )
}
