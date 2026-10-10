import { useState } from 'react'
import { FARM } from '../data/guides.js'
import { saveInquiry } from '../utils/storage.js'

const EMPTY = { name: '', phone: '', quantity: 1 }

function validate(form) {
  const errors = {}
  if (!form.name.trim()) errors.name = '이름을 입력해 주세요.'
  if (!/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(form.phone.trim())) errors.phone = '연락처를 010-1234-5678 형식으로 입력해 주세요.'
  if (!(Number(form.quantity) >= 1)) errors.quantity = '수량은 1 이상이어야 해요.'
  return errors
}

export default function InquiryForm({ product, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(false)

  if (product.soldOut) {
    return (
      <section className="info-card inquiry">
        <h3>주문 문의</h3>
        <p className="notice notice-warn">
          지금은 품절된 상품이에요. 입고 일정은 농가({FARM.phone})로 문의해 주세요.
        </p>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          닫기
        </button>
      </section>
    )
  }

  if (done) {
    return (
      <section className="info-card inquiry">
        <h3>주문 문의</h3>
        <p className="notice notice-ok">문의가 접수되었어요. 농가에서 곧 연락드릴게요.</p>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          닫기
        </button>
      </section>
    )
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    saveInquiry({
      productId: product.id,
      name: form.name.trim(),
      phone: form.phone.trim(),
      quantity: Number(form.quantity),
    })
    setDone(true)
  }

  return (
    <form className="info-card inquiry" onSubmit={handleSubmit} noValidate>
      <h3>주문 문의 — {product.name}</h3>
      <label className="field">
        <span>이름</span>
        <input value={form.name} onChange={(e) => update('name', e.target.value)} autoComplete="name" />
        {errors.name && <small className="field-error">{errors.name}</small>}
      </label>
      <label className="field">
        <span>연락처</span>
        <input
          type="tel"
          inputMode="tel"
          placeholder="010-1234-5678"
          value={form.phone}
          onChange={(e) => update('phone', e.target.value)}
          autoComplete="tel"
        />
        {errors.phone && <small className="field-error">{errors.phone}</small>}
      </label>
      <label className="field">
        <span>수량 ({product.unit})</span>
        <input
          type="number"
          min="1"
          inputMode="numeric"
          value={form.quantity}
          onChange={(e) => update('quantity', e.target.value)}
        />
        {errors.quantity && <small className="field-error">{errors.quantity}</small>}
      </label>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          취소
        </button>
        <button type="submit" className="btn btn-primary">
          문의 보내기
        </button>
      </div>
    </form>
  )
}
