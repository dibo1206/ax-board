import { useEffect, useState } from 'react'
import { get, post, when } from './shared.js'

// 구매 후기: 별점 표시 · 상품 상세의 후기 목록 · 배송 완료 주문의 후기 쓰기
export function Stars({ value, size = '' }) {
  const full = Math.round(value ?? 0)
  return <span className={`stars ${size}`} aria-label={`별점 ${value ?? 0}점`}>{'★'.repeat(full)}<span className="off">{'★'.repeat(5 - full)}</span></span>
}

export function RatingBadge({ rating, count }) {
  if (!count) return null
  return <span className="rating"><Stars value={rating} /> {rating} <span className="muted">({count})</span></span>
}

export function ReviewList({ code }) {
  const [data, setData] = useState(null)
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)

  useEffect(() => {
    get(`/products/${code}/reviews?page=${page}`).then((d) => {
      setData(d)
      setItems((prev) => (page === 1 ? d.items : [...prev, ...d.items]))
    }).catch(() => setData({ count: 0, items: [] }))
  }, [code, page])

  if (!data) return null
  return (
    <section className="box">
      <h3>구매 후기 {data.count}개 {data.count > 0 && <span className="rating"><Stars value={data.avg} /> {data.avg}</span>}</h3>
      {data.count === 0 ? <p className="muted">아직 후기가 없어요. 받아 보신 뒤 주문 조회·마이페이지에서 남길 수 있어요.</p> : (
        <>
          <ul className="reviews">
            {items.map((r) => (
              <li key={r.id}>
                <p><Stars value={r.rating} /> <span className="muted">{r.author} · {when(r.created_at)}</span></p>
                <p>{r.content}</p>
                {r.reply && <p className="reply">판매자 답글: {r.reply}</p>}
              </li>
            ))}
          </ul>
          {items.length < data.count && <button type="button" className="button ghost" onClick={() => setPage((p) => p + 1)}>후기 더 보기</button>}
        </>
      )}
    </section>
  )
}

export function ReviewForm({ orderNo, phone, item, onDone }) {
  const [rating, setRating] = useState(5)
  const [content, setContent] = useState('')
  const [errors, setErrors] = useState([])
  const [sending, setSending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSending(true)
    try {
      await post('/reviews', { orderNo, phone, productCode: item.product_code, rating, content })
      onDone()
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="form review-form" onSubmit={submit}>
      <div className="star-pick" role="radiogroup" aria-label="별점">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n}점`}>★</button>
        ))}
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} maxLength={1000} placeholder="맛·신선도·포장처럼 직접 느낀 점을 10자 이상 적어 주세요" />
      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <button type="submit" className="button" disabled={sending}>후기 남기기</button>
    </form>
  )
}
