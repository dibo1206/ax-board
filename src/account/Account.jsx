import { useEffect, useState } from 'react'
import { adminApi } from '../admin/api.js'
import { OrderDetail } from '../shop/Orders.jsx'
import { get, loadScript, ORDER_STATUS, post, send, when, won } from '../shop/shared.js'

// 손님 회원: 로그인 · 가입 · 비밀번호 찾기 · 마이페이지(주문 내역 · 내 정보·배송지 · 비밀번호 · 탈퇴)
const POSTCODE_SDK = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
const goNext = () => {
  const next = new URLSearchParams(window.location.search).get('next') ?? ''
  // 브라우저는 /\\evil.example 도 다른 사이트로 읽는다 → 글자가 아니라 풀어 본 주소로 우리 사이트인지 확인한다
  let target = '/account'
  try {
    const url = new URL(next, window.location.origin)
    if (next.startsWith('/') && url.origin === window.location.origin) target = url.pathname + url.search + url.hash
  } catch {
    // 잘못된 주소면 마이페이지로
  }
  window.location.href = target
}

// 간편 로그인 버튼: 서버가 켜 둔 것만 (키가 없으면 개발에서는 [시험], 운영에서는 안 보임)
function SocialButtons({ next = '/account', label = '시작하기' }) {
  const [providers, setProviders] = useState([])
  useEffect(() => {
    get('/account/oauth/providers').then(setProviders).catch(() => setProviders([]))
  }, [])
  if (!providers.length) return null
  return (
    <div className="social-login">
      <p className="social-or"><span>간편하게 {label}</span></p>
      {providers.map((p) => (
        <a key={p.provider} className={`social-btn ${p.provider}`} href={`/api/account/oauth/${p.provider}/start?next=${encodeURIComponent(next)}`}>
          <span className="social-mark" aria-hidden="true">{p.provider === 'kakao' ? 'K' : 'N'}</span>
          {p.name}로 {label}{p.mode === 'mock' && <small> (시험 로그인)</small>}
        </a>
      ))}
    </div>
  )
}

function Errors({ list }) {
  return list.length > 0 ? <ul className="error">{list.map((e) => <li key={e}>{e}</li>)}</ul> : null
}

// 로그인은 한 곳에서: 이메일이면 소비자, 아이디(@ 없음)면 판매자·관리자. 로그인하면 각자 화면으로 바로 간다
export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [needOtp, setNeedOtp] = useState(false)
  const query = new URLSearchParams(window.location.search)
  const [errors, setErrors] = useState(() => (query.get('error') ? [query.get('error')] : [])) // 간편 로그인에서 돌아온 오류

  async function submit(event) {
    event.preventDefault()
    try {
      if (email.includes('@')) {
        await post('/account/login', { email, password })
        window.dispatchEvent(new Event('account-change'))
        goNext()
      } else {
        const me = await adminApi('/login', { method: 'POST', body: { loginId: email, password, otp } })
        window.location.href = me.role === 'admin' ? '/admin' : '/seller'
      }
    } catch (e) {
      if (e.needOtp) setNeedOtp(true)
      setOtp('')
      setErrors([e.message])
    }
  }

  return (
    <form className="box form narrow" onSubmit={submit}>
      <h2>로그인</h2>
      <label>이메일 또는 판매자 아이디<input value={email} onChange={(e) => setEmail(e.target.value.trim())} autoComplete="username" autoCapitalize="none" /></label>
      <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      {needOtp && <label>인증 앱 코드 (6자리)<input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" /></label>}
      <Errors list={errors} />
      <button type="submit" className="button">로그인</button>
      <p className="muted"><a href="/account/signup">회원가입</a> · <a href="/account/find">비밀번호 찾기</a> · 회원가입 없이도 주문할 수 있어요</p>
      <SocialButtons next={query.get('next') ?? '/account'} />
    </form>
  )
}

