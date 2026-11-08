import { useCallback, useEffect, useState } from 'react'
import { adminApi } from './api.js'

// 관리자 [관리자 계정] (server/staff.js): 서버 명령어 없이 내 비밀번호·2단계 인증, 관리자 추가·비밀번호 다시 정하기·2단계 인증 풀기·지우기.
// 계정에 손대는 일은 모두 "내 비밀번호"를 한 번 더 넣어야 해요
const RULE = '10자 이상, 영문·숫자·기호 중 두 가지 이상, 아이디는 넣지 않기'
const day = (v) => (v ? new Date(v).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-')

function MyPassword({ value, onChange }) {
  return <label>내 비밀번호 (확인용)<em className="req">*</em><input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="current-password" /></label>
}

function NewPassword({ value, again, onChange, onAgain, label = '새 비밀번호' }) {
  const mismatch = again && value !== again
  return (
    <div className="row">
      <label>{label}<em className="req">*</em><input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" placeholder={RULE} /></label>
      <label>한 번 더<em className="req">*</em><input type="password" value={again} onChange={(e) => onAgain(e.target.value)} autoComplete="new-password" className={mismatch ? 'invalid' : ''} aria-invalid={mismatch} /></label>
    </div>
  )
}

// 내 계정: 비밀번호 바꾸기 · 2단계 인증 등록/해제
function MyAccount({ me, twoFactorRequired, onChanged }) {
  const [mode, setMode] = useState(null) // 'password' | '2fa' | '2fa-off'
  const [form, setForm] = useState({ my: '', pw: '', again: '', code: '' })
  const [setup, setSetup] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))
  const open = (m) => { setMode(m); setForm({ my: '', pw: '', again: '', code: '' }); setSetup(null); setError(''); setMessage('') }

  async function run(fn, done) {
    setError('')
    try {
      await fn()
      setMode(null)
      setSetup(null)
      setMessage(done)
      onChanged()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="box form">
      <h3>내 계정 · {me.login_id}</h3>
      <p className="muted">2단계 인증(휴대폰 인증 앱): {me.mfa ? '✓ 등록됨' : '등록 안 됨'}{twoFactorRequired && ' · 이 서버는 2단계 인증이 필수예요'}</p>
      <div className="actions">
        <button type="button" className="button ghost" onClick={() => open('password')}>비밀번호 바꾸기</button>
        <button type="button" className="button ghost" onClick={() => open('2fa')}>{me.mfa ? '2단계 인증 다시 등록 (휴대폰을 바꿨을 때)' : '2단계 인증 등록'}</button>
        {me.mfa && !twoFactorRequired && <button type="button" className="link" onClick={() => open('2fa-off')}>2단계 인증 해제</button>}
      </div>

      {mode === 'password' && (
        <div className="site-row">
          <MyPassword value={form.my} onChange={set('my')} />
          <NewPassword value={form.pw} again={form.again} onChange={set('pw')} onAgain={set('again')} />
          <div className="actions">
            <button type="button" className="button" disabled={!form.my || !form.pw || form.pw !== form.again}
              onClick={() => run(() => adminApi('/staff/me/password', { method: 'POST', body: { myPassword: form.my, password: form.pw } }), '비밀번호를 바꿨어요. 다른 곳에서 로그인한 화면은 로그아웃됐어요.')}>바꾸기</button>
            <button type="button" className="link" onClick={() => setMode(null)}>닫기</button>
          </div>
        </div>
      )}

      {mode === '2fa' && (
        <div className="site-row">
          {!setup ? (
            <>
              <MyPassword value={form.my} onChange={set('my')} />
              <div className="actions">
                <button type="button" className="button" disabled={!form.my} onClick={async () => {
                  setError('')
                  try { setSetup(await adminApi('/staff/me/2fa/start', { method: 'POST', body: { myPassword: form.my } })) } catch (e) { setError(e.message) }
                }}>등록 키 받기</button>
                <button type="button" className="link" onClick={() => setMode(null)}>닫기</button>
              </div>
            </>
          ) : (
            <>
              <ol className="twofa-steps">
                <li>휴대폰 인증 앱(Google Authenticator, Microsoft Authenticator 등)에서 <b>설정 키 입력</b>을 고르세요. 휴대폰으로 이 화면을 보고 있다면 <a href={setup.uri}>인증 앱에 바로 추가</a>를 눌러도 돼요.</li>
                <li>계정 이름은 아무거나(예: 윤주마켓 {me.login_id}), 키는 아래 값을 넣으세요. <b>이 키는 다른 사람에게 보여 주지 마세요.</b>
                  <p className="twofa-key" aria-label="설정 키">{setup.key}</p>
                </li>
                <li>앱에 나온 6자리 코드를 넣으세요 (10분 안에).</li>
              </ol>
              <label>인증 앱 코드 (6자리)<input value={form.code} onChange={(e) => set('code')(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" /></label>
              <div className="actions">
                <button type="button" className="button" disabled={form.code.length !== 6}
                  onClick={() => run(() => adminApi('/staff/me/2fa/confirm', { method: 'POST', body: { setup: setup.setup, code: form.code } }), '2단계 인증을 등록했어요. 다음 로그인부터 인증 앱 코드가 필요해요.')}>확인하고 등록</button>
                <button type="button" className="link" onClick={() => setMode(null)}>취소</button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === '2fa-off' && (
        <div className="site-row">
          <MyPassword value={form.my} onChange={set('my')} />
          <label>인증 앱 코드 (6자리)<input value={form.code} onChange={(e) => set('code')(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" /></label>
          <div className="actions">
            <button type="button" className="button danger" disabled={!form.my || form.code.length !== 6}
              onClick={() => run(() => adminApi('/staff/me/2fa/off', { method: 'POST', body: { myPassword: form.my, code: form.code } }), '2단계 인증을 해제했어요.')}>해제</button>
            <button type="button" className="link" onClick={() => setMode(null)}>닫기</button>
          </div>
        </div>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

// 다른 관리자 한 줄: 비밀번호 다시 정하기 · 2단계 인증 풀기 · 지우기
function OtherRow({ account, onChanged }) {
  const [mode, setMode] = useState(null) // 'password' | '2fa' | 'delete'
  const [form, setForm] = useState({ my: '', pw: '', again: '' })
  const [error, setError] = useState('')
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))
  const open = (m) => { setMode(m); setForm({ my: '', pw: '', again: '' }); setError('') }
  async function run(path, body, done) {
    setError('')
    try {
      await adminApi(`/staff/${account.id}${path}`, { method: 'POST', body })
      setMode(null)
      onChanged(done)
    } catch (e) {
      setError(e.message)
    }
  }
  return (
    <>
      <tr>
        <td>{account.login_id}</td>
        <td>{day(account.created_at)}</td>
        <td>{account.mfa ? '✓ 등록' : '안 함'}</td>
        <td>{day(account.last_login)}</td>
        <td className="actions">
          <button type="button" className="link" onClick={() => open('password')}>비밀번호 다시 정하기</button>
          {account.mfa && <button type="button" className="link" onClick={() => open('2fa')}>2단계 인증 풀기</button>}
          <button type="button" className="link danger" onClick={() => open('delete')}>지우기</button>
        </td>
      </tr>
      {mode && (
        <tr>
          <td colSpan={5}>
            <div className="site-row form">
              {mode === 'password' && <><p className="muted">{account.login_id}님은 지금 로그인한 곳에서 로그아웃돼요. 새 비밀번호는 직접 전하고, 로그인한 뒤 [내 계정]에서 바꾸게 해 주세요.</p>
                <NewPassword value={form.pw} again={form.again} onChange={set('pw')} onAgain={set('again')} label={`${account.login_id}의 새 비밀번호`} /></>}
              {mode === '2fa' && <p className="muted">휴대폰을 잃어버렸을 때만 풀어 주세요. {account.login_id}님은 다음 로그인 때 다시 등록해요.</p>}
              {mode === 'delete' && <p className="muted">{account.login_id} 계정을 지우면 되돌릴 수 없어요. 접속 기록은 남아요.</p>}
              <MyPassword value={form.my} onChange={set('my')} />
              <div className="actions">
                {mode === 'password' && <button type="button" className="button" disabled={!form.my || !form.pw || form.pw !== form.again} onClick={() => run('/password', { myPassword: form.my, password: form.pw }, `${account.login_id}의 비밀번호를 다시 정했어요.`)}>정하기</button>}
                {mode === '2fa' && <button type="button" className="button" disabled={!form.my} onClick={() => run('/2fa/reset', { myPassword: form.my }, `${account.login_id}의 2단계 인증을 풀었어요.`)}>풀기</button>}
                {mode === 'delete' && <button type="button" className="button danger" disabled={!form.my} onClick={() => run('/delete', { myPassword: form.my }, `${account.login_id} 계정을 지웠어요.`)}>지우기</button>}
                <button type="button" className="link" onClick={() => setMode(null)}>닫기</button>
              </div>
              {error && <p className="error">{error}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddAdmin({ onAdded }) {
  const [form, setForm] = useState({ id: '', pw: '', again: '', my: '' })
  const [error, setError] = useState('')
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))
  async function add() {
    setError('')
    try {
      await adminApi('/staff', { method: 'POST', body: { loginId: form.id, password: form.pw, myPassword: form.my } })
      onAdded(`관리자 ${form.id.trim().toLowerCase()}를 추가했어요. 아이디와 처음 비밀번호를 직접 전해 주세요.`)
      setForm({ id: '', pw: '', again: '', my: '' })
    } catch (e) {
      setError(e.message)
    }
  }
  return (
    <div className="box form">
      <h3>관리자 추가</h3>
      <p className="muted">새 관리자는 처음 로그인할 때 2단계 인증을 등록하고(필수인 서버), [내 계정]에서 비밀번호를 바꾸게 해 주세요. 판매 농가 계정은 [판매자 승인]에서 만들어져요.</p>
      <label>아이디<em className="req">*</em><input value={form.id} onChange={(e) => set('id')(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))} placeholder="영문 소문자·숫자·밑줄 3~20자" autoComplete="off" /></label>
      <NewPassword value={form.pw} again={form.again} onChange={set('pw')} onAgain={set('again')} label="처음 비밀번호" />
      <MyPassword value={form.my} onChange={set('my')} />
      <div className="actions"><button type="button" className="button" disabled={form.id.length < 3 || !form.pw || form.pw !== form.again || !form.my} onClick={add}>추가</button></div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function Staff() {
  const [data, setData] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => adminApi('/staff').then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
  const me = data.accounts.find((a) => a.id === data.me)
  const others = data.accounts.filter((a) => a.id !== data.me)
  const changed = (text) => { setMessage(text); load() }
  return (
    <section className="site-editor staff">
      <h2>관리자 계정</h2>
      <p className="muted">서버 명령어 없이 관리자 계정을 관리해요. 계정에 손대는 일은 모두 내 비밀번호를 한 번 더 확인해요. 무엇을 했는지는 [접속 기록]에 남아요.</p>
      {message && <p className="success">{message}</p>}
      {me && <MyAccount me={me} twoFactorRequired={data.twoFactorRequired} onChanged={load} />}
      <div className="box">
        <h3>다른 관리자 ({others.length})</h3>
        {others.length === 0 ? <p className="muted">다른 관리자가 없어요.</p> : (
          <table className="table">
            <thead><tr><th>아이디</th><th>만든 날</th><th>2단계 인증</th><th>마지막 로그인</th><th>관리</th></tr></thead>
            <tbody>{others.map((a) => <OtherRow key={a.id} account={a} onChanged={changed} />)}</tbody>
          </table>
        )}
      </div>
      <AddAdmin onAdded={changed} />
    </section>
  )
}
