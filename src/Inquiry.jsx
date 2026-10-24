import { useState } from 'react'
import { netFetch } from './net.js'

// 4단계: 손님이 남기는 상품 질문과 기업(B2B) 구매 문의 폼
async function post(path, body) {
  const response = await netFetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `요청이 실패했어요 (${response.status})`)
    error.errors = data.errors
    throw error
  }
  return data
}

function useForm(initial) {
  const [form, setForm] = useState(initial)
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  return [form, set, () => setForm(initial)]
}

const PRIVACY = '연락처는 답변·견적 안내에만 쓰고, 공개 화면에는 보이지 않아요.'

export function QuestionForm({ productCode, onSent }) {
  const [form, set, reset] = useForm({ author: '', question: '', contact: '', privacyAgreed: false })
  const [errors, setErrors] = useState([])
  const [sending, setSending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSending(true)
    setErrors([])
    try {
      const saved = await post(`/products/${productCode}/questions`, form)
      reset()
      onSent(saved)
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>이름(별명)* <span className="muted">화면에는 첫 글자만 보여요</span>
        <input value={form.author} onChange={set('author')} maxLength={20} />
      </label>
      <label>질문*<textarea value={form.question} onChange={set('question')} maxLength={500} rows={3} placeholder="보관 방법, 배송, 선물 포장 등 궁금한 점을 적어 주세요" /></label>
      <label>연락처 <span className="muted">(선택) 답변 알림을 받고 싶을 때만</span>
        <input value={form.contact} onChange={set('contact')} placeholder="010-1234-5678 또는 이메일" />
      </label>
      {form.contact && (
        <label className="check"><input type="checkbox" checked={form.privacyAgreed} onChange={set('privacyAgreed')} />개인정보 수집에 동의해요. <span className="muted">{PRIVACY}</span></label>
      )}
      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <button type="submit" className="button" disabled={sending}>{sending ? '보내는 중…' : '질문 남기기'}</button>
    </form>
  )
}

export function B2bForm({ product, onClose }) {
  const [form, set] = useForm({ company: '', contactName: '', contact: '', quantity: '', message: '', privacyAgreed: false })
  const [errors, setErrors] = useState([])
  const [done, setDone] = useState('')
  const [sending, setSending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSending(true)
    setErrors([])
    try {
      const result = await post('/b2b-inquiries', { ...form, productCode: product.product_code })
      setDone(result.message)
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="box">
        <p className="success">{done}</p>
        <button type="button" className="button ghost" onClick={onClose}>닫기</button>
      </div>
    )
  }

  return (
    <form className="box form" onSubmit={submit}>
      <h3>기업 구매 문의 · {product.name}</h3>
      <p className="muted">카페·식당·매장 대량 구매나 정기 납품 견적을 받아 보세요. 담당자가 확인 후 연락드립니다.</p>
      <div className="row">
        <label>회사·매장 이름*<input value={form.company} onChange={set('company')} maxLength={50} /></label>
        <label>담당자 이름*<input value={form.contactName} onChange={set('contactName')} maxLength={20} /></label>
      </div>
      <div className="row">
        <label>연락처*<input value={form.contact} onChange={set('contact')} placeholder="010-1234-5678 또는 이메일" /></label>
        <label>희망 수량 <span className="muted">({product.unit} 기준)</span><input value={form.quantity} onChange={set('quantity')} inputMode="numeric" /></label>
      </div>
      <label>요청사항<textarea value={form.message} onChange={set('message')} maxLength={1000} rows={3} placeholder="납품 주기, 희망 날짜, 포장 방식 등" /></label>
      <label className="check"><input type="checkbox" checked={form.privacyAgreed} onChange={set('privacyAgreed')} />개인정보 수집에 동의해요.* <span className="muted">{PRIVACY}</span></label>
      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="actions">
        <button type="button" className="button ghost" onClick={onClose} disabled={sending}>취소</button>
        <button type="submit" className="button" disabled={sending}>{sending ? '보내는 중…' : '견적 문의 보내기'}</button>
      </div>
    </form>
  )
}