// 간편 로그인으로 처음 온 손님: 약관 동의와 연락처를 받고 가입 (카카오·네이버에서 받은 이메일·이름은 미리 채운다)
export function SocialSignupPage() {
  const [pending, setPending] = useState(undefined)
  const [form, setForm] = useState({ email: '', name: '', phone: '', agreeTerms: false, agreePrivacy: false })
  const [errors, setErrors] = useState([])
  const [existing, setExisting] = useState(false)
  useEffect(() => {
    get('/account/oauth/pending').then((p) => { setPending(p); setForm((f) => ({ ...f, email: p.email ?? '', name: p.name ?? '' })) }).catch(() => setPending(null))
  }, [])
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  async function submit(event) {
    event.preventDefault()
    try {
      const done = await post('/account/oauth/complete', form)
      window.dispatchEvent(new Event('account-change'))
      window.location.href = done.next || '/account'
    } catch (e) {
      setExisting(e.status === 409)
      setErrors(e.errors ?? [e.message])
    }
  }
  if (pending === undefined) return <p className="muted">불러오는 중…</p>
  if (!pending) return <div className="box narrow"><p>간편 가입 시간이 지났어요.</p><a className="button" href="/account/login">로그인 화면으로</a></div>
  return (
    <form className="box form narrow" onSubmit={submit}>
      <h2>{pending.providerName}로 가입하기{pending.mock && <small className="muted"> (시험 로그인)</small>}</h2>
      <p className="muted">처음 오셨어요. 주문 알림과 주문 조회에 쓸 정보를 확인하고 약관에 동의해 주세요.</p>
      <label>이메일<input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
      <label>이름<input value={form.name} onChange={set('name')} maxLength={20} autoComplete="name" /></label>
      <label>휴대폰 <span className="muted">주문 조회에 써요</span><input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="010-1234-5678" autoComplete="tel" /></label>
      <label className="check"><input type="checkbox" checked={form.agreeTerms} onChange={set('agreeTerms')} />[필수] <a href="/policy/terms" target="_blank" rel="noreferrer">이용약관</a>에 동의해요</label>
      <label className="check"><input type="checkbox" checked={form.agreePrivacy} onChange={set('agreePrivacy')} />[필수] <a href="/policy/privacy" target="_blank" rel="noreferrer">개인정보 수집·이용</a>에 동의해요 (간편 로그인 회원 번호·이메일·이름·휴대폰, 탈퇴 시 삭제)</label>
      <Errors list={errors} />
      {existing && <p className="muted"><a href="/account/login?next=/account">이메일로 로그인</a>한 뒤 마이페이지 [로그인·탈퇴]에서 {pending.providerName} 계정을 연결할 수 있어요.</p>}
      <button type="submit" className="button">동의하고 가입</button>
    </form>
  )
}

