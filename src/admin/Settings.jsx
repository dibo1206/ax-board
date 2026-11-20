import { useEffect, useState } from 'react'
import { adminApi } from './api.js'
import { dayLabel, deliveryPlan } from '../shop/delivery.js'

// 관리자 [쇼핑몰 설정] (server/settings.js): 사업자 정보 · 배송 · 반품 · 알림 메일 · 약관·정책 글.
// 저장하면 주문 금액 계산, 반품 기간 검사, 상담 답, 손님 화면(아래쪽 사업자 정보·정책 글·회사 소개 오시는 길)이 바로 새 값을 써요
const PARTS = [['shop', '사업자 정보'], ['shipping', '배송'], ['returns', '반품'], ['settlement', '정산·수수료'], ['notify', '알림 메일'], ['policies', '약관·정책 글']]
const ccText = (cc) => (typeof cc === 'string' ? cc : (cc ?? []).join('\n'))
const SHOP_FIELDS = [
  ['name', '쇼핑몰 이름', 40], ['company', '회사 이름', 40], ['ceo', '대표자', 20], ['bizNo', '사업자등록번호 (000-00-00000)', 12],
  ['mailOrderNo', '통신판매업 신고번호', 40], ['address', '주소', 120], ['phone', '대표전화', 20], ['email', '이메일', 100],
  ['hours', '업무 시간', 80], ['privacyOfficer', '개인정보 보호책임자 (이름·연락처)', 80],
]
const POLICY_NAMES = { refund: '교환·환불 정책', terms: '이용약관', privacy: '개인정보 처리방침', noemail: '이메일무단수집거부' }
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const listText = (v) => (typeof v === 'string' ? v : (v ?? []).join('\n'))
// 배송 달력 미리보기: 입력 중인 글자 값을 숫자로 바꿔 계산한다
const previewPlan = (s) => deliveryPlan({
  ...s, cutoffHour: Number(s.cutoffHour), leadDays: Number(s.leadDays), transitDays: Number(s.transitDays),
  holidays: listText(s.holidays).split(/[\s,;]+/).filter(Boolean),
})

