import { useEffect, useState } from 'react'
import { when } from '../shop/shared.js'
import { adminApi } from './api.js'

// 알림 기록: 손님·관리자에게 보낸(또는 메일 서버 설정이 없어 보내지 않은) 메일
const STATUS = { queued: '보내는 중', sent: '보냄', failed: '실패', skipped: '설정 없음' }

export function Notifications() {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi('/notifications').then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">불러오는 중…</p>
  return (
    <section>
      {!data.configured && <p className="warn">메일 서버 설정(.env 의 SMTP_HOST, MAIL_FROM)이 없어서 메일을 보내지 않고 여기에만 남겨요. 비밀번호 찾기 링크 같은 비밀값은 지워서 저장해요.</p>}
      {data.mails.length === 0 ? <p className="muted">아직 알림이 없어요.</p> : (
        <table className="table">
          <thead><tr><th>때</th><th>받는 사람</th><th>제목</th><th>상태</th></tr></thead>
          <tbody>
            {data.mails.map((m) => (
              <tr key={m.id}>
                <td className="muted">{when(m.created_at)}</td>
                <td>{m.to_email}</td>
                <td>
                  <button type="button" className="link" onClick={() => setOpen(open === m.id ? null : m.id)}>{m.subject}</button>
                  {open === m.id && <pre className="mail-body">{m.body}</pre>}
                </td>
                <td>{STATUS[m.status] ?? m.status}{m.last_error && <><br /><span className="muted">{m.last_error}</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