// 마이페이지: 간편 로그인 연결·끊기
function LinkedAccounts() {
  const [state, setState] = useState(null)
  const [providers, setProviders] = useState([])
  const [error, setError] = useState('')
  const load = () => get('/account/oauth/linked').then(setState).catch((e) => setError(e.message))
  useEffect(() => {
    get('/account/oauth/linked').then(setState).catch((e) => setError(e.message))
    get('/account/oauth/providers').then(setProviders).catch(() => {})
  }, [])
  async function unlink(provider) {
    try {
      await send('DELETE', `/account/oauth/${provider}`)
      setError('')
      load()
    } catch (e) {
      setError(e.message)
    }
  }
  if (!state) return null
  const linked = new Set(state.linked.map((l) => l.provider))
  return (
    <div className="box form">
      <h3>간편 로그인</h3>
      {providers.length === 0 && <p className="muted">지금은 쓸 수 있는 간편 로그인이 없어요.</p>}
      {providers.map((p) => (
        <div key={p.provider} className="row-actions">
          <span>{p.name}{p.mode === 'mock' && ' (시험)'}: {linked.has(p.provider) ? '연결됨' : '연결 안 됨'}</span>
          {linked.has(p.provider)
            ? <button type="button" onClick={() => unlink(p.provider)}>연결 끊기</button>
            : <a className={`social-btn small ${p.provider}`} href={`/api/account/oauth/${p.provider}/start?mode=link&next=/account`}>{p.name} 연결</a>}
        </div>
      ))}
      {!state.hasPassword && <p className="muted">비밀번호 없이 간편 로그인으로만 쓰는 계정이에요. 비밀번호를 정하려면 <a href="/account/find">비밀번호 찾기</a>를 이용해 주세요.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

// 판매자 가입: 신청 → 관리자 승인 → 상품 올리기. 가입하면 바로 로그인해서 승인 상태를 보여 준다
function SellerSignup() {
  const [form, setForm] = useState({ loginId: '', password: '', password2: '', farmName: '', region: '', ownerName: '', phone: '', businessNo: '', email: '', agreeTerms: false, agreePrivacy: false })
  const [errors, setErrors] = useState([])
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(event) {
    event.preventDefault()
    if (form.password !== form.password2) return setErrors(['비밀번호 확인이 맞지 않아요.'])
    try {
      await post('/seller-signup', form)
      await adminApi('/login', { method: 'POST', body: { loginId: form.loginId.trim().toLowerCase(), password: form.password } })
      window.location.href = '/seller'
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <p className="muted">회사가 농가 정보를 확인하고 승인하면 상품을 올릴 수 있어요. 승인 결과는 이메일로 알려 드려요.</p>
      <label>아이디* <span className="muted">영문 소문자·숫자·밑줄 4~20자</span><input value={form.loginId} onChange={set('loginId')} maxLength={20} autoComplete="username" autoCapitalize="none" /></label>
      <label>비밀번호* <span className="muted">10자 이상</span><input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></label>
      <label>비밀번호 확인*<input type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" /></label>
      <label>농가·상호 이름*<input value={form.farmName} onChange={set('farmName')} maxLength={30} placeholder="예: 햇살과수원" /></label>
      <label>지역*<input value={form.region} onChange={set('region')} maxLength={30} placeholder="예: 충남 천안" /></label>
      <label>대표자 이름*<input value={form.ownerName} onChange={set('ownerName')} maxLength={20} /></label>
      <label>연락처*<input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="010-1234-5678" autoComplete="tel" /></label>
      <label>사업자등록번호*<input value={form.businessNo} onChange={set('businessNo')} inputMode="numeric" placeholder="000-00-00000" /></label>
      <label>이메일* <span className="muted">승인 결과를 받아요</span><input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
      <label className="check"><input type="checkbox" checked={form.agreeTerms} onChange={set('agreeTerms')} />[필수] <a href="/policy/terms" target="_blank" rel="noreferrer">이용약관</a> 동의 (올린 상품 정보의 정확성은 판매자가 책임져요)</label>
      <label className="check"><input type="checkbox" checked={form.agreePrivacy} onChange={set('agreePrivacy')} />[필수] <a href="/policy/privacy" target="_blank" rel="noreferrer">개인정보 수집·이용</a> 동의</label>
      <Errors list={errors} />
      <button type="submit" className="button">판매자 가입 신청</button>
    </form>
  )
}

export function SignupPage() {
  const [type, setType] = useState(() => (new URLSearchParams(window.location.search).get('type') === 'seller' ? 'seller' : 'buyer'))
  const [form, setForm] = useState({ email: '', password: '', password2: '', name: '', phone: '', agreeTerms: false, agreePrivacy: false })
  const [errors, setErrors] = useState([])
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function submit(event) {
    event.preventDefault()
    if (form.password !== form.password2) return setErrors(['비밀번호 확인이 맞지 않아요.'])
    try {
      await post('/account/signup', form)
      window.dispatchEvent(new Event('account-change'))
      goNext()
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    }
  }

  const picker = (
    <nav className="tabs" aria-label="가입 종류">
      <button type="button" className={type === 'buyer' ? 'on' : ''} onClick={() => setType('buyer')}>소비자 (상품 사기)</button>
      <button type="button" className={type === 'seller' ? 'on' : ''} onClick={() => setType('seller')}>판매자 (농가·상품 팔기)</button>
    </nav>
  )
  if (type === 'seller') return <div className="box narrow"><h2>회원가입</h2>{picker}<SellerSignup /></div>
  return (
    <form className="box form narrow" onSubmit={submit}>
      <h2>회원가입</h2>
      <SocialButtons label="가입하기" />
      {picker}
      <label>이메일*<input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
      <label>비밀번호* <span className="muted">10자 이상</span><input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" /></label>
      <label>비밀번호 확인*<input type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" /></label>
      <label>이름*<input value={form.name} onChange={set('name')} maxLength={20} autoComplete="name" /></label>
      <label>휴대폰*<input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="010-1234-5678" autoComplete="tel" /></label>
      <label className="check"><input type="checkbox" checked={form.agreeTerms} onChange={set('agreeTerms')} />[필수] <a href="/policy/terms" target="_blank" rel="noreferrer">이용약관</a>에 동의해요</label>
      <label className="check"><input type="checkbox" checked={form.agreePrivacy} onChange={set('agreePrivacy')} />[필수] <a href="/policy/privacy" target="_blank" rel="noreferrer">개인정보 수집·이용</a>에 동의해요 (이메일·이름·휴대폰, 탈퇴 시 삭제)</label>
      <Errors list={errors} />
      <button type="submit" className="button">가입하기</button>
    </form>
  )
}

export function FindPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState([])
  async function submit(event) {
    event.preventDefault()
    try {
      setMessage((await post('/account/password-reset/request', { email })).message)
      setErrors([])
    } catch (e) {
      setErrors([e.message])
    }
  }
  return (
    <form className="box form narrow" onSubmit={submit}>
      <h2>비밀번호 찾기</h2>
      <p className="muted">가입한 이메일로 비밀번호를 다시 정하는 링크를 보내 드려요. 링크는 30분 동안 쓸 수 있어요.</p>
      <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <Errors list={errors} />
      {message ? <p className="success">{message}</p> : <button type="submit" className="button">링크 받기</button>}
    </form>
  )
}

export function ResetPasswordPage() {
  // 링크의 토큰은 읽자마자 주소창에서 지운다 (방문 기록·화면 공유로 새지 않게)
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [errors, setErrors] = useState([])
  async function submit(event) {
    event.preventDefault()
    if (password !== password2) return setErrors(['비밀번호 확인이 맞지 않아요.'])
    try {
      await post('/account/password-reset/confirm', { token, password })
      window.location.href = '/account'
    } catch (e) {
      setErrors([e.message])
    }
  }
  return (
    <form className="box form narrow" onSubmit={submit}>
      <h2>새 비밀번호 정하기</h2>
      <label>새 비밀번호 <span className="muted">10자 이상</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
      <label>새 비밀번호 확인<input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" /></label>
      <Errors list={errors} />
      <button type="submit" className="button">바꾸기</button>
    </form>
  )
}

// ---------- 마이페이지 ----------
function MyOrders() {
  const [orders, setOrders] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    get('/account/orders').then(setOrders).catch((e) => setError(e.message))
  }, [])

  async function view(orderNo) {
    try {
      setOpen(await get(`/account/orders/${orderNo}`))
    } catch (e) {
      setError(e.message)
    }
  }

  async function cancel() {
    const reason = window.prompt('취소 이유를 적어 주세요 (선택)')
    if (reason === null) return
    try {
      setOpen(await post(`/account/orders/${open.order_no}/cancel`, { reason }))
      setOrders(await get('/account/orders'))
    } catch (e) {
      setError(e.message)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!orders) return <p className="muted">불러오는 중…</p>
  if (open) {
    return (
      <div className="box">
        <button type="button" className="link" onClick={() => setOpen(null)}>← 주문 내역</button>
        <OrderDetail order={open} onConfirm={async () => {
          if (!window.confirm('상품을 잘 받으셨나요? 구매를 확정해요.')) return
          try {
            setOpen(await post(`/account/orders/${open.order_no}/purchase-confirm`, {}))
          } catch (e) {
            setError(e.message)
          }
        }} onReturn={async (body) => setOpen(await post(`/account/orders/${open.order_no}/returns`, body))} />
        {open.status === 'paid' && <button type="button" className="button ghost" onClick={cancel}>주문 취소하기</button>}
      </div>
    )
  }
  if (!orders.length) return <p className="muted">아직 주문이 없어요. <a href="/">상품 보러 가기</a></p>
  return (
    <ul className="inbox">
      {orders.map((o) => (
        <li key={o.order_no} className="box">
          <button type="button" className="link" onClick={() => view(o.order_no)}>{o.order_no}</button>
          <span className="muted"> · {when(o.created_at)} · {ORDER_STATUS[o.status]}</span>
          <p>{o.summary} — {won(o.total_amount)}</p>
        </li>
      ))}
    </ul>
  )
}

function Profile({ me, onSaved }) {
  const [form, setForm] = useState({ name: me.name, phone: me.phone, zipcode: me.zipcode ?? '', address1: me.address1 ?? '', address2: me.address2 ?? '' })
  const [errors, setErrors] = useState([])
  const [message, setMessage] = useState('')
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))

  async function findAddress() {
    try {
      await loadScript(POSTCODE_SDK)
      new window.daum.Postcode({ oncomplete: (d) => setForm((prev) => ({ ...prev, zipcode: d.zonecode, address1: d.roadAddress || d.jibunAddress })) }).open()
    } catch {
      setErrors(['주소 검색을 열지 못했어요. 직접 적어 주세요.'])
    }
  }

  async function submit(event) {
    event.preventDefault()
    try {
      onSaved(await send('PATCH', '/account/me', form))
      setErrors([])
      setMessage('저장했어요')
    } catch (e) {
      setErrors(e.errors ?? [e.message])
    }
  }

  return (
    <form className="box form" onSubmit={submit}>
      <p className="muted">이메일 {me.email}</p>
      <div className="row">
        <label>이름<input value={form.name} onChange={set('name')} maxLength={20} /></label>
        <label>휴대폰<input value={form.phone} onChange={set('phone')} inputMode="tel" /></label>
      </div>
      <h3>기본 배송지 <span className="muted">주문서에 자동으로 채워져요</span></h3>
      <div className="row">
        <label>우편번호<input value={form.zipcode} onChange={set('zipcode')} inputMode="numeric" maxLength={5} /></label>
        <button type="button" className="button ghost" onClick={findAddress}>주소 검색</button>
      </div>
      <label>주소<input value={form.address1} onChange={set('address1')} maxLength={100} /></label>
      <label>상세 주소<input value={form.address2} onChange={set('address2')} maxLength={60} /></label>
      <Errors list={errors} />
      {message && <p className="success">{message}</p>}
      <button type="submit" className="button">저장</button>
    </form>
  )
}

