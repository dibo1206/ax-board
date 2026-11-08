import { useEffect, useState } from 'react'
import { adminApi } from './api.js'
import { usePage } from './paging.js'
import { FilterChips, Pager } from './ui.jsx'

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
      <p className="muted">{q.product_name} · {q.author} · {when(q.created_at)}{q.contact && ` · 연락처 ${q.contact}`}{q.hidden && ' · 숨김'}{q.is_private && ' · 비밀글'}</p>
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

// 관리자 문의함 (2026-11-08 정리 2차): 메일함처럼 왼쪽은 한 줄 목록, 누르면 오른쪽에서 읽고 답한다.
// 위쪽 걸러 보기: 답변 대기(처음) · 답변 완료 · 숨김 · 기업 문의. 답을 저장하면 다음 대기 질문으로 넘어간다
const VIEWS = [
  ['waiting', '답변 대기', (q) => !q.answer && !q.hidden],
  ['answered', '답변 완료', (q) => q.answer && !q.hidden],
  ['hidden', '숨김', (q) => q.hidden],
]

function QuestionView({ q, onSave, onBack }) {
  const [answer, setAnswer] = useState(q.answer ?? '')
  const [editing, setEditing] = useState(!q.answer)
  return (
    <article className="mail-view" aria-label="문의 내용">
      <button type="button" className="link mail-back" onClick={onBack}>← 목록</button>
      <p className="mail-meta">
        <b>{q.product_name}</b>
        <span>{q.author} · {when(q.created_at)}</span>
        {q.contact && <span>연락처 {q.contact}</span>}
        {q.is_private && <span className="chip chip-gray">비밀글</span>}
        {q.hidden && <span className="chip chip-gray">숨김</span>}
      </p>
      <div className="mail-q"><strong>Q.</strong> {q.question}</div>
      {editing ? (
        <div className="form mail-answer">
          <label htmlFor={`answer-${q.id}`}>답변</label>
          <textarea id={`answer-${q.id}`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={6} maxLength={1000} placeholder="상품 정보에 있는 내용으로 답해 주세요. 효능 표현은 쓰지 않아요." />
          <div className="actions">
            {q.answer && <button type="button" className="button ghost" onClick={() => { setAnswer(q.answer); setEditing(false) }}>취소</button>}
            <button type="button" className="button" disabled={!answer.trim()} onClick={() => onSave({ answer }, '답변을 올렸어요')}>답변 저장</button>
          </div>
        </div>
      ) : (
        <div className="mail-a"><strong>A.</strong> {q.answer} <span className="muted">({when(q.answered_at)})</span></div>
      )}
      <div className="row-actions mail-tools">
        {!editing && <button type="button" onClick={() => setEditing(true)}>답변 고치기</button>}
        <button type="button" onClick={() => onSave({ hidden: !q.hidden }, q.hidden ? '다시 보이게 했어요' : '소비자 화면에서 숨겼어요')}>{q.hidden ? '다시 보이기' : '숨기기'}</button>
      </div>
    </article>
  )
}

export function Inbox({ onCount }) {
  const [questions, setQuestions] = useState(null)
  const [inquiries, setInquiries] = useState(null)
  const [view, setView] = useState('waiting')
  const [openId, setOpenId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([adminApi('/inquiries/questions'), adminApi('/inquiries/b2b-inquiries')])
      .then(([q, b]) => { setQuestions(q); setInquiries(b) })
      .catch((e) => setError(e.message))
  }, [])

  const filter = VIEWS.find(([key]) => key === view)?.[2]
  const list = filter && questions ? questions.filter(filter) : []
  const paging = usePage(list, 20, view)

  function done(text) {
    setMessage(text)
    setError('')
    adminApi('/inquiries/summary').then(onCount).catch(() => {})
  }
  const replace = (rows, row) => rows.map((x) => (x.id === row.id ? { ...x, ...row } : x))

  async function saveQuestion(q, body, text) {
    try {
      const row = await adminApi(`/inquiries/questions/${q.id}`, { method: 'PATCH', body })
      const next = questions.map((x) => (x.id === row.id ? { ...x, ...row } : x))
      setQuestions(next)
      // 답한 질문은 목록에서 빠지니, 같은 목록의 다음 질문을 바로 연다 (없으면 닫음)
      const rest = filter ? next.filter(filter) : []
      const stays = rest.some((x) => x.id === q.id)
      if (!stays) {
        const at = list.findIndex((x) => x.id === q.id)
        setOpenId(rest[Math.min(at, rest.length - 1)]?.id ?? null)
      }
      done(text)
    } catch (e) {
      setError(e.message)
    }
  }

  if (!questions || !inquiries) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  const opened = list.find((q) => q.id === openId) ?? null
  const newB2b = inquiries.filter((b) => b.status === '접수').length
  const tabs = [
    ...VIEWS.map(([key, label, f]) => ({ key, label, count: questions.filter(f).length })),
    { key: 'b2b', label: '기업 구매 문의', count: newB2b },
  ]

  return (
    <section className="inbox2">
      <FilterChips items={tabs} value={view} onChange={(key) => { setView(key); setOpenId(null); setMessage('') }} />
      {message && <p className="success" role="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      {view === 'b2b' ? (
        inquiries.length === 0 ? <p className="muted">아직 기업 구매 문의가 없어요.</p> : (
          <table className="table">
            <thead><tr><th>회사·연락처</th><th>상품·수량</th><th>요청사항</th><th>받은 때</th><th>상태</th></tr></thead>
            <tbody>
              {inquiries.map((b) => (
                <B2bRow key={b.id} b={b} onError={setError} onSaved={(row, text) => { setInquiries((rows) => replace(rows, row)); done(text) }} />
              ))}
            </tbody>
          </table>
        )
      ) : list.length === 0 ? (
        <p className="todo-clear">{view === 'waiting' ? '답변을 기다리는 질문이 없어요.' : '해당하는 질문이 없어요.'}</p>
      ) : (
        <div className={`mailbox${opened ? ' reading' : ''}`}>
          <div className="mail-list-wrap">
            <ul className="mail-list">
              {paging.rows.map((q) => (
                <li key={q.id}>
                  <button type="button" className={q.id === openId ? 'on' : ''} aria-current={q.id === openId ? 'true' : undefined} onClick={() => setOpenId(q.id)}>
                    <span className="mail-top">
                      {!q.answer && !q.hidden && <i className="mail-dot" aria-label="답변 대기" />}
                      <b>{q.product_name}</b>
                      <time>{when(q.created_at)}</time>
                    </span>
                    <span className="mail-line">{q.question}</span>
                    <span className="mail-sub">{q.author}{q.is_private ? ' · 비밀글' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pager paging={paging} />
          </div>
          {opened
            ? <QuestionView key={opened.id} q={opened} onBack={() => setOpenId(null)} onSave={(body, text) => saveQuestion(opened, body, text)} />
            : <div className="mail-empty">왼쪽에서 질문을 고르면 여기서 읽고 답할 수 있어요.</div>}
        </div>
      )}
    </section>
  )
}
