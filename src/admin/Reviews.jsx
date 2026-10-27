import { useEffect, useState } from 'react'
import { Stars } from '../shop/Reviews.jsx'
import { when } from '../shop/shared.js'
import { adminApi } from './api.js'

// 관리자 후기 관리: 답글 달기 · 숨기기 (욕설·광고·개인정보가 있는 후기)
function ReviewRow({ review, onSaved, onError }) {
  const [reply, setReply] = useState(review.reply ?? '')
  const [open, setOpen] = useState(!review.reply)

  async function save(body) {
    try {
      onSaved(await adminApi(`/reviews/${review.id}`, { method: 'PATCH', body }))
      setOpen(false)
    } catch (e) {
      onError(e.message)
    }
  }

  return (
    <li className={`box${review.hidden ? ' dim' : ''}`}>
      <p className="muted">{review.product_name} · {review.author} · {review.order_no} · {when(review.created_at)}{review.hidden && ' · 숨김'}</p>
      <p><Stars value={review.rating} /> {review.content}</p>
      {open ? (
        <div className="form">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={1000} placeholder="판매자 답글 (효능 표현은 쓰지 않아요)" />
          <button type="button" className="button" onClick={() => save({ reply })}>답글 저장</button>
        </div>
      ) : review.reply && <p className="reply">답글: {review.reply}</p>}
      <div className="row-actions">
        {!open && <button type="button" onClick={() => setOpen(true)}>답글 {review.reply ? '고치기' : '달기'}</button>}
        <button type="button" onClick={() => save({ hidden: !review.hidden })}>{review.hidden ? '다시 보이기' : '숨기기'}</button>
      </div>
    </li>
  )
}

export function AdminReviews() {
  const [reviews, setReviews] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    adminApi('/reviews').then(setReviews).catch((e) => setError(e.message))
  }, [])
  if (error) return <p className="error">{error}</p>
  if (!reviews) return <p className="muted">불러오는 중…</p>
  if (!reviews.length) return <p className="muted">아직 후기가 없어요.</p>
  return (
    <ul className="inbox">
      {reviews.map((r) => (
        <ReviewRow key={r.id} review={r} onError={setError} onSaved={(row) => setReviews((list) => list.map((x) => (x.id === row.id ? { ...x, ...row } : x)))} />
      ))}
    </ul>
  )
}