function Security({ hasPassword = true }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [leavePassword, setLeavePassword] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState([])

  async function change(event) {
    event.preventDefault()
    try {
      await post('/account/password', { current, next })
      setCurrent('')
      setNext('')
      setErrors([])
      setMessage('비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 끊겼어요.')
    } catch (e) {
      setErrors([e.message])
    }
  }

  async function leave() {
    if (!window.confirm('정말 탈퇴할까요? 계정 정보가 지워지고 되돌릴 수 없어요. (주문 기록은 법에 따라 5년 보관돼요)')) return
    try {
      await send('DELETE', '/account/me', hasPassword ? { password: leavePassword } : { confirm: leavePassword.trim() })
      window.dispatchEvent(new Event('account-change'))
      window.location.href = '/'
    } catch (e) {
      setErrors([e.message])
    }
  }

  return (
    <>
      <LinkedAccounts />
      {hasPassword && (
      <form className="box form" onSubmit={change}>
        <h3>비밀번호 바꾸기</h3>
        <label>지금 비밀번호<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
        <label>새 비밀번호 <span className="muted">10자 이상</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
        <button type="submit" className="button">바꾸기</button>
        {message && <p className="success">{message}</p>}
      </form>
      )}
      <div className="box form">
        <h3>회원 탈퇴</h3>
        {hasPassword
          ? <label>비밀번호 확인<input type="password" value={leavePassword} onChange={(e) => setLeavePassword(e.target.value)} autoComplete="current-password" /></label>
          : <label>확인을 위해 "탈퇴"라고 적어 주세요<input value={leavePassword} onChange={(e) => setLeavePassword(e.target.value)} /></label>}
        <button type="button" className="button ghost" onClick={leave}>탈퇴하기</button>
      </div>
      <Errors list={errors} />
    </>
  )
}

export function MyPage() {
  const [me, setMe] = useState(undefined)
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('social') ? 'security' : 'orders'))

  useEffect(() => {
    get('/account/me').then(setMe).catch(() => { window.location.href = '/account/login?next=/account' })
  }, [])

  async function logout() {
    await post('/account/logout', {})
    window.dispatchEvent(new Event('account-change'))
    window.location.href = '/'
  }

  if (!me) return <p className="muted">불러오는 중…</p>
  const socialMessage = new URLSearchParams(window.location.search).get('social') // 간편 로그인 연결 결과
  return (
    <section>
      <div className="admin-head">
        <h2>{me.name}님의 마이페이지</h2>
        <button type="button" className="link" onClick={logout}>로그아웃</button>
      </div>
      {socialMessage && <p className="success">{socialMessage}</p>}
      <nav className="tabs">
        {[['orders', '주문 내역'], ['profile', '내 정보·배송지'], ['security', '로그인·탈퇴']].map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {tab === 'orders' && <MyOrders />}
      {tab === 'profile' && <Profile me={me} onSaved={setMe} />}
      {tab === 'security' && <Security hasPassword={me.hasPassword !== false} />}
    </section>
  )
}
