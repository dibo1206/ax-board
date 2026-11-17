import { useCallback, useEffect, useState } from 'react'
import { adminApi } from './api.js'
import { usePage } from './paging.js'
import { FilterChips, Pager } from './ui.jsx'

// 판매자 승인: 스스로 가입한 농가의 정보를 확인하고 승인·반려한다. 승인해야 상품을 올릴 수 있다
const LABEL = { pending: '승인 대기', active: '활동 중', rejected: '반려' }
// 농가가 많아져도 (2026-11-09): 상태로 걸러 보기 + 이름·지역·대표자·아이디 찾기 + 20곳씩
const VIEWS = [['all', '전체'], ['pending', '승인 대기'], ['active', '활동 중'], ['rejected', '반려']]

export function SellerApproval({ onCount }) {
  const [list, setList] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState('all')
  const [query, setQuery] = useState('')
  const [support, setSupport] = useState(null) // { seller, mode: 'password' | '2fa' }
  const [form, setForm] = useState({ my: '', pw: '', again: '' })
  const q = query.trim()
  const shown = (list ?? [])
    .filter((x) => view === 'all' || x.status === view)
    .filter((x) => !q || `${x.name} ${x.region ?? ''} ${x.owner_name ?? ''} ${x.login_ids ?? ''}`.includes(q))
  const paging = usePage(shown, 20, `${view}|${q}`)

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

  // 판매자 계정 지원: 비밀번호를 잊었거나 유출됐을 때, 휴대폰을 잃어버렸을 때. 내 비밀번호를 한 번 더 확인한다
  const openSupport = (seller, mode) => { setSupport({ seller, mode }); setForm({ my: '', pw: '', again: '' }); setError(''); setMessage('') }
  // 농가별 수수료율: 숫자를 적으면 이 농가만 그 값, 비우면 기본값. 바꾼 뒤 들어오는 주문부터
  async function setCommission(seller) {
    const now = seller.commission_rate == null ? '' : String(seller.commission_rate)
    const input = window.prompt(`${seller.name}의 수수료율(%)을 적어 주세요.
비우면 기본값(${seller.is_company ? '회사 직영 0' : seller.default_commission}%)을 따라요. 바꾼 뒤 들어오는 주문부터 적용돼요.`, now)
    if (input === null) return
    setError('')
    try {
      await adminApi(`/sellers/${seller.seller_code}/commission`, { method: 'PUT', body: { rate: input.trim() } })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function runSupport() {
    const { seller, mode } = support
    setError('')
    try {
      await adminApi(`/sellers/${seller.seller_code}/${mode === 'password' ? 'password' : '2fa/reset'}`, { method: 'POST', body: { myPassword: form.my, password: form.pw } })
      setMessage(mode === 'password' ? `${seller.name}: 비밀번호를 다시 정했어요. 새 비밀번호를 직접 전하고, 로그인한 뒤 바꾸게 해 주세요.` : `${seller.name}: 2단계 인증 등록을 열었어요. 7일 안에 로그인하면서 등록해요.`)
      setSupport(null)
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
      <div className="toolbar">
        <FilterChips value={view} onChange={setView} items={VIEWS.map(([key, label]) => ({ key, label, count: key === 'all' ? list.length : list.filter((x) => x.status === key).length }))} />
        <div className="actions">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="농가·지역·대표자·아이디 찾기" aria-label="농가 찾기" />
        </div>
      </div>
      {support && (
        <div className="box form">
          <h3>{support.seller.name} · {support.mode === 'password' ? '비밀번호 다시 정하기' : '2단계 인증 풀기·등록 다시 열기'}</h3>
          <p className="muted">{support.mode === 'password' ? '이 농가의 로그인은 끊겨요. 새 비밀번호는 직접 전해 주세요.' : '휴대폰을 잃어버렸거나 등록 기간이 지났을 때 써요. 이 농가의 로그인은 끊겨요.'}</p>
          {support.mode === 'password' && (
            <div className="row">
              <label>새 비밀번호<input type="password" value={form.pw} onChange={(e) => setForm({ ...form, pw: e.target.value })} autoComplete="new-password" placeholder="10자 이상, 영문·숫자·기호 중 두 가지 이상" /></label>
              <label>한 번 더<input type="password" value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} autoComplete="new-password" /></label>
            </div>
          )}
          <label>내 비밀번호 (확인용)<input type="password" value={form.my} onChange={(e) => setForm({ ...form, my: e.target.value })} autoComplete="current-password" /></label>
          <div className="actions">
            <button type="button" className="button" disabled={!form.my || (support.mode === 'password' && (!form.pw || form.pw !== form.again))} onClick={runSupport}>확인</button>
            <button type="button" className="link" onClick={() => setSupport(null)}>닫기</button>
          </div>
        </div>
      )}
      {shown.length === 0 && <p className="muted">맞는 농가가 없어요.</p>}
      <table className="table">
        <thead><tr><th>농가</th><th>대표자·연락처</th><th>사업자등록번호</th><th>수수료</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {paging.rows.map((s) => (
            <tr key={s.seller_code}>
              <td><strong>{s.name}</strong><br /><span className="muted">{s.region} · 아이디 {s.login_ids ?? '-'} · 상품 {s.products}개</span></td>
              <td>{s.owner_name ?? '-'}<br /><span className="muted">{s.phone ?? ''} {s.email ?? ''}</span></td>
              <td>{s.business_no ?? '-'}</td>
              <td><button type="button" className="link" onClick={() => setCommission(s)} title="눌러서 이 농가 수수료율 정하기">{s.effective_commission}%</button>
                <br /><span className="muted">{s.commission_rate == null ? (s.is_company ? '회사 직영' : '기본값') : '이 농가만'}</span></td>
              <td>{s.status === 'pending' ? <span className="badge pending">{LABEL[s.status]}</span> : LABEL[s.status]}
                {s.reject_note && <><br /><span className="muted">{s.reject_note}</span></>}</td>
              <td className="row-actions">
                {!s.is_company && s.status !== 'active' && <button type="button" onClick={() => decide(s, true)}>승인</button>}
                {!s.is_company && s.status !== 'rejected' && <button type="button" onClick={() => decide(s, false)}>{s.status === 'active' ? '활동 중지' : '반려'}</button>}
                {s.login_ids && <button type="button" onClick={() => openSupport(s, 'password')}>비밀번호 다시 정하기</button>}
                {s.login_ids && <button type="button" onClick={() => openSupport(s, '2fa')}>2단계 인증 열기</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager paging={paging} />
    </section>
  )
}