export function Settings() {
  const [data, setData] = useState(null)
  const [part, setPart] = useState(() => {
    const k = new URLSearchParams(window.location.search).get('part')
    return PARTS.some(([key]) => key === k) ? k : 'shop'
  })
  const [draft, setDraft] = useState(null)
  const [kind, setKind] = useState('refund')
  const [errors, setErrors] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    adminApi('/settings').then((d) => { setData(d); setDraft(structuredClone(d.current)) }).catch((e) => setErrors([e.message]))
  }, [])
  if (!data || !draft) return errors.length ? <p className="error">{errors[0]}</p> : <p className="muted">불러오는 중…</p>

  const put = (key, patch) => setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }))
  const open = (key) => { setPart(key); setErrors([]); setMessage('') }

  async function save() {
    if (part === 'shipping' && !window.confirm(`배송비 ${won(draft.shipping.fee)}, ${won(draft.shipping.freeOver)} 이상 무료로 저장할까요? 저장한 뒤 들어오는 주문부터 바로 적용돼요.`)) return
    if (part === 'settlement' && !window.confirm(`기본 수수료율을 ${draft.settlement.commissionRate}%로 저장할까요? 저장한 뒤 들어오는 주문부터 적용되고, 이미 들어온 주문의 정산은 그대로예요.`)) return
    setBusy(true); setErrors([]); setMessage('')
    try {
      const { current } = await adminApi(`/settings/${part}`, { method: 'PUT', body: draft[part] })
      setData((d) => ({ ...d, current, saved: { ...d.saved, [part]: { updated_at: new Date().toISOString(), updated_by: '나' } } }))
      setDraft((d) => ({ ...d, [part]: structuredClone(current[part]) }))
      setMessage('저장했어요. 손님 화면·주문·상담에 바로 적용돼요.')
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!window.confirm('이 칸을 처음(코드에 적힌) 값으로 되돌릴까요? 저장한 내용은 지워져요.')) return
    try {
      const { current } = await adminApi(`/settings/${part}`, { method: 'DELETE' })
      setData((d) => { const saved = { ...d.saved }; delete saved[part]; return { ...d, current, saved } })
      setDraft((d) => ({ ...d, [part]: structuredClone(current[part]) }))
      setMessage('처음 값으로 되돌렸어요.')
    } catch (e) {
      setErrors([e.message])
    }
  }

  const saved = data.saved[part]
  const policy = draft.policies[kind]
  const setSections = (sections) => setDraft((d) => ({ ...d, policies: { ...d.policies, [kind]: { ...d.policies[kind], sections } } }))
  return (
    <section className="site-editor">
      <div className="admin-head">
        <h2>쇼핑몰 설정</h2>
        <a className="button ghost" href="/policy/refund" target="_blank" rel="noreferrer">정책 글 보기 ↗</a>
      </div>
      <p className="muted">사업자 정보·배송비·반품 기간·약관을 고쳐요. 저장하면 주문 금액 계산, 반품 신청 기간, 상담 답, 손님 화면 아래쪽 사업자 정보와 정책 글이 함께 바뀌어요.</p>
      <nav className="tabs">
        {PARTS.map(([key, label]) => <button key={key} type="button" className={key === part ? 'on' : ''} onClick={() => open(key)}>{label}{data.saved[key] && ' · 고침'}</button>)}
      </nav>
      <p className="muted">{saved ? `마지막 저장: ${new Date(saved.updated_at).toLocaleString('ko-KR')} · ${saved.updated_by}` : '지금은 처음(코드에 적힌) 값이에요.'}</p>

      <div className="box form">
        {part === 'shop' && (
          <>
            <p className="muted">손님 화면 아래쪽, 상품 정보 고시(상담 전화), 회사 소개의 오시는 길, 알림 메일 제목에 쓰여요.</p>
            {SHOP_FIELDS.map(([key, label, max]) => (
              <label key={key}>{label}<em className="req">*</em><input value={draft.shop[key]} maxLength={max} onChange={(e) => put('shop', { [key]: e.target.value })} /></label>
            ))}
            {/* 판매 방식 (2026-11-20) [회사·법률 확인 필요]: 중개면 농가 상품 상세의 [판매자 정보] 밑에 고지가 나온다 */}
            <fieldset className="choice">
              <legend>판매 방식 <span className="muted">[회사·법률 확인 필요]</span></legend>
              <label><input type="radio" name="saleMode" checked={draft.shop.saleMode !== 'direct'} onChange={() => put('shop', { saleMode: 'broker' })} /> 중개 (농가가 판매자, 회사는 통신판매중개자)</label>
              <label><input type="radio" name="saleMode" checked={draft.shop.saleMode === 'direct'} onChange={() => put('shop', { saleMode: 'direct' })} /> 직판 (회사가 사서 직접 판매)</label>
            </fieldset>
            {draft.shop.saleMode !== 'direct' && (
              <label>통신판매중개자 고지 (농가 상품 상세에 나와요. {'{회사}'}·{'{쇼핑몰}'}은 위 값으로 바뀌어요)<em className="req">*</em>
                <textarea rows={3} maxLength={400} value={draft.shop.brokerNotice ?? ''} onChange={(e) => put('shop', { brokerNotice: e.target.value })} />
              </label>
            )}
          </>
        )}

        {part === 'shipping' && (
          <>
            <div className="row">
              <label>배송비 (원, 주문 한 번에)<em className="req">*</em><input inputMode="numeric" value={draft.shipping.fee} onChange={(e) => put('shipping', { fee: e.target.value.replace(/\D/g, '') })} /></label>
              <label>무료 배송 기준 (원, 주문 상품 합계)<em className="req">*</em><input inputMode="numeric" value={draft.shipping.freeOver} onChange={(e) => put('shipping', { freeOver: e.target.value.replace(/\D/g, '') })} /></label>
            </div>
            <p className="muted">지금 입력: 주문 한 번에 {won(draft.shipping.fee)}, 상품 합계가 {won(draft.shipping.freeOver)} 이상이면 무료. 여러 농가 상품을 함께 사도 한 번만 받고, 받은 배송비는 상품 금액 비율로 농가 몫을 나눠 정산해요. 상품 화면의 [1개만 사도 무료배송]도 이 기준을 써요.</p>
            <label>택배사<em className="req">*</em><input value={draft.shipping.courier} maxLength={30} onChange={(e) => put('shipping', { courier: e.target.value })} /></label>
            <label>출고 안내<em className="req">*</em><input value={draft.shipping.leadTime} maxLength={80} onChange={(e) => put('shipping', { leadTime: e.target.value })} /></label>

            {/* 배송 달력 (2026-11-20): 상품 상세의 "지금 주문하면 ○일 출고 · ○일 도착 예정" 계산 */}
            <h3>배송 달력</h3>
            <p className="muted">상품 화면에 "지금 주문하면 ○일 출고 · ○일 도착 예정"과 소비기한 날짜를 보여 줄 때 써요. 실제 출고 일정과 맞게 적어 주세요.</p>
            <div className="row">
              <label>주문 마감 (시, 0~24)<em className="req">*</em><input inputMode="numeric" value={draft.shipping.cutoffHour ?? ''} onChange={(e) => put('shipping', { cutoffHour: e.target.value.replace(/\D/g, '') })} /></label>
              <label>주문일부터 출고까지 (출고일 수, 0이면 당일)<em className="req">*</em><input inputMode="numeric" value={draft.shipping.leadDays ?? ''} onChange={(e) => put('shipping', { leadDays: e.target.value.replace(/\D/g, '') })} /></label>
              <label>출고 뒤 도착까지 (일)<em className="req">*</em><input inputMode="numeric" value={draft.shipping.transitDays ?? ''} onChange={(e) => put('shipping', { transitDays: e.target.value.replace(/\D/g, '') })} /></label>
            </div>
            <fieldset className="choice">
              <legend>출고하지 않는 요일</legend>
              {WEEKDAYS.map((name, d) => (
                <label key={name} className="inline"><input type="checkbox" checked={(draft.shipping.noShipDays ?? []).includes(d)}
                  onChange={(e) => put('shipping', { noShipDays: e.target.checked ? [...(draft.shipping.noShipDays ?? []), d].sort() : (draft.shipping.noShipDays ?? []).filter((x) => x !== d) })} /> {name}</label>
              ))}
            </fieldset>
            <label>쉬는 날 (공휴일·명절 휴무, 한 줄에 하나씩 2026-12-25 모양)
              <textarea rows={4} value={listText(draft.shipping.holidays)} onChange={(e) => put('shipping', { holidays: e.target.value })} />
            </label>
            {(() => {
              try {
                const plan = previewPlan(draft.shipping)
                return <p className="muted">미리보기: 지금 주문하면 {dayLabel(plan.shipDate)} 출고 → {dayLabel(plan.arriveDate)} 도착 예정</p>
              } catch {
                return null
              }
            })()}
          </>
        )}

        {part === 'settlement' && (
          <>
            <p className="muted">농가 상품 판매액에서 회사가 떼는 비율이에요. 판매자 화면의 정산 금액은 <b>상품 판매액 − 수수료 + 배송비 몫 − 반품 환불</b>로 계산돼요.</p>
            <label>기본 수수료율 (%, 0~50, 소수점 한 자리까지)<em className="req">*</em>
              <input inputMode="decimal" value={draft.settlement.commissionRate} onChange={(e) => put('settlement', { commissionRate: e.target.value.replace(/[^\d.]/g, '') })} />
            </label>
            <p className="muted">예: {draft.settlement.commissionRate || 0}%이면 상품 100,000원이 팔렸을 때 수수료 {won(Math.round(100000 * Number(draft.settlement.commissionRate || 0) / 100))}, 농가 몫 {won(100000 - Math.round(100000 * Number(draft.settlement.commissionRate || 0) / 100))}.</p>
            <ul className="muted">
              <li>저장한 뒤 들어오는 주문부터 적용돼요. 주문할 때의 수수료율을 주문마다 적어 두기 때문에, 나중에 바꿔도 이미 들어온 주문의 정산은 바뀌지 않아요. (이 기능 전에 들어온 주문은 0%)</li>
              <li>배송비 몫에는 수수료를 붙이지 않아요. 반품으로 돌려준 금액에 붙었던 수수료는 정산에서 다시 빼 줘요.</li>
              <li>농가마다 다르게 하려면 [판매자 관리]에서 농가별 수수료율을 정해요. 회사 직영은 따로 정하지 않으면 0%예요.</li>
              <li>결제 대행사(토스) 수수료는 여기 들어가지 않아요. 회사와 결제 대행사 사이에서 따로 정산돼요.</li>
            </ul>
          </>
        )}

        {part === 'returns' && (
          <>
            <p className="muted">반품 신청 화면이 이 기준으로 신청을 받거나 막아요. 법(전자상거래법)보다 짧게는 정할 수 없어요: 단순 변심 7일, 하자 3개월·안 날부터 30일.</p>
            <label className="check">
              <input type="checkbox" checked={draft.returns.changeMind} onChange={(e) => put('returns', { changeMind: e.target.checked })} />
              단순 변심 반품 받기
            </label>
            <p className="muted">
              {draft.returns.changeMind
                ? '켜져 있어요: 손님이 받은 날부터 아래 기간 안에 단순 변심 반품을 신청할 수 있어요 (왕복 배송비는 손님 부담).'
                : '꺼져 있어요: 음료·식품이라 단순 변심 반품은 받지 않고, 파손·하자·오배송만 받아요. 정책 글에도 그렇게 나와요.'}
              {' '}단순 변심을 막는 것은 법률 확인이 필요해요. 법은 7일 청약철회가 원칙이고, 신선식품처럼 다시 팔기 어렵거나 뜯어서 가치가 떨어진 경우 등을 미리 알렸을 때만 막을 수 있어요.
            </p>
            <div className="row">
              <label>단순 변심 (받은 날부터 며칠)<input type="number" min={7} max={60} value={draft.returns.changeMindDays} disabled={!draft.returns.changeMind} onChange={(e) => put('returns', { changeMindDays: Number(e.target.value) })} /></label>
              <label>하자·파손·표시와 다름 (받은 날부터 몇 개월)<input type="number" min={3} max={12} value={draft.returns.defectMonths} onChange={(e) => put('returns', { defectMonths: Number(e.target.value) })} /></label>
              <label>하자를 안 날부터 며칠<input type="number" min={30} max={90} value={draft.returns.defectKnownDays} onChange={(e) => put('returns', { defectKnownDays: Number(e.target.value) })} /></label>
            </div>
          </>
        )}

        {part === 'notify' && (
          <>
            <p className="muted">새 주문·반품 신청·상품 문의·기업 구매 문의·판매자 가입 신청이 들어오면 이 메일로 알려요. 손님 화면에는 보이지 않아요.</p>
            <label>알림 받을 메일<input type="email" value={draft.notify.to} maxLength={254} placeholder="비우면 서버 설정(ADMIN_EMAIL)의 메일" onChange={(e) => put('notify', { to: e.target.value })} /></label>
            <label>참조 (한 줄에 하나, 5곳까지)<textarea rows={3} value={ccText(draft.notify.cc)} onChange={(e) => put('notify', { cc: e.target.value })} /></label>
            <p className="muted">메일 서버 설정(.env 의 SMTP)이 있어야 실제로 보내져요. 보낸 기록은 [알림 기록]에서 볼 수 있어요.</p>
          </>
        )}

        {part === 'policies' && (
          <>
            <nav className="tabs">
              {Object.entries(POLICY_NAMES).map(([key, label]) => <button key={key} type="button" className={key === kind ? 'on' : ''} onClick={() => setKind(key)}>{label}</button>)}
            </nav>
            <p className="muted">글에 아래 자리표시를 쓰면 설정 값으로 바뀌어요 (배송비를 바꾸면 정책 글도 함께 바뀌게): {Object.entries(data.placeholders).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
            <p className="muted">약관·처리방침은 법률 검토가 필요한 글이에요. 고친 뒤 담당자 확인을 받아 주세요.</p>
            <label>제목<input value={policy.title} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, policies: { ...d.policies, [kind]: { ...policy, title: e.target.value } } }))} /></label>
            {policy.sections.map(([title, text], i) => (
              <div key={i} className="site-row">
                <p className="site-row-head"><b>{i + 1}. {title || '새 항목'}</b>
                  <span className="site-row-tools">
                    <button type="button" disabled={i === 0} aria-label="위로" onClick={() => { const a = [...policy.sections]; [a[i], a[i - 1]] = [a[i - 1], a[i]]; setSections(a) }}>↑</button>
                    <button type="button" disabled={i === policy.sections.length - 1} aria-label="아래로" onClick={() => { const a = [...policy.sections]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; setSections(a) }}>↓</button>
                    <button type="button" onClick={() => setSections(policy.sections.filter((_, j) => j !== i))}>빼기</button>
                  </span>
                </p>
                <label>항목 제목<input value={title} maxLength={40} onChange={(e) => setSections(policy.sections.map((s, j) => (j === i ? [e.target.value, s[1]] : s)))} /></label>
                <label>글<textarea value={text} rows={4} maxLength={3000} onChange={(e) => setSections(policy.sections.map((s, j) => (j === i ? [s[0], e.target.value] : s)))} /></label>
              </div>
            ))}
            {policy.sections.length < 30 && <button type="button" className="button ghost" onClick={() => setSections([...policy.sections, ['', '']])}>항목 더하기</button>}
            <p className="muted">[저장]은 정책 글 4개를 함께 저장해요.</p>
          </>
        )}

        {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {message && <p className="success">{message}</p>}
        <div className="actions">
          {saved && <button type="button" className="button ghost" onClick={reset}>기본값으로</button>}
          <button type="button" className="button" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </section>
  )
}
