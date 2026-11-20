// 찜(하트)·단골 맺기 버튼 (2026-11-20). 회원만 쓴다. 목록·담기·빼기는 savedStore.js
import { useEffect, useState } from 'react'
import { getSaved, toggle, useSaved } from './savedStore.js'

const HEART = 'M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.9 1.3-1.8 2.8-2.9 4.8-2.9 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z'

// 하트 버튼 (상품 카드·상품 상세). variant: 'card'(사진 위 동그라미) | 'detail'(글자와 함께)
export function WishButton({ code, name, variant = 'card' }) {
  const on = useSaved('products', code)
  const [busy, setBusy] = useState(false)
  const label = on ? `${name} 찜 빼기` : `${name} 찜하기`
  async function click(event) {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    setBusy(true)
    await toggle('products', code)
    setBusy(false)
  }
  return (
    <button type="button" className={`wish-btn wish-${variant}${on ? ' on' : ''}`} aria-pressed={on} aria-label={label} title={on ? '찜 빼기' : '찜하기'} onClick={click} disabled={busy}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={HEART} /></svg>
      {variant === 'detail' && <span>{on ? '찜했어요' : '찜하기'}</span>}
    </button>
  )
}

// 단골 맺기 버튼 (농가 페이지·마이페이지). count 는 서버가 준 단골 수 (15초 캐시라 누른 만큼 화면에서 더하고 뺀다)
export function FollowButton({ code, name, count = null }) {
  const on = useSaved('farms', code)
  const [busy, setBusy] = useState(false)
  const [first, setFirst] = useState(null) // 처음 그렸을 때 켜져 있었는지 (단골 수 보정용)
  useEffect(() => { getSaved().then((s) => setFirst(Boolean(s?.farms.has(code)))) }, [code])
  const shown = count == null ? null : Math.max(0, count + (first === null ? 0 : Number(on) - Number(first)))
  async function click() {
    if (busy) return
    setBusy(true)
    await toggle('farms', code)
    setBusy(false)
  }
  return (
    <button type="button" className={`follow-btn${on ? ' on' : ''}`} aria-pressed={on} onClick={click} disabled={busy}
      aria-label={on ? `${name} 단골 끊기` : `${name} 단골 맺기`}>
      {on ? '✓ 단골 농가' : '+ 단골 맺기'}
      {shown != null && <span className="follow-count">단골 {shown.toLocaleString('ko-KR')}명</span>}
    </button>
  )
}
