import { useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 관리자 [공지·언론]: 공지사항·언론보도 글 쓰기·고치기·숨기기·지우기, 공지 팝업 켜기 (server/posts.js)
const KINDS = { notice: '공지사항', press: '언론보도' }
const EMPTY = { kind: 'notice', title: '', body: '', link_url: '', image_url: '', pinned: false, popup: false, popup_until: '', hidden: false }
const day = (t) => new Date(t).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })

function PostForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...initial, popup_until: initial?.popup_until ? String(initial.popup_until).slice(0, 10) : '', link_url: initial?.link_url ?? '', image_url: initial?.image_url ?? '' }))
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setErrors([])
    try {
      const saved = initial?.id
        ? await adminApi(`/posts/${initial.id}`, { method: 'PATCH', body: form })
        : await adminApi('/posts', { method: 'POST', body: form })
      onSaved(saved, initial?.id ? '글을 고쳤어요' : '글을 올렸어요')
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="box form" onSubmit={save}>
      <h3>{initial?.id ? '글 고치기' : '새 글'}</h3>
      <label>게시판<select value={form.kind} onChange={set('kind')}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>제목<em className="req" title="필수">*</em><input value={form.title} onChange={set('title')} maxLength={100} /></label>
      <label>내용 <span className="muted">줄바꿈 그대로 보여요 (5000자까지)</span><textarea value={form.body} onChange={set('body')} rows={8} maxLength={5000} /></label>
      <label>링크 <span className="muted">(선택) 기사·영상 주소, https:// 로 시작</span><input value={form.link_url} onChange={set('link_url')} placeholder="https://" /></label>
      <label>사진 주소 <span className="muted">(선택) 서버 public/posts 폴더의 파일, 예: /posts/notice-2026-chuseok.webp</span><input value={form.image_url} onChange={set('image_url')} /></label>
      <label className="check"><input type="checkbox" checked={form.pinned} onChange={set('pinned')} />목록 맨 위에 고정</label>
      {form.kind === 'notice' && (
        <label className="check"><input type="checkbox" checked={form.popup} onChange={set('popup')} />첫 화면 팝업으로 띄우기</label>
      )}
      {form.kind === 'notice' && form.popup && (
        <label>팝업 끝나는 날 <span className="muted">(비우면 끌 때까지)</span><input type="date" value={form.popup_until} onChange={set('popup_until')} /></label>
      )}
      <label className="check"><input type="checkbox" checked={form.hidden} onChange={set('hidden')} />손님에게 숨기기</label>
      {errors.length > 0 && <ul className="error">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="actions">
        <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>취소</button>
        <button type="submit" className="button" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </form>
  )
}

export function AdminPosts() {
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null) // null · 'new' · 글
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = () => adminApi('/posts').then(setList).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  async function remove(post) {
    if (!window.confirm(`'${post.title}' 글을 지울까요? 되돌릴 수 없어요. (숨기기만 하려면 [고치기]에서 '손님에게 숨기기')`)) return
    try {
      await adminApi(`/posts/${post.id}`, { method: 'DELETE' })
      setMessage('글을 지웠어요')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  if (editing) {
    return <PostForm initial={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSaved={(_, text) => { setEditing(null); setMessage(text); load() }} />
  }
  return (
    <section>
      <div className="admin-head">
        <h2>공지사항·언론보도</h2>
        <button type="button" className="button" onClick={() => { setMessage(''); setEditing('new') }}>새 글 쓰기</button>
      </div>
      <p className="muted">손님 화면 /notice · /press 에 보여요. 공지는 [첫 화면 팝업]으로 띄울 수 있어요 (끝나는 날까지, 가장 최근 1개).</p>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      {!list ? <p className="muted">불러오는 중…</p> : list.length === 0 ? <p className="muted">아직 글이 없어요.</p> : (
        <table className="admin-table">
          <thead><tr><th>게시판</th><th>제목</th><th>날짜</th><th>표시</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={p.hidden ? 'dim' : ''}>
                <td>{KINDS[p.kind]}</td>
                <td><a href={`/${p.kind}/${p.id}`} target="_blank" rel="noreferrer">{p.title}</a></td>
                <td>{day(p.created_at)}</td>
                <td>{[p.pinned && '고정', p.popup && `팝업${p.popup_until ? `(~${String(p.popup_until).slice(0, 10)})` : ''}`, p.hidden && '숨김'].filter(Boolean).join(' · ') || '-'}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => { setMessage(''); setEditing(p) }}>고치기</button>
                  <button type="button" onClick={() => remove(p)}>지우기</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
