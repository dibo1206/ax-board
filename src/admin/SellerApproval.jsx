import { useCallback, useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 판매자 승인: 스스로 가입한 농가의 정보를 확인하고 승인·반려한다. 승인해야 상품을 올릴 수 있다
const LABEL = { pending: '승인 대기', active: '활동 중', rejected: '반려' }

export function SellerApproval({ onCount }) {
  const [list, setList] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => adminApi('/sellers').then(setList).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  async function decide(seller, approve) {
    const note = approve ? null : window.prompt('사유를 적어 주세요 (판매자에게 보여요)')
    if (!approve && !note?.trim()) return
    setError('')
    try {
      await adminApi(`/sellers/${seller.seller_code}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: approve ? {} : { note } })
      setMessage(`${seller.name}: ${approve ? '승인했어요' : '반려했어요'}`)
      await load()
      onCount?.()
    } catch (e) {
      setError(e.message)
    }
  }

  if (!list) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  return (
    <section>
      <p className="muted">사업자등록번호 같은 신청 정보를 확인한 뒤 승인해 주세요. 승인하면 상품을 올릴 수 있어요.</p>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead><tr><th>농가</th><th>대표자·연락처</th><th>사업자등록번호</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.seller_code}>
              <td><strong>{s.name}</strong><br /><span className="muted">{s.region} · 아이디 {s.login_ids ?? '-'} · 상품 {s.products}개</span></td>
              <td>{s.owner_name ?? '-'}<br /><span className="muted">{s.phone ?? ''} {s.email ?? ''}</span></td>
              <td>{s.business_no ?? '-'}</td>
              <td>{s.status === 'pending' ? <span className="badge pending">{LABEL[s.status]}</span> : LABEL[s.status]}
                {s.reject_note && <><br /><span className="muted">{s.reject_note}</span></>}</td>
              <td className="row-actions">
                {!s.is_company && s.status !== 'active' && <button type="button" onClick={() => decide(s, true)}>승인</button>}
                {!s.is_company && s.status !== 'rejected' && <button type="button" onClick={() => decide(s, false)}>{s.status === 'active' ? '활동 중지' : '반려'}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
