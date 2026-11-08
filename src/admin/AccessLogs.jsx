import { useEffect, useState } from 'react'
import { when } from '../shop/shared.js'
import { adminApi } from './api.js'
import { usePage } from './paging.js'
import { Pager } from './ui.jsx'

// 관리자·판매자 접속 기록 (누가·언제·어디서·무엇을). 개인정보 안전성 확보조치에 따라 1년 이상 보관한다
const ACTIONS = {
  login_ok: '로그인', login_fail: '로그인 실패', otp_fail: '인증 코드 실패', login_locked: '잠김 상태에서 시도',
  login_blocked_ip: '허용 안 된 IP', login_no_2fa: '2단계 인증 미등록', logout: '로그아웃', request: '요청',
}

export function AccessLogs() {
  const [data, setData] = useState(null)
  const [loginId, setLoginId] = useState('')
  const [error, setError] = useState('')
  const logPage = usePage(data?.logs ?? [], 20, data)

  useEffect(() => {
    adminApi('/access-logs').then(setData).catch((e) => setError(e.message))
  }, [])

  async function filter(event) {
    event.preventDefault()
    try {
      setData(await adminApi(`/access-logs${loginId ? `?loginId=${encodeURIComponent(loginId)}` : ''}`))
    } catch (e) {
      setError(e.message)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">불러오는 중…</p>
  return (
    <section>
      <p>최근 24시간: 로그인 {data.summary.logins_today}번 · 실패 {data.summary.fails_today}번 <span className="muted">(최근 300건 표시)</span></p>
      <form className="row form" onSubmit={filter}>
        <label>계정으로 찾기<input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="아이디" /></label>
        <button type="submit" className="button ghost">찾기</button>
      </form>
      <table className="table">
        <thead><tr><th>때</th><th>계정</th><th>한 일</th><th>IP</th></tr></thead>
        <tbody>
          {logPage.rows.map((l) => (
            <tr key={l.id} className={l.action.includes('fail') || l.action.includes('blocked') ? 'warn-row' : ''}>
              <td className="muted">{when(l.created_at)}</td>
              <td>{l.login_id ?? '-'}{l.role && <span className="muted"> ({l.role === 'seller' ? '판매자' : '관리자'})</span>}</td>
              <td>{ACTIONS[l.action] ?? l.action}{l.path && <span className="muted"> {l.method} {l.path} → {l.status}</span>}</td>
              <td className="muted">{l.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager paging={logPage} />
    </section>
  )
}
