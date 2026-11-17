import { useCallback, useEffect, useState } from 'react'
import { RETURN_STATUS, when, won } from '../shop/shared.js'
import { adminApi } from './api.js'

// 관리자 반품 처리: 신청 → 승인 / 거절(사유는 손님에게 보임) → 승인한 신청만 금액을 확인하고 [환불] (토스 부분 취소)
// 환불 한도는 서버가 주문 기록과 교환·환불 정책으로 계산한 값. 판매자 의견은 참고용 (판매자는 환불을 못 한다)
const FILTERS = [['requested', '신청'], ['approved', '승인 (환불 대기)'], ['refunded', '환불 완료'], ['rejected', '거절'], ['', '전체']]
const REASONS = { change_mind: '단순 변심', defect: '상품 하자·파손·표시와 다름', wrong_item: '오배송' }

function ReturnRow({ ret, onDone, onError }) {
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState(ret.refund_pending ? String(ret.refund_pending) : '')
  const [busy, setBusy] = useState(false)

  async function act(path, body, text) {
    setBusy(true)
    onError('')
    try {
      await adminApi(`/returns/${ret.id}/${path}`, { method: 'POST', body })
      onDone(text)
    } catch (e) {
      onError(e.message)
      if (e.pending) onDone('')
    } finally {
      setBusy(false)
    }
  }

  function refund() {
    const n = Number(amount)
    if (!Number.isInteger(n) || n < 1) return onError('돌려줄 금액을 원 단위 숫자로 넣어 주세요.')
    if (!ret.refund_pending && !window.confirm(`${ret.order_no} 반품 #${ret.id}: ${won(n)}을 손님 결제에서 바로 취소해요. 되돌릴 수 없어요.`)) return
    act('refund', { amount: n }, `반품 #${ret.id}: ${won(n)}을 환불했어요`)
  }

  const items = ret.items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  return (
    <li className="box">
      <p><b>#{ret.id}</b> · {ret.order_no} · {ret.seller_name} · <b>{RETURN_STATUS[ret.status]}</b> · 신청 {when(ret.created_at)} ({ret.requested_by})</p>
      <p>{REASONS[ret.reason_type]} · {ret.reason}</p>
      {ret.photos?.length > 0 && (
        <div className="return-photos">
          {ret.photos.map((_, n) => <a key={n} href={`/api/admin/returns/${ret.id}/photos/${n}`} target="_blank" rel="noreferrer"><img src={`/api/admin/returns/${ret.id}/photos/${n}`} alt={`반품 사진 ${n + 1}`} loading="lazy" /></a>)}
        </div>
      )}
      <ul>{ret.items.map((i) => <li key={i.item_id}>{i.name}{i.option_name && ` · ${i.option_name}`} × {i.quantity} — {won(i.price * i.quantity)}</li>)}</ul>
      <p className="muted">주문자 {ret.buyer_name} · 받은 날 {when(ret.delivered_at)} · 돌려보낼 상품 {won(items)} · 이 농가 배송 상품 {won(ret.items_amount)} + 배송비 {won(ret.shipping_fee)}</p>
      {ret.seller_note && <p>판매자 의견: {ret.seller_note} <span className="muted">({when(ret.seller_noted_at)})</span></p>}
      {ret.decided_by && <p className="muted">{RETURN_STATUS[ret.status === 'refunded' ? 'approved' : ret.status]} · {ret.decided_by} · {when(ret.decided_at)}{ret.admin_note && ` · ${ret.admin_note}`}</p>}
      {ret.status === 'refunded' && <p className="success">{won(ret.refund_amount)} 환불 · {ret.refunded_by} · {when(ret.refunded_at)}</p>}
      {ret.status === 'requested' && (
        <div className="row form">
          <label>메모·거절 사유 (손님에게 보여요)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
          <button type="button" className="button" disabled={busy} onClick={() => act('approve', { note }, `반품 #${ret.id}을 승인했어요`)}>승인</button>
          <button type="button" className="button ghost" disabled={busy || note.trim().length < 2} onClick={() => act('reject', { note }, `반품 #${ret.id}을 거절했어요`)}>거절</button>
        </div>
      )}
      {ret.status === 'approved' && (
        <div className="row form">
          <label>환불 금액 (한도 {won(ret.refund_limit)})
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" disabled={Boolean(ret.refund_pending)} placeholder={String(ret.refund_limit)} />
          </label>
          <button type="button" className="button" disabled={busy || !ret.refund_limit} onClick={refund}>{ret.refund_pending ? '환불 결과 다시 확인' : '환불 (결제 취소)'}</button>
          {!ret.refund_pending && (
            <>
              <label>거절 사유<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
              <button type="button" className="button ghost" disabled={busy || note.trim().length < 2} onClick={() => act('reject', { note }, `반품 #${ret.id}을 거절했어요`)}>거절</button>
            </>
          )}
        </div>
      )}
      {ret.status === 'approved' && ret.refund_pending && <p className="warn">{won(ret.refund_pending)} 환불의 결제 취소 결과를 확인하고 있어요. 같은 금액으로 다시 확인해요 (돈은 한 번만 나가요).</p>}
      {ret.status === 'approved' && !ret.refund_limit && <p className="muted">교환·환불 정책으로 계산한 환불 한도가 0원이에요 (예: 단순 변심인데 왕복 배송비가 상품 금액보다 많음).</p>}
    </li>
  )
}

export function Returns() {
  const [status, setStatus] = useState('requested')
  const [list, setList] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    adminApi(`/returns${status ? `?status=${status}` : ''}`).then(setList).catch((e) => setError(e.message))
  }, [status])
  useEffect(load, [load])

  return (
    <section>
      <p className="muted">신청만으로는 돈이 나가지 않아요. 승인한 뒤 돌려받은 상품을 확인하고, 금액을 넣어 [환불]을 눌러야 결제가 취소돼요.</p>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <nav className="tabs">
        {FILTERS.map(([value, label]) => <button key={label} type="button" className={status === value ? 'on' : ''} onClick={() => { setStatus(value); setMessage('') }}>{label}</button>)}
      </nav>
      {!list ? <p className="muted">불러오는 중…</p> : list.length === 0 ? <p className="muted">반품 신청이 없어요.</p> : (
        <ul className="inbox">
          {list.map((ret) => <ReturnRow key={ret.id} ret={ret} onError={setError} onDone={(text) => { setMessage(text); load() }} />)}
        </ul>
      )}
    </section>
  )
}
