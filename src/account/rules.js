// 가입·비밀번호 입력 규칙 (화면 도우미 fields.jsx 와 가입 화면이 쓴다). 서버 server/account.js checkPassword 와 같은 규칙

export const EMAIL_DOMAINS = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com']
const LOCAL_OK = /^[A-Za-z0-9._%+-]{1,64}$/
const DOMAIN_OK = /^[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/

export function emailProblem(email) {
  const [local = '', domain = ''] = email.split('@')
  if (!local) return '이메일 아이디를 적어 주세요.'
  if (!LOCAL_OK.test(local)) return '아이디에는 영문·숫자와 . _ - + 만 쓸 수 있어요.'
  if (!domain) return '뒤쪽 주소(예: naver.com)를 고르거나 적어 주세요.'
  if (!DOMAIN_OK.test(domain) || domain.length > 190) return '뒤쪽 주소를 company.co.kr 처럼 적어 주세요.'
  return ''
}

// 비밀번호 규칙 (적는 동안 하나씩 초록 체크)
export function passwordRules(password, idOrEmail = '') {
  const id = String(idOrEmail).split('@')[0].toLowerCase()
  const kinds = [/[A-Za-z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length
  return [
    { ok: password.length >= 10 && password.length <= 100, text: '10자 이상' },
    { ok: kinds >= 2, text: '영문·숫자·특수문자 중 2가지 이상 섞기' },
    { ok: password.length > 0 && !/^(.)\1+$/.test(password), text: '같은 글자만 반복하지 않기' },
    { ok: !(id.length >= 3 && password.toLowerCase().includes(id)), text: '이메일(아이디) 넣지 않기' },
  ]
}

export const passwordOk = (password, password2, idOrEmail) => passwordRules(password, idOrEmail).every((r) => r.ok) && password === password2

// 휴대폰: 숫자만 받아 010-1234-5678 모양으로 보여 준다
export const formatPhone = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length < 4) return d
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`
}
export const phoneOk = (v) => /^01[016789]\d{7,8}$/.test(v.replace(/\D/g, ''))
