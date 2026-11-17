import { useState } from 'react'
import { EMAIL_DOMAINS, emailProblem, passwordRules } from './rules.js'

// 가입·비밀번호 화면의 입력 도우미: 다 적고 나서 아래에 빨간 글씨가 뜨는 대신, 적는 동안 바로 알려 준다
// 규칙은 서버(server/account.js checkPassword, 가입 검사)와 같다. 서버도 다시 검사한다

export const Req = () => <em className="req" title="필수">*</em>

// 약관 '모두 동의': 누르면 아래 필수 동의(이용약관·개인정보)를 한 번에 켜고 끈다. 둘 다 켜져 있으면 함께 켜진 것으로 보인다 (2026-11-07 피드백)
// age: 만 14세 이상 확인 칸(agreeAge)도 함께 켜고 끌지. 기본은 form 에 그 칸이 있을 때 (비회원 주문은 로그인 안 했을 때만)
export function AgreeAll({ form, setForm, age = 'agreeAge' in form }) {
  const hasAge = age
  const all = form.agreeTerms && form.agreePrivacy && (!hasAge || form.agreeAge)
  return (
    <label className="check agree-all">
      <input type="checkbox" checked={all} onChange={(e) => setForm((prev) => ({ ...prev, agreeTerms: e.target.checked, agreePrivacy: e.target.checked, ...(hasAge ? { agreeAge: e.target.checked } : {}) }))} />
      <strong>약관에 모두 동의해요</strong> <span className="muted">(아래 필수 항목 전체)</span>
    </label>
  )
}

// 이메일: 아이디 칸 + @ + 자주 쓰는 주소 고르기(직접 입력도). onChange 로 'id@domain' 을 넘긴다
export function EmailField({ id, value, onChange, show, label = '이메일', note }) {
  const [local, setLocal] = useState(() => value.split('@')[0] ?? '')
  const [domain, setDomain] = useState(() => value.split('@')[1] || EMAIL_DOMAINS[0])
  const [custom, setCustom] = useState(() => Boolean(value.split('@')[1]) && !EMAIL_DOMAINS.includes(value.split('@')[1]))
  const emit = (l, d) => onChange(l ? `${l}@${d}`.toLowerCase() : '')

  function typeLocal(text) {
    // 'abc@gmail.com' 을 통째로 붙여 넣으면 나눠 담는다
    if (text.includes('@')) {
      const [l, d = ''] = text.split('@')
      const known = EMAIL_DOMAINS.includes(d.toLowerCase())
      setLocal(l)
      setCustom(!known)
      setDomain(known ? d.toLowerCase() : d)
      emit(l, d)
      return
    }
    setLocal(text)
    emit(text, domain)
  }

  function pickDomain(d) {
    if (d === '') {
      setCustom(true)
      setDomain('')
      emit(local, '')
    } else {
      setCustom(false)
      setDomain(d)
      emit(local, d)
    }
  }

  const problem = emailProblem(value || `${local}@${domain}`)
  const typed = local.length > 0 || show
  const bad = typed && Boolean(problem)
  return (
    <div className="field">
      <label htmlFor={id}>{label}<Req />{note && <span className="muted"> {note}</span>}</label>
      <div className={`email-row${bad ? ' bad' : typed && !problem ? ' good' : ''}`}>
        <input id={id} value={local} onChange={(e) => typeLocal(e.target.value.trim())} placeholder="아이디" autoComplete="username" autoCapitalize="none"
          inputMode="email" aria-invalid={bad} aria-describedby={`${id}-msg`} maxLength={64} />
        <span aria-hidden="true">@</span>
        {custom && (
          <input value={domain} onChange={(e) => { setDomain(e.target.value.trim()); emit(local, e.target.value.trim()) }} placeholder="예: company.co.kr"
            aria-label="이메일 뒤쪽 주소 직접 입력" autoCapitalize="none" maxLength={190} />
        )}
        <select value={custom ? '' : domain} onChange={(e) => pickDomain(e.target.value)} aria-label="이메일 뒤쪽 주소 고르기">
          {EMAIL_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
          <option value="">직접 입력</option>
        </select>
      </div>
      <p id={`${id}-msg`} className={`field-msg${bad ? ' no' : typed ? ' ok' : ''}`} aria-live="polite">
        {bad ? problem : typed ? '형식이 맞아요.' : ''}
      </p>
    </div>
  )
}

// 새 비밀번호 + 확인: 규칙 체크 목록, 확인이 다르면 바로 빨간 테두리와 "다시 입력해 주세요"
export function NewPasswordFields({ idPrefix, password, password2, onPassword, onPassword2, idOrEmail, show, label = '비밀번호' }) {
  const rules = passwordRules(password, idOrEmail)
  const typed = password.length > 0
  const allOk = rules.every((r) => r.ok)
  const mismatch = password2.length > 0 && password2 !== password
  const match = password2.length > 0 && password2 === password
  const emptyBad = show && !typed
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-pw`}>{label}<Req /></label>
        <input id={`${idPrefix}-pw`} type="password" value={password} onChange={(e) => onPassword(e.target.value)} autoComplete="new-password"
          className={(typed && !allOk) || emptyBad ? 'bad' : typed ? 'good' : ''} aria-invalid={(typed && !allOk) || emptyBad} aria-describedby={`${idPrefix}-pw-rules`} maxLength={100} />
        <ul id={`${idPrefix}-pw-rules`} className="pw-rules" aria-live="polite">
          {rules.map((r) => (
            <li key={r.text} className={!typed ? (show ? 'no' : '') : r.ok ? 'ok' : 'no'}>
              <span aria-hidden="true">{typed && r.ok ? '✓' : '•'}</span> {r.text}{typed && <span className="sr-only">{r.ok ? ' (맞음)' : ' (아직)'}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-pw2`}>{label} 확인<Req /></label>
        <input id={`${idPrefix}-pw2`} type="password" value={password2} onChange={(e) => onPassword2(e.target.value)} autoComplete="new-password"
          className={mismatch || (show && !password2) ? 'bad' : match ? 'good' : ''} aria-invalid={mismatch} aria-describedby={`${idPrefix}-pw2-msg`} maxLength={100} />
        <p id={`${idPrefix}-pw2-msg`} className={`field-msg${mismatch || (show && !password2) ? ' no' : match ? ' ok' : ''}`} aria-live="polite">
          {mismatch ? '비밀번호가 달라요. 다시 입력해 주세요.' : show && !password2 ? '비밀번호를 한 번 더 적어 주세요.' : match ? '비밀번호가 같아요.' : ''}
        </p>
      </div>
    </>
  )
}

